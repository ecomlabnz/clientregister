/**
 * Module: clients.
 *
 * The person or organisation the practice acts for. A client owns cases,
 * quotes, inquiries and a timeline.
 *
 * Two shapes share the table. An individual has given names and a family name
 * kept separate, plus the identity documents and compliance dates a matter
 * depends on. An organisation has a registered name, an NZBN and a Companies
 * Office number, and can be looked up against the NZBN register rather than
 * retyped. `full_name` is the single display name and is derived from
 * whichever shape applies, so the parts and the whole cannot disagree.
 *
 * Passport numbers are the one field held encrypted at rest, and reading one
 * is an audited action.
 */

import { Hono } from 'hono';
import type { AppContext } from '../../types';
import type { AppModule } from '../../core/module';
import { all, nextRef, nowIso, one, run } from '../../core/db';
import { newId } from '../../core/ids';
import { unsealField } from '../../core/crypto';
import { requireAuth, requirePermission } from '../../core/auth';
import { auditFrom } from '../../core/audit';
import { FormReader } from '../../core/validate';
import { page, redirectWith, breadcrumbs } from '../../ui/layout';
import { html, raw, type Raw } from '../../ui/html';
import {
  actionButton, badge, card, csrfField, emptyState, errorList, field, optionsFrom,
  pageHeader, select, statusTone, table,
} from '../../ui/components';
import { dateInputValue, dateShort, dateTime, isOverdue, money, relativeDays, truncate } from '../../ui/format';
import {
  CASE_STATUS_LABELS, CLIENT_STATUSES, CLIENT_STATUS_LABELS,
  ENTRY_KINDS, ENTRY_KIND_LABELS, PARTY_ROLE_LABELS, QUOTE_STATUS_LABELS, type ClientStatus,
} from '../../domain';
import { organisationOptions, userOptions } from '../../core/lookups';
import { addEntry, listEntries } from '../../core/timeline';
import { casesForClient, relatedClients } from '../../core/parties';
import { can } from '../../core/rbac';
import { asPrefInteger, preferencesFor } from '../../core/preferences';
import { caseTypes, englishTests, labelFor, termOptions, visaTypes } from '../../core/vocabulary';
import { countryCodeFor, countryName, countryOptions } from '../../core/countries';
import { threadsFor } from '../../core/channels';
import {
  CERTIFICATE_KINDS, CERTIFICATE_LABELS, MEDICAL_TYPES, type CertificateKind,
  CERTIFICATE_VALIDITY, PROVENANCE_OPTIONS, type CertificateRow, type IssueDateProvenance,
  addCertificate, certificatesFor, confirmIssueDate, currentOf, expiryIsDerived,
  issueDateUnverified, medicalTypeLabel,
  refreshClientCache, removeCertificate, setCertificateSubmitted, validityRule,
} from '../../core/certificates';
import {
  PASSPORT_STATUSES, type PassportStatus,
  addPassport, passportById, passportStatusLabel, passportsFor, removePassport,
  setPrimaryPassport, updatePassport,
} from '../../core/passports';
import { composeFullName, familyNameFor, plainAscii, splitFullName, type ClientKind } from '../../core/names';
import {
  fetchEntity, isValidNzbnFormat, normaliseNzbn, nzbnConfigured, searchEntities,
} from '../../integrations/nzbn';

export interface ClientRow {
  id: string; ref: string; kind: ClientKind; full_name: string; preferred_name: string | null;
  given_names: string | null; family_name: string | null;
  nzbn: string | null; company_number: string | null;
  organisation_id: string | null; organisation_role: string | null;
  primary_contact_id: string | null;
  email: string | null; phone: string | null; whatsapp: string | null;
  telegram_username: string | null; telegram_user_id: string | null;
  nationality: string | null; date_of_birth: string | null; passport_sealed: string | null;
  passport_country: string | null; passport_expiry: string | null;
  police_certificate_date: string | null; police_certificate_expiry: string | null;
  police_certificate_country: string | null;
  medical_certificate_date: string | null; medical_certificate_expiry: string | null;
  chest_xray_expiry: string | null;
  english_test_type: string | null;
  english_test_score: string | null;
  english_test_date: string | null;
  current_visa_type: string | null; current_visa_expiry: string | null;
  current_visa_expiry_rule: string | null;
  address: string | null; status: ClientStatus; assigned_to: string | null; notes: string | null;
  created_at: string; updated_at: string; created_by: string | null;
}

const DEFAULT_PAGE_SIZE = 25;

/** Show a date with a warning when it has passed or is close. */
function expiryCell(value: string | null, warnDays = 90): Raw {
  if (!value) return html`<span class="muted">—</span>`;
  const due = Date.parse(value);
  const soon = !Number.isNaN(due) && due - Date.now() < warnDays * 86_400_000;
  return html`<span class="${isOverdue(value) ? 'warn' : ''}">${dateShort(value)}</span>
    ${soon ? html`<div class="muted small">${relativeDays(value)}</div>` : ''}`;
}

/**
 * The client form.
 *
 * `passport_issued` is not a column on `clients` — the passport is a record in
 * its own table now, and only the primary's country and expiry are cached back
 * onto the client row. The issue date is read from the passport itself and
 * passed in alongside.
 */
type ClientFormValues = Partial<ClientRow> & { passport_issued?: string | null };

function clientForm(
  c: any,
  values: ClientFormValues,
  users: Array<{ value: string; label: string }>,
  organisations: Array<{ value: string; label: string }>,
  englishTestOptions: Array<{ value: string; label: string }>,
  visaTypeOptions: Array<{ value: string; label: string }>,
  errors?: Record<string, string>,
): Raw {
  const csrf = c.get('session').csrf;
  const sealingAvailable = Boolean(c.env.FIELD_KEY);
  const action = values.id ? `/clients/${values.id}` : '/clients';
  const kind: ClientKind = values.kind ?? 'individual';

  // Records created before names were split have no parts stored. Suggest a
  // split so the form can be confirmed rather than retyped — the guess is only
  // ever shown, never saved without someone accepting it.
  const suggested = values.id && kind === 'individual' && !values.family_name
    ? splitFullName(values.full_name)
    : null;
  const givenNames = values.given_names ?? suggested?.givenNames ?? '';
  const familyName = values.family_name ?? suggested?.familyName ?? '';

  return html`
    ${errorList(errors)}
    ${suggested && (suggested.givenNames || suggested.familyName)
      ? html`<div class="alert alert-warn">This record was created before names were kept in two
               parts. We have suggested a split of “${values.full_name}” below — correct it if it
               is wrong, then save.</div>`
      : ''}
    ${/*
      * The form is one form, split across tabs by script alone: every field
      * stays in the document and submits together, so nothing is lost by
      * switching between them and nothing depends on the tabs working. With
      * scripting off, all five sections simply show at once, as they always
      * did.
      */ ''}
    ${/* Hidden in the HTML and revealed by the script that makes it work.
          `js-hide` is the opposite arrangement — it marks a control that exists
          *for* the no-script case and is taken away once scripting is known to
          be there — and it was wrong here: the script's own `bar.hidden = false`
          cancelled it, so with scripting off you got five tab buttons that did
          nothing. Hidden by default fails the safe way: if the script never
          runs, or cannot find this form, the bar stays away and the sections
          read as one long form, which is what they already do. */ ''}
    <nav class="tabs form-tabs" data-tabs-for="client" hidden>
      <button type="button" class="tab current" data-tab="who">Who this is</button>
      <button type="button" class="tab" data-tab="contact">Contact</button>
      <button type="button" class="tab" data-tab="identity">Identity</button>
      <button type="button" class="tab" data-tab="immigration">Immigration</button>
      <button type="button" class="tab" data-tab="file">File</button>
    </nav>
    <form method="post" action="${action}" class="form-grid js-client-form js-tabbed" data-tabs="client">
      ${csrfField(csrf)}
      <div class="form-section" data-panel="who">
        <h3>Who this is</h3>
        ${select({ label: 'Record type', name: 'kind', value: kind, includeBlank: false,
                   options: [{ value: 'individual', label: 'Individual' },
                             { value: 'organisation', label: 'Company or organisation' }] })}

        ${'' /* Marked hidden by the server, not only by the script: a company
                 has no passport and a person has no NZBN, and the wrong half of
                 this form should never be on the page — with scripting or
                 without it. The script re-computes this when the record type
                 changes without a reload. */}
        <div data-kind="individual" ${kind === 'individual' ? '' : raw('hidden')}>
          ${field({ label: 'Given names', name: 'given_names', value: givenNames, maxlength: 120,
                    hint: 'As they appear in the passport.' })}
          ${field({ label: 'Family name', name: 'family_name', value: familyName, required: true, maxlength: 120 })}
          ${field({ label: 'Preferred name', name: 'preferred_name', value: values.preferred_name, maxlength: 120,
                    hint: 'What to call them in conversation, if different.' })}
          ${select({ label: 'Nationality', name: 'nationality', value: values.nationality ?? '',
                     options: countryOptions(), includeBlank: 'Not recorded',
                     hint: 'Held as an ISO 3166-1 country code, so it can be counted and filtered.' })}
          ${field({ label: 'Date of birth', name: 'date_of_birth', type: 'date', value: dateInputValue(values.date_of_birth) })}

          ${'' /* These two are one fact in two boxes: which company, and what
                   they do there. Left to flow with everything else they landed
                   in different rows with a field between them, which is how a
                   form turns into a dump of boxes. */}
          <fieldset class="field-group">
            <legend>Employment</legend>
            ${select({ label: 'Works for', name: 'organisation_id', value: values.organisation_id ?? '',
                       options: organisations, includeBlank: 'Not linked to an organisation',
                       hint: 'Links this person to a company client. One of them can then be named as '
                         + 'its primary contact.' })}
            ${field({ label: 'Role there', name: 'organisation_role', value: values.organisation_role,
                      maxlength: 100, placeholder: 'e.g. Director, HR Manager' })}
          </fieldset>
        </div>

        <div data-kind="organisation" ${kind === 'organisation' ? '' : raw('hidden')}>
          ${field({ label: 'Registered name', name: 'organisation_name',
                    value: kind === 'organisation' ? values.full_name : '', maxlength: 200,
                    hint: 'Exactly as registered — the NZBN register is the authority.' })}
          ${field({ label: 'NZBN', name: 'nzbn', value: values.nzbn, maxlength: 13,
                    hint: '13 digits, starting 9429.' })}
          ${field({ label: 'Companies Office number', name: 'company_number', value: values.company_number, maxlength: 30 })}
          ${nzbnConfigured(c.env)
            ? html`<p class="hint"><a href="/clients/lookup">Search the NZBN register</a> to create a
                     company client from its registered details.</p>`
            : ''}
        </div>
      </div>

      <div class="form-section" data-panel="contact">
        <h3>Contact</h3>
        ${field({ label: 'Email', name: 'email', type: 'email', value: values.email, maxlength: 320 })}
        ${field({ label: 'Phone', name: 'phone', value: values.phone, maxlength: 60 })}
        ${field({ label: 'WhatsApp number', name: 'whatsapp', value: values.whatsapp, maxlength: 60,
                  hint: 'Digits only with country code, e.g. 6421234567. Used to match incoming WhatsApp messages.' })}
        ${field({ label: 'Telegram username', name: 'telegram_username', value: values.telegram_username, maxlength: 60 })}
        ${field({ label: 'Telegram user ID', name: 'telegram_user_id', value: values.telegram_user_id, maxlength: 40,
                  hint: 'Numeric ID. Used to match forwarded Telegram messages.' })}
        ${field({ label: 'Address', name: 'address', type: 'textarea', value: values.address, rows: 3, maxlength: 500 })}
      </div>

      <div class="form-section" data-kind="individual" data-panel="identity"
           ${kind === 'individual' ? '' : raw('hidden')}>
        <h3>Identity documents</h3>
        ${sealingAvailable
          ? html`${field({ label: 'Passport number', name: 'passport_number', value: '',
                    hint: values.passport_sealed
                      ? 'A passport number is on file (encrypted). Enter a new one to replace it, or leave blank to keep it.'
                      : 'Stored encrypted at rest.' })}
                 ${values.passport_sealed ? html`
                   <div class="field checkbox-field">
                     <label><input type="checkbox" name="passport_clear" value="1">
                       Remove the number on file</label>
                     <p class="hint">For one entered against the wrong person. Leaving the box above
                        blank keeps what is stored; this is the only way to take it out.</p>
                   </div>` : ''}`
          : html`<div class="field"><label>Passport number</label>
                 <p class="hint">Disabled: set the <code>FIELD_KEY</code> secret to store passport numbers encrypted.</p></div>`}
        ${field({ label: 'Passport country', name: 'passport_country', value: values.passport_country, maxlength: 100 })}
        ${field({ label: 'Passport issued', name: 'passport_issued', type: 'date',
                  value: dateInputValue(values.passport_issued ?? null) })}
        ${field({ label: 'Passport expiry', name: 'passport_expiry', type: 'date', value: dateInputValue(values.passport_expiry),
                  hint: 'Watched on the alerts page — a passport expiring mid-application stalls it.' })}
        <div class="settings-cell-wide">
          <p class="hint">These boxes are the <strong>primary</strong> passport — the travel document
             this file works from. A client may hold more than one: a dual national holds two at
             once, and someone who has just renewed holds the new one plus the old one carrying a
             live visa. Second and third passports are kept on the client's own
             page${values.id ? html` — <a href="/clients/${values.id}#passports">add one there</a>` : ''},
             each with its own country and dates, and every one still held is watched for expiry.</p>
        </div>
      </div>

      ${'' /* INZ assesses four things — immigration history, character, health
               and English — and they belong together on one tab under four
               headings rather than on four tabs of three boxes each. A tab per
               heading looks tidier in a screenshot and reads worse in use: the
               four are checked as a set, and splitting them makes you click
               four times to see whether a person is eligible. */}
      <div class="form-section form-section-wide" data-kind="individual" data-panel="immigration"
           ${kind === 'individual' ? '' : raw('hidden')}>
        <h3>Immigration, character, health and English</h3>

        <div class="settings-form">
          <p class="settings-head subhead">Immigration</p>
          <div class="settings-cell">${select({ label: 'Current visa', name: 'current_visa_type',
            value: values.current_visa_type ?? '', options: visaTypeOptions,
            includeBlank: 'Not recorded',
            hint: 'What they hold now, not what is being applied for. “None — offshore” is an '
              + 'answer, and so is “None — unlawful”.' })}</div>
          <div class="settings-cell">${field({ label: 'Current visa expiry', name: 'current_visa_expiry', type: 'date', value: dateInputValue(values.current_visa_expiry) })}</div>
          <div class="settings-cell">${field({ label: 'Expiry rule, if no date is fixed yet',
            name: 'current_visa_expiry_rule', maxlength: 200,
            value: values.current_visa_expiry_rule ?? '',
            hint: 'Some grants have no date until an event happens — “24 months after first '
              + 'arrival in New Zealand”. Record the rule here; the register shows the expiry '
              + 'as not yet fixed and prompts for the date once the event has happened.' })}</div>

          <p class="settings-head subhead">Character and health</p>
          <div class="settings-cell-wide">
            <p class="hint">Police certificates, medicals and x-rays are kept on the client's own
               page, each as a record with its own dates${values.id
                 ? html` — <a href="/clients/${values.id}#certificates">add one there</a>` : ''}.
               A new certificate does not overwrite the old one: a matter lodged in March relied on
               what was held in March, and that has to stay answerable. A client may hold police
               certificates from several countries at once, which a single set of boxes here could
               never represent.</p>
          </div>

          <p class="settings-head subhead">English</p>
          <div class="settings-cell">${select({ label: 'Test or exemption', name: 'english_test_type',
                    value: values.english_test_type ?? '', options: englishTestOptions,
                    includeBlank: 'Not recorded' })}</div>
          <div class="settings-cell">${field({ label: 'Score', name: 'english_test_score', value: values.english_test_score, maxlength: 40,
                    hint: 'As the certificate states it — 6.5, 58, B2. The tests do not share a scale.' })}</div>
          <div class="settings-cell">${field({ label: 'Test date', name: 'english_test_date', type: 'date', value: dateInputValue(values.english_test_date),
                    hint: 'Most results are accepted for two years.' })}</div>
        </div>
      </div>

      <div class="form-section" data-panel="file">
        <h3>File management</h3>
        ${select({ label: 'Status', name: 'status', value: values.status ?? 'prospect', includeBlank: false,
                   options: optionsFrom(CLIENT_STATUSES, CLIENT_STATUS_LABELS) })}
        ${select({ label: 'Assigned to', name: 'assigned_to', value: values.assigned_to ?? '', options: users, includeBlank: 'Unassigned' })}
        ${field({ label: 'General notes', name: 'notes', type: 'textarea', value: values.notes, rows: 4, maxlength: 4000 })}
      </div>

      <div class="form-actions">
        <button class="btn btn-primary" type="submit">${values.id ? 'Save changes' : 'Create client'}</button>
        <a class="btn btn-secondary" href="${values.id ? `/clients/${values.id}` : '/clients'}">Cancel</a>
      </div>
    </form>`;
}

/**
 * Read the client form. The required fields depend on which kind of client it
 * is, and `full_name` is derived rather than accepted from the browser.
 */
function readClientForm(f: FormReader) {
  const kind = f.enum('kind', ['individual', 'organisation'] as const, { fallback: 'individual' })!;

  // Names are recorded in plain English letters and the family name in
  // capitals. Applied here, once, rather than left to whoever typed the record.
  const givenNames = plainAscii(f.optional('given_names', { max: 120 })) || null;
  const familyName = kind === 'individual'
    ? f.text('family_name', { required: true, label: 'Family name', max: 120 })
    : f.optional('family_name', { max: 120 }) ?? '';
  const organisationName = kind === 'organisation'
    ? f.text('organisation_name', { required: true, label: 'Registered name', max: 200 })
    : '';

  const nzbn = f.optional('nzbn', { max: 20 });
  if (nzbn && !isValidNzbnFormat(nzbn)) {
    f.errors['nzbn'] = 'An NZBN is 13 digits, starting 9429.';
  }

  return {
    kind,
    given_names: givenNames,
    // Stored in capitals, not merely shown that way, so the client, the matter
    // named from it, the export and any search all agree without each of them
    // remembering to.
    family_name: familyNameFor(familyName) || null,
    full_name: composeFullName(kind, { givenNames, familyName }, organisationName),
    nzbn: nzbn ? normaliseNzbn(nzbn) : null,
    company_number: f.optional('company_number', { max: 30 }),
    organisation_id: f.optional('organisation_id', { max: 60 }),
    organisation_role: f.optional('organisation_role', { max: 100 }),
    preferred_name: plainAscii(f.optional('preferred_name', { max: 120 })) || null,
    email: f.email('email'),
    phone: f.optional('phone', { max: 60 }),
    whatsapp: f.optional('whatsapp', { max: 60 }),
    telegram_username: f.optional('telegram_username', { max: 60 }),
    telegram_user_id: f.optional('telegram_user_id', { max: 40, pattern: /^\d+$/, patternMessage: 'Telegram user ID must be numeric.' }),
    // The form is a dropdown, so this is already a code. Passed through the
    // resolver anyway: a request built by hand carrying "Vietnam" then lands as
    // VN rather than as a 500 from the trigger that guards the column.
    nationality: countryCodeFor(f.optional('nationality', { max: 100 })),
    date_of_birth: f.date('date_of_birth'),
    passport_country: f.optional('passport_country', { max: 100 }),
    passport_expiry: f.date('passport_expiry'),
    passport_issued: f.date('passport_issued'),
    english_test_type: f.optional('english_test_type', { max: 60 }),
    english_test_score: f.optional('english_test_score', { max: 40 }),
    english_test_date: f.date('english_test_date'),
    current_visa_type: f.optional('current_visa_type', { max: 120 }),
    current_visa_expiry: f.date('current_visa_expiry'),
    current_visa_expiry_rule: f.optional('current_visa_expiry_rule', { max: 200 }),
    address: f.optional('address', { max: 500 }),
    status: f.enum('status', CLIENT_STATUSES, { fallback: 'prospect' })!,
    assigned_to: f.optional('assigned_to', { max: 60 }),
    notes: f.optional('notes', { max: 4000 }),
    passport_number: f.optional('passport_number', { max: 60 }),
    passport_clear: f.checkbox('passport_clear'),
  };
}

/**
 * Whether the summary's cached expiry for this kind rests on an issue date
 * nobody read off the certificate itself (0040). Matched by expiry date,
 * because the date is what the cache column stores; if two certificates share
 * it, the doubt of either taints the value shown.
 */
function certificateDateUnverified(
  rows: CertificateRow[], kind: CertificateKind, cachedExpiry: string | null,
): boolean {
  if (!cachedExpiry) return false;
  return rows.some((r) => r.kind === kind && r.expires_on === cachedExpiry && issueDateUnverified(r));
}

/**
 * What each sortable heading in the client list orders by.
 *
 * A key arrives in the address bar, so it is looked up here and never
 * interpolated: an unknown key finds nothing and the list falls back to its
 * default order. Anything reaching ORDER BY from a query string would be an
 * injection with a URL for a payload.
 *
 * Each entry is a list, because one heading can need more than one expression
 * to break its own ties — and each gets the direction applied, or only the
 * last would be reversed.
 */
export const CLIENT_SORTS: Record<string, string[]> = {
  ref: ['c.ref'],
  // A register that writes surnames in capitals sorts by them too: "TRUONG,
  // Thi Thu Thuy" belongs under T for Truong, not under T for Thi. An
  // organisation has no family name, so it sorts under its registered one.
  //
  // COLLATE NOCASE because SQLite compares text by byte otherwise, which puts
  // TRUONG before Tagata — capitals sort ahead of lower case. The column is
  // written in capitals, so this only matters for a row that arrived some
  // other way, and it is exactly that row a person would go looking for.
  name: ["COALESCE(NULLIF(c.family_name, ''), c.full_name) COLLATE NOCASE", 'c.full_name COLLATE NOCASE'],
  contact: ["COALESCE(c.email, c.phone, '') COLLATE NOCASE"],
  status: ['c.status'],
  cases: ['open_cases'],
  updated: ['c.updated_at'],
};

export const clientsModule: AppModule = {
  name: 'clients',
  title: 'Clients',
  basePaths: ['/clients'],
  nav: [{ href: '/clients', label: 'Clients', permission: 'register:read', order: 90 }],

  register(app) {
    const r = new Hono<AppContext>();
    r.use('*', requireAuth);

    // --- List ---------------------------------------------------------------
    r.get('/', requirePermission('register:read'), async (c) => {
      const q = (c.req.query('q') ?? '').trim();
      const status = c.req.query('status') ?? '';
      const pageNum = Math.max(1, Number(c.req.query('page') ?? '1') || 1);

      const prefs = await preferencesFor(c.env, c.get('user')!.id);

      const PAGE_SIZE = asPrefInteger(prefs['pref.page_size'], DEFAULT_PAGE_SIZE);
      const offset = (pageNum - 1) * PAGE_SIZE;

      // Four ways of looking at one list rather than four lists. Leads cuts by
      // stage; individuals and organisations cut by what kind of client it is,
      // because in practice you are either working a pipeline or looking for a
      // person or a company, and those are different errands.
      const view = c.req.query('view') ?? prefs['pref.clients_view'] ?? 'individuals';
      const where: string[] = [];
      const params: unknown[] = [];
      if (view === 'leads' && !status) where.push(`status = 'prospect'`);
      else if (view === 'individuals') where.push(`kind = 'individual'`);
      else if (view === 'organisations') where.push(`kind = 'organisation'`);
      if (view !== 'all' && view !== 'leads') where.push(`status <> 'archived'`);
      if (q) {
        where.push(`(full_name LIKE ?1 OR family_name LIKE ?1 OR given_names LIKE ?1
                     OR email LIKE ?1 OR phone LIKE ?1 OR ref LIKE ?1
                     OR preferred_name LIKE ?1 OR nzbn LIKE ?1 OR company_number LIKE ?1)`);
        params.push(`%${q}%`);
      }
      if (status && (CLIENT_STATUSES as readonly string[]).includes(status)) {
        where.push(`status = ?${params.length + 1}`);
        params.push(status);
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

      const asked = c.req.query('sort') ?? '';
      const sortCols = CLIENT_SORTS[asked];
      const sortKey = sortCols ? asked : '';
      const sortDir = c.req.query('dir') === 'desc' ? 'desc' : 'asc';
      const dirSql = sortDir === 'desc' ? 'DESC' : 'ASC';
      // The ref tie-breaker keeps paging stable: two rows with the same status
      // must not swap places between page one and page two.
      const orderSql = sortCols
        ? `${sortCols.map((e) => `${e} ${dirSql}`).join(', ')}, c.ref ASC`
        : 'c.updated_at DESC';

      const rows = await all<ClientRow & { open_cases: number }>(
        c.env.DB,
        `SELECT c.*, (SELECT COUNT(*) FROM cases k WHERE k.client_id = c.id AND k.closed_at IS NULL) AS open_cases
           FROM clients c ${whereSql}
          ORDER BY ${orderSql} LIMIT ?${params.length + 1} OFFSET ?${params.length + 2}`,
        ...params, PAGE_SIZE + 1, offset,
      );
      const hasMore = rows.length > PAGE_SIZE;
      const shown = rows.slice(0, PAGE_SIZE);
      const writable = can(c.get('user'), 'register:write');

      const counts = await one<{ leads: number; individuals: number; organisations: number; total: number }>(
        c.env.DB,
        `SELECT SUM(status = 'prospect') AS leads,
                SUM(kind = 'individual' AND status <> 'archived') AS individuals,
                SUM(kind = 'organisation' AND status <> 'archived') AS organisations,
                COUNT(*) AS total FROM clients`,
      );
      const views: Array<{ id: string; label: string; count: number }> = [
        { id: 'leads', label: 'Leads', count: counts?.leads ?? 0 },
        { id: 'individuals', label: 'Individuals', count: counts?.individuals ?? 0 },
        { id: 'organisations', label: 'Organisations', count: counts?.organisations ?? 0 },
        { id: 'all', label: 'All', count: counts?.total ?? 0 },
      ];

      return page(c, { title: 'Clients', active: '/clients' }, html`
        ${pageHeader('Clients', 'Everyone the practice acts for.',
          writable
            ? html`<a class="btn btn-primary" href="/clients/new">New client</a>
                   ${nzbnConfigured(c.env)
                     ? html`<a class="btn btn-secondary" href="/clients/lookup">New from NZBN register</a>`
                     : ''}`
            : undefined)}
        <nav class="tabs">
          ${views.map((v) => html`
            <a class="${v.id === view ? 'tab current' : 'tab'}"
               href="/clients?view=${v.id}">${v.label} <span class="muted">${v.count}</span></a>`)}
        </nav>

        <form method="get" action="/clients" class="filters" data-live-search>
          <input type="hidden" name="view" value="${view}">
          <input type="search" name="q" value="${q}" placeholder="Search name, email, phone, reference or NZBN">
          <select name="status">
            <option value="">All statuses</option>
            ${CLIENT_STATUSES.map((s) => html`<option value="${s}" ${s === status ? raw('selected') : ''}>${CLIENT_STATUS_LABELS[s]}</option>`)}
          </select>
          <button class="btn btn-secondary" type="submit">Filter</button>
        </form>
        <div data-live-results>
        ${table([
          { label: 'Reference', width: '14', hideOn: 'sm', sort: 'ref' },
          { label: 'Name', width: '30', sort: 'name' },
          { label: 'Contact', width: '24', sort: 'contact' },
          { label: 'Status', width: '14', hideOn: 'sm', sort: 'status' },
          { label: 'Open cases', width: '10', hideOn: 'sm', sort: 'cases' },
          { label: 'Updated', width: '12', hideOn: 'sm', sort: 'updated' },
        ], shown.map((row) => html`
          <tr>
            <td class="col-sm-hide"><a href="/clients/${row.id}"><code>${row.ref}</code></a></td>
            <td><a href="/clients/${row.id}">${row.full_name}</a>
                <div class="muted small">
                  ${row.kind === 'organisation'
                    ? html`Organisation${row.nzbn ? html` · NZBN ${row.nzbn}` : ''}`
                    : countryName(row.nationality)}
                </div>
                <div class="row-meta show-sm">
                  <code>${row.ref}</code>
                  ${badge(CLIENT_STATUS_LABELS[row.status], statusTone(row.status))}
                  ${row.open_cases ? html`<span class="muted">${row.open_cases} open</span>` : ''}
                </div></td>
            <td class="small">${row.email ?? ''}${row.email && row.phone ? raw('<br>') : ''}${row.phone ?? ''}</td>
            <td class="col-sm-hide">${badge(CLIENT_STATUS_LABELS[row.status], statusTone(row.status))}</td>
            <td class="col-sm-hide">${row.open_cases || '—'}</td>
            <td class="small col-sm-hide">${dateShort(row.updated_at)}</td>
          </tr>`), { sticky: true, fixed: true, empty: 'No clients match that.',
            // Sorting resets to page one: the second page of one order holds
            // different rows from the second page of another.
            sort: { key: sortKey, dir: sortDir,
                    href: (key, dir) => `/clients?${new URLSearchParams({
                      view, q, status, sort: key, dir, page: '1' }).toString()}` } })}
        <div class="pager">
          ${pageNum > 1 ? html`<a class="btn btn-secondary" href="${`/clients?${new URLSearchParams({ view, q, status, sort: sortKey, dir: sortDir, page: String(pageNum - 1) }).toString()}`}">Previous</a>` : ''}
          ${hasMore ? html`<a class="btn btn-secondary" href="${`/clients?${new URLSearchParams({ view, q, status, sort: sortKey, dir: sortDir, page: String(pageNum + 1) }).toString()}`}">Next</a>` : ''}
        </div>
        </div>`);
    });

    // --- Create -------------------------------------------------------------
    r.get('/new', requirePermission('register:write'), async (c) => {
      const [users, organisations, tests] = await Promise.all([
        userOptions(c.env), organisationOptions(c.env), englishTests(c.env)]);
      const englishTestOptions = termOptions(tests);
      const visaTypeOptions = termOptions(await visaTypes(c.env));
      const kind = c.req.query('kind') === 'organisation' ? 'organisation' : 'individual';

      // The assistant, or any other page, may propose a starting point through
      // the address. It is only ever a draft in a form somebody submits, so the
      // limits here are about length rather than trust — nothing is stored
      // until the ordinary create route validates it.
      const prefill = (name: string, max = 200) => (c.req.query(name) ?? '').slice(0, max) || undefined;
      const proposed: Partial<ClientRow> = {
        kind,
        given_names: prefill('given_names', 120),
        family_name: prefill('family_name', 120),
        email: prefill('email', 320),
        phone: prefill('phone', 60),
        nationality: prefill('nationality', 100),
      };

      return page(c, { title: 'New client', active: '/clients' }, html`
        ${breadcrumbs([{ href: '/clients', label: 'Clients' }, { label: 'New' }])}
        ${pageHeader('New client', null, can(c.get('user'), 'ai:run')
          ? html`<a class="btn btn-secondary" href="/assistant/intake">Read it from a document</a>`
          : undefined)}
        ${Object.values(proposed).filter(Boolean).length > 1
          ? html`<div class="alert alert-ok">Filled in from what the assistant read. Check it before
                   saving — it is a reading, not a fact.</div>`
          : ''}
        ${clientForm(c, proposed, users, organisations, englishTestOptions, visaTypeOptions)}`);
    });

    // --- NZBN register lookup ----------------------------------------------
    // Registered before '/:id' so the literal path is not read as an id.
    r.get('/lookup', requirePermission('register:write'), async (c) => {
      const term = (c.req.query('q') ?? '').trim();
      const csrf = c.get('session')!.csrf;

      if (!nzbnConfigured(c.env)) {
        return page(c, { title: 'NZBN lookup', active: '/clients' }, html`
          ${breadcrumbs([{ href: '/clients', label: 'Clients' }, { label: 'NZBN lookup' }])}
          ${pageHeader('NZBN register lookup', 'Not configured yet.')}
          ${card('Connect the register', html`
            <p>MBIE publishes the New Zealand Business Number register as a free API. Once
               connected, you can search it by company name and create a client from the
               registered details rather than retyping them.</p>
            <ol>
              <li>Register at <code>portal.api.business.govt.nz</code>.</li>
              <li>Subscribe to the <strong>NZBN</strong> API and copy your subscription key.</li>
              <li>Add it as the repository secret <code>NZBN_API_KEY</code> and re-run the Deploy workflow.</li>
            </ol>
            <p class="hint">Company clients can be recorded by hand in the meantime — the NZBN and
               Companies Office number fields are on the ordinary client form.</p>`)}`);
      }

      let results: Awaited<ReturnType<typeof searchEntities>> = [];
      let error: string | null = null;
      if (term) {
        try {
          results = isValidNzbnFormat(normaliseNzbn(term))
            ? [await fetchEntity(c.env, term)].filter((e): e is NonNullable<typeof e> => e !== null)
            : await searchEntities(c.env, term);
        } catch (err) {
          error = err instanceof Error ? err.message : 'The NZBN register could not be reached.';
        }
      }

      return page(c, { title: 'NZBN lookup', active: '/clients' }, html`
        ${breadcrumbs([{ href: '/clients', label: 'Clients' }, { label: 'NZBN lookup' }])}
        ${pageHeader('NZBN register lookup', 'Search the register by company name or NZBN.')}
        <form method="get" action="/clients/lookup" class="filters">
          <input type="search" name="q" value="${term}" placeholder="Company name, or a 13-digit NZBN" autofocus>
          <button class="btn btn-primary" type="submit">Search</button>
        </form>
        ${error ? html`<div class="alert alert-error">${error}</div>` : ''}
        ${term && !error && results.length === 0
          ? emptyState('Nothing on the register matched that.')
          : ''}
        ${results.length > 0
          ? table(['Registered name', 'NZBN', 'Type', 'Status', ''], results.map((entity) => html`
              <tr>
                <td><strong>${entity.name}</strong>
                    ${entity.address ? html`<div class="muted small">${entity.address}</div>` : ''}</td>
                <td class="small"><code>${entity.nzbn}</code>
                    ${entity.companyNumber ? html`<div class="muted">Co. ${entity.companyNumber}</div>` : ''}</td>
                <td class="small">${entity.entityType ?? '—'}</td>
                <td>${entity.entityStatus
                  ? badge(entity.entityStatus, /regist|active/i.test(entity.entityStatus) ? 'green' : 'grey')
                  : '—'}</td>
                <td>${actionButton('/clients/lookup/create', csrf, 'Create client',
                       { className: 'btn btn-small btn-primary', fields: { nzbn: entity.nzbn } })}</td>
              </tr>`))
          : ''}`);
    });

    r.post('/lookup/create', requirePermission('register:write'), async (c) => {
      if (!nzbnConfigured(c.env)) return redirectWith(c, '/clients', 'The NZBN register is not configured.', 'err');
      const user = c.get('user')!;
      const f = new FormReader(await c.req.formData());
      const nzbn = f.text('nzbn', { required: true, label: 'NZBN', max: 20 });
      if (!f.valid) return redirectWith(c, '/clients/lookup', 'Choose an entity from the results.', 'err');

      const existing = await one<{ id: string; ref: string }>(
        c.env.DB, 'SELECT id, ref FROM clients WHERE nzbn = ?', normaliseNzbn(nzbn),
      );
      if (existing) {
        return redirectWith(c, `/clients/${existing.id}`, `Already on file as ${existing.ref}.`);
      }

      let entity;
      try {
        entity = await fetchEntity(c.env, nzbn);
      } catch (err) {
        return redirectWith(c, `/clients/lookup?q=${encodeURIComponent(nzbn)}`,
          err instanceof Error ? err.message : 'The NZBN register could not be reached.', 'err');
      }
      if (!entity) return redirectWith(c, '/clients/lookup', 'That entity is no longer on the register.', 'err');

      const id = newId('cli');
      const ref = await nextRef(c.env.DB, 'client', 'CL');
      await run(
        c.env.DB,
        `INSERT INTO clients (id, ref, kind, full_name, nzbn, company_number, email, phone, address,
            status, created_at, updated_at, created_by)
         VALUES (?,?,'organisation',?,?,?,?,?,?, 'prospect', ?,?,?)`,
        id, ref, entity.name, entity.nzbn, entity.companyNumber,
        entity.emailAddress, entity.phoneNumber, entity.address,
        nowIso(), nowIso(), user.id,
      );
      await addEntry(c.env, {
        entityType: 'client', entityId: id, kind: 'system',
        body: `Client created from the NZBN register: ${entity.name} (NZBN ${entity.nzbn}`
          + `${entity.entityType ? `, ${entity.entityType}` : ''}`
          + `${entity.entityStatus ? `, ${entity.entityStatus}` : ''}).`,
        createdBy: user.id,
      });
      await auditFrom(c, { action: 'client.created_from_nzbn', entityType: 'client', entityId: id,
        meta: { ref, nzbn: entity.nzbn } });
      return redirectWith(c, `/clients/${id}`, `Client ${ref} created from the NZBN register.`);
    });

    r.post('/', requirePermission('register:write'), async (c) => {
      const user = c.get('user')!;
      const f = new FormReader(await c.req.formData());
      const v = readClientForm(f);
      if (!f.valid) {
        const [users, organisations, tests] = await Promise.all([
        userOptions(c.env), organisationOptions(c.env), englishTests(c.env)]);
      const englishTestOptions = termOptions(tests);
      const visaTypeOptions = termOptions(await visaTypes(c.env));
        return page(c, { title: 'New client', active: '/clients', status: 400 }, html`
          ${pageHeader('New client')}${clientForm(c, v as Partial<ClientRow>, users, organisations, englishTestOptions, visaTypeOptions, f.errors)}`);
      }

      const id = newId('cli');
      const ref = await nextRef(c.env.DB, 'client', 'CL');

      // The passport columns are not written here. They are a cache of the
      // primary row in client_passports, filled in below by the same code that
      // maintains them everywhere else — so there is one place that can get it
      // wrong rather than three.
      await run(
        c.env.DB,
        `INSERT INTO clients (id, ref, kind, full_name, given_names, family_name, preferred_name,
            nzbn, company_number, organisation_id, organisation_role,
            email, phone, whatsapp, telegram_username, telegram_user_id,
            nationality, date_of_birth,
            english_test_type, english_test_score, english_test_date,
            current_visa_type, current_visa_expiry, current_visa_expiry_rule,
            address, status, assigned_to, notes,
            created_at, updated_at, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        id, ref, v.kind, v.full_name, v.given_names, v.family_name, v.preferred_name,
        v.nzbn, v.company_number, v.organisation_id || null, v.organisation_role, v.email, v.phone, v.whatsapp, v.telegram_username, v.telegram_user_id,
        v.nationality, v.date_of_birth,
        v.english_test_type, v.english_test_score, v.english_test_date,
        v.current_visa_type, v.current_visa_expiry, v.current_visa_expiry_rule,
        v.address, v.status, v.assigned_to || null, v.notes,
        nowIso(), nowIso(), user.id,
      );

      if (v.passport_number || v.passport_country || v.passport_expiry || v.passport_issued) {
        await addPassport(c.env, {
          clientId: id, country: v.passport_country, number: v.passport_number,
          issuedOn: v.passport_issued, expiresOn: v.passport_expiry,
          status: 'held', isPrimary: true, notes: null, userId: user.id,
        });
        if (v.passport_number) {
          await auditFrom(c, { action: 'client.passport_set', entityType: 'client', entityId: id,
            meta: { replaced: false } });
        }
      }
      await addEntry(c.env, { entityType: 'client', entityId: id, kind: 'system', body: `Client record created (${ref}).`, createdBy: user.id });
      await auditFrom(c, { action: 'client.created', entityType: 'client', entityId: id, meta: { ref, kind: v.kind } });
      return redirectWith(c, `/clients/${id}`, `Client ${ref} created.`);
    });

    // --- Detail -------------------------------------------------------------
    r.get('/:id', requirePermission('register:read'), async (c) => {
      const types = await caseTypes(c.env);
      const id = c.req.param('id')!;
      const client = await one<ClientRow & { assignee_name: string | null }>(
        c.env.DB,
        `SELECT c.*, u.name AS assignee_name FROM clients c
           LEFT JOIN users u ON u.id = c.assigned_to WHERE c.id = ?`,
        id,
      );
      if (!client) return c.notFound();

      const [cases, quotes, inquiries, entries, tasks, partyCases, related, employer, people,
             feesByCase, englishTestTerms, visaTerms, certificates, passports, threads] = await Promise.all([
        all<any>(c.env.DB, `SELECT id, ref, title, case_type, status, priority, next_action, next_action_due, updated_at
                              FROM cases WHERE client_id = ? ORDER BY updated_at DESC`, id),
        all<any>(c.env.DB, `SELECT id, ref, description, amount_cents, gst_cents, disbursements_cents, currency, status, created_at
                              FROM quotes WHERE client_id = ? ORDER BY created_at DESC`, id),
        all<any>(c.env.DB, `SELECT id, ref, source, subject, status, received_at
                              FROM inquiries WHERE client_id = ? ORDER BY received_at DESC LIMIT 20`, id),
        listEntries(c.env, 'client', id),
        all<any>(c.env.DB, `SELECT id, title, status, due_at FROM tasks
                             WHERE entity_type = 'client' AND entity_id = ? AND status IN ('open','in_progress','blocked')
                             ORDER BY due_at`, id),
        casesForClient(c.env, id),
        relatedClients(c.env, id),
        // For an individual: the organisation they work for. For an
        // organisation: its people, and which of them is the primary contact.
        one<{ id: string; ref: string; full_name: string; primary_contact_id: string | null }>(
          c.env.DB, 'SELECT id, ref, full_name, primary_contact_id FROM clients WHERE id = (SELECT organisation_id FROM clients WHERE id = ?)', id),
        all<{ id: string; ref: string; full_name: string; organisation_role: string | null }>(
          c.env.DB,
          `SELECT id, ref, full_name, organisation_role FROM clients
            WHERE organisation_id = ? ORDER BY full_name`, id),
        // Money across every matter this client owns. Fees are recorded per
        // case, which is right — but "what does this person owe us" is a
        // question about the person, and answering it meant opening each file
        // in turn and adding up.
        all<{ case_id: string; case_ref: string; case_title: string;
              gross: number; paid: number; billed: number }>(
          c.env.DB,
          `SELECT k.id AS case_id, k.ref AS case_ref, k.title AS case_title,
                  COALESCE(SUM(f.gross_cents), 0) AS gross,
                  COALESCE(SUM(CASE WHEN f.status = 'paid' THEN f.gross_cents ELSE 0 END), 0) AS paid,
                  COALESCE(SUM(CASE WHEN f.status IN ('invoiced','paid') THEN f.gross_cents ELSE 0 END), 0) AS billed
             FROM cases k JOIN fee_items f ON f.case_id = k.id
            WHERE k.client_id = ? AND f.status != 'cancelled'
            GROUP BY k.id ORDER BY k.updated_at DESC`, id),
        englishTests(c.env),
        visaTypes(c.env),
        certificatesFor(c.env, id),
        passportsFor(c.env, id),
        threadsFor(c.env, 'client', id),
      ]);

      // Cases where this client is a party but not the file owner — an
      // employer, a supporting partner, a child on a parent's application.
      const ownCaseIds = new Set(cases.map((k: any) => k.id));
      const otherRoles = partyCases.filter((pc) => !ownCaseIds.has(pc.case_id));

      const csrf = c.get('session')!.csrf;
      const writable = can(c.get('user'), 'register:write');
      const isOrg = client.kind === 'organisation';
      const feeTotals = feesByCase.reduce(
        (acc, row) => ({
          gross: acc.gross + row.gross,
          billed: acc.billed + row.billed,
          paid: acc.paid + row.paid,
          owing: acc.owing + (row.gross - row.paid),
        }),
        { gross: 0, billed: 0, paid: 0, owing: 0 },
      );

      return page(c, { title: client.full_name, active: '/clients' }, html`
        ${breadcrumbs([{ href: '/clients', label: 'Clients' }, { label: client.ref }])}
        ${pageHeader(client.full_name,
          `${client.ref} · ${isOrg ? 'Organisation' : 'Individual'} · ${CLIENT_STATUS_LABELS[client.status]}`
            + `${client.assignee_name ? ` · ${client.assignee_name}` : ''}`,
          writable ? html`
            ${client.status === 'prospect'
              ? actionButton(`/clients/${client.id}/status`, csrf, 'Convert to client',
                  { className: 'btn btn-primary', fields: { status: 'active' } })
              : ''}
            <a class="btn btn-secondary" href="/clients/${client.id}/edit">Edit</a>
            <a class="btn ${client.status === 'prospect' ? 'btn-secondary' : 'btn-primary'}"
               href="/cases/new?client_id=${client.id}">New case</a>
            <a class="btn btn-secondary" href="/quotes/new?client_id=${client.id}">New quote</a>` : undefined)}

        <div class="cols">
          <div class="col-main">
            ${card('Cases', table(['Reference', 'Matter', 'Type', 'Status', 'Next action'], cases.map((k: any) => html`
              <tr>
                <td><a href="/cases/${k.id}"><code>${k.ref}</code></a></td>
                <td><a href="/cases/${k.id}">${k.title}</a></td>
                <td class="small">${labelFor(types, k.case_type)}</td>
                <td>${badge(CASE_STATUS_LABELS[k.status as keyof typeof CASE_STATUS_LABELS] ?? k.status, statusTone(k.status))}</td>
                <td class="small">${k.next_action ? html`${truncate(k.next_action, 60)}<div class="muted">${dateShort(k.next_action_due)}</div>` : '—'}</td>
              </tr>`)))}

            ${card('Quotes', table(['Reference', 'Description', 'Total', 'Status', 'Raised'], quotes.map((qt: any) => html`
              <tr>
                <td><a href="/quotes/${qt.id}"><code>${qt.ref}</code></a></td>
                <td>${truncate(qt.description, 70)}</td>
                <td>${money(qt.amount_cents + qt.gst_cents + qt.disbursements_cents, qt.currency)}</td>
                <td>${badge(QUOTE_STATUS_LABELS[qt.status as keyof typeof QUOTE_STATUS_LABELS] ?? qt.status, statusTone(qt.status))}</td>
                <td class="small">${dateShort(qt.created_at)}</td>
              </tr>`)))}

            ${card('Timeline', html`
              ${writable ? html`
              <form method="post" action="/clients/${client.id}/entries" class="entry-form">
                ${csrfField(csrf)}
                ${select({ label: 'Kind', name: 'kind', value: 'note', includeBlank: false,
                           options: optionsFrom(ENTRY_KINDS.filter((k) => k !== 'system') as any, ENTRY_KIND_LABELS as any) })}
                ${field({ label: 'Entry', name: 'body', type: 'textarea', rows: 3, required: true, maxlength: 5000,
                          placeholder: 'What happened, what was advised, what was agreed.' })}
                <button class="btn btn-primary" type="submit">Add to timeline</button>
              </form>` : ''}
              ${entries.length === 0 ? emptyState('No timeline entries yet.') : html`
                <ul class="timeline">
                  ${entries.map((e) => html`
                    <li class="timeline-item">
                      <div class="timeline-meta">
                        ${badge(ENTRY_KIND_LABELS[e.kind] ?? e.kind, e.kind === 'system' ? 'grey' : 'neutral')}
                        <span class="muted small">${dateTime(e.occurred_at)}${e.author_name ? ` · ${e.author_name}` : ''}</span>
                      </div>
                      <div class="timeline-body">${e.body}</div>
                    </li>`)}
                </ul>`}`)}
          </div>

          <div class="col-side">
            ${'' /* Fees are recorded per matter, which is right, but "what does
                     this person owe us" is a question about the person. This
                     answers it without opening every file, and each line leads
                     back to the matter it came from. */}
            ${feesByCase.length > 0 && can(c.get('user'), 'register:read') ? card('Fees', html`
              <dl class="kv">
                <dt>Recorded</dt><dd>${money(feeTotals.gross)}</dd>
                <dt>Invoiced</dt><dd>${money(feeTotals.billed)}</dd>
                <dt>Paid</dt><dd>${money(feeTotals.paid)}</dd>
                <dt>Outstanding</dt>
                <dd class="${feeTotals.owing ? 'warn strong' : ''}">${money(feeTotals.owing)}</dd>
              </dl>
              <ul class="list small mt">
                ${feesByCase.map((row) => html`
                  <li class="list-row">
                    <div><a href="/cases/${row.case_id}"><code>${row.case_ref}</code></a>
                      <div class="muted clamp-1">${row.case_title}</div></div>
                    <div class="num">${money(row.gross)}
                      ${row.gross - row.paid > 0
                        ? html`<div class="muted">${money(row.gross - row.paid)} owing</div>` : ''}</div>
                  </li>`)}
              </ul>`) : ''}

            ${card('Contact', html`
              <dl class="kv">
                ${isOrg ? '' : html`
                  <dt>Given names</dt><dd>${client.given_names ?? '—'}</dd>
                  <dt>Family name</dt><dd>${client.family_name ?? '—'}</dd>
                  <dt>Preferred</dt><dd>${client.preferred_name ?? '—'}</dd>`}
                <dt>Email</dt><dd>${client.email ? html`<a href="mailto:${client.email}">${client.email}</a>` : '—'}</dd>
                <dt>Phone</dt><dd>${client.phone ?? '—'}</dd>
                <dt>WhatsApp</dt><dd>${client.whatsapp ?? '—'}</dd>
                <dt>Telegram</dt><dd>${client.telegram_username ?? client.telegram_user_id ?? '—'}</dd>
                <dt>Address</dt><dd>${client.address ?? '—'}</dd>
              </dl>`)}

            ${isOrg
              ? html`
                ${card('Registration', html`
                  <dl class="kv">
                    <dt>NZBN</dt><dd>${client.nzbn ?? '—'}</dd>
                    <dt>Company no.</dt><dd>${client.company_number ?? '—'}</dd>
                    <dt>Primary contact</dt><dd>${(() => {
                      const primary = people.find((person) => person.id === client.primary_contact_id);
                      return primary
                        ? html`<a href="/clients/${primary.id}">${primary.full_name}</a>`
                        : html`<span class="muted">Not set</span>`;
                    })()}</dd>
                  </dl>`)}

                ${card('People at this organisation', people.length === 0
                  ? emptyState('Nobody linked yet. Open a person’s record and set “Works for”.')
                  : html`
                    <ul class="party-list">
                      ${people.map((person) => html`
                        <li>
                          <div>
                            <a href="/clients/${person.id}">${person.full_name}</a>
                            ${person.id === client.primary_contact_id ? badge('Primary contact', 'green') : ''}
                            <div class="muted small">${person.organisation_role ?? 'Role not recorded'}
                              · <code>${person.ref}</code></div>
                          </div>
                          ${writable && person.id !== client.primary_contact_id
                            ? actionButton(`/clients/${client.id}/primary-contact`, csrf, 'Make primary',
                                { className: 'btn btn-small btn-secondary', fields: { contact_id: person.id } })
                            : ''}
                        </li>`)}
                    </ul>
                    ${writable && client.primary_contact_id
                      ? actionButton(`/clients/${client.id}/primary-contact`, csrf, 'Clear primary contact',
                          { className: 'btn btn-small btn-link-danger', fields: { contact_id: '' } })
                      : ''}`)}`
              : card('Identity and compliance', html`
                  <dl class="kv">
                    ${employer ? html`
                      <dt>Works for</dt><dd><a href="/clients/${employer.id}">${employer.full_name}</a>
                        ${client.organisation_role ? html`<div class="muted small">${client.organisation_role}</div>` : ''}
                        ${employer.primary_contact_id === client.id ? badge('Primary contact', 'green') : ''}</dd>` : ''}
                    <dt>Nationality</dt><dd>${countryName(client.nationality) || '—'}</dd>
                    <dt>Date of birth</dt><dd>${dateShort(client.date_of_birth)}</dd>
                    <dt>Passport</dt><dd>${passports.length === 0
                      ? html`<span class="muted">—</span>`
                      : html`${client.passport_country ?? 'Primary'}${
                          client.passport_expiry ? html` · ${expiryCell(client.passport_expiry, 180)}` : ''}
                             ${passports.length > 1
                               ? html`<div class="muted small"><a href="#passports">${passports.length} passports on file</a></div>`
                               : html`<div class="muted small"><a href="#passports">Details</a></div>`}`}</dd>
                    <dt>Current visa</dt><dd>${labelFor(visaTerms, client.current_visa_type) || '—'}</dd>
                    <dt>Visa expiry</dt><dd>${!client.current_visa_expiry && client.current_visa_expiry_rule
                      ? html`${badge('not yet fixed', 'amber')}
                             <div class="muted small">${client.current_visa_expiry_rule}</div>`
                      : expiryCell(client.current_visa_expiry)}</dd>
                    <dt>Police cert.</dt><dd>${client.police_certificate_country
                      ? html`${client.police_certificate_country}<br>` : ''}${expiryCell(client.police_certificate_expiry)}
                      ${certificateDateUnverified(certificates, 'police', client.police_certificate_expiry)
                        ? badge('unverified date', 'amber') : ''}</dd>
                    <dt>Medical</dt><dd>${expiryCell(client.medical_certificate_expiry)}
                      ${certificateDateUnverified(certificates, 'medical', client.medical_certificate_expiry)
                        ? badge('unverified date', 'amber') : ''}</dd>
                    <dt>Chest x-ray</dt><dd>${expiryCell(client.chest_xray_expiry)}</dd>
                    <dt>English</dt><dd>${client.english_test_type
                      ? html`${labelFor(englishTestTerms, client.english_test_type)}${
                          client.english_test_score ? html` · <strong>${client.english_test_score}</strong>` : ''}
                          ${client.english_test_date
                            ? html`<div class="muted small">Taken ${dateShort(client.english_test_date)}</div>` : ''}`
                      : html`<span class="muted">—</span>`}</dd>
                  </dl>`)}

            ${isOrg ? '' : html`
              <section class="card" id="passports">
                <header class="card-head"><h2>Passports</h2></header>
                <div class="card-body">
                  ${passports.length === 0
                    ? emptyState('No passport recorded yet. The first one is entered on the client\u2019s '
                        + 'own form, under Identity.')
                    : html`<ul class="list">
                        ${passports.map((pp) => html`
                          <li class="list-row">
                            <div>
                              <strong>${pp.country ?? 'Passport'}</strong>
                              ${pp.is_primary === 1 ? badge('primary', 'green') : ''}
                              ${pp.status === 'held' ? '' : badge(passportStatusLabel(pp.status), 'grey')}
                              <div class="small muted">
                                ${pp.number_sealed
                                  ? 'Number on file (encrypted)' : 'No number recorded'}
                                ${pp.issued_on ? html` \u00b7 issued ${dateShort(pp.issued_on)}` : ''}
                                ${pp.expires_on ? html` \u00b7 expires ${dateShort(pp.expires_on)}` : ''}
                              </div>
                              ${pp.notes ? html`<div class="small muted">${pp.notes}</div>` : ''}
                            </div>
                            <div>
                              ${pp.status === 'held' && pp.expires_on ? expiryCell(pp.expires_on, 180) : ''}
                              ${pp.number_sealed
                                ? actionButton(`/clients/${client.id}/passports/${pp.id}/reveal`, csrf,
                                    'Reveal', { className: 'btn btn-small btn-secondary' })
                                : ''}
                              ${writable && pp.is_primary !== 1
                                ? actionButton(`/clients/${client.id}/passports/${pp.id}/primary`, csrf,
                                    'Make primary', { className: 'btn btn-small btn-secondary' })
                                : ''}
                              ${writable && pp.is_primary !== 1
                                ? actionButton(`/clients/${client.id}/passports/${pp.id}/remove`, csrf,
                                    'Remove', { className: 'btn btn-danger btn-small',
                                      confirm: 'Remove this passport from the file?' })
                                : ''}
                            </div>
                          </li>`)}
                      </ul>`}

                  ${writable ? html`
                    <details class="mt">
                      <summary>Add another passport</summary>
                      <form method="post" action="/clients/${client.id}/passports" class="row-form">
                        ${csrfField(csrf)}
                        ${field({ label: 'Country', name: 'country', maxlength: 100,
                                  hint: 'The country that issued it.' })}
                        ${field({ label: 'Number', name: 'number', maxlength: 60,
                                  hint: c.env.FIELD_KEY ? 'Stored encrypted at rest.'
                                    : 'Disabled: FIELD_KEY is not set.' })}
                        ${field({ label: 'Issued', name: 'issued_on', type: 'date' })}
                        ${field({ label: 'Expires', name: 'expires_on', type: 'date' })}
                        ${select({ label: 'Status', name: 'status', value: 'held', includeBlank: false,
                                   options: PASSPORT_STATUSES })}
                        ${field({ label: 'Note', name: 'notes', maxlength: 300 })}
                        <button class="btn btn-primary" type="submit">Add it</button>
                      </form>
                      <p class="hint">The primary passport is edited on the client\u2019s own form.
                         Every passport still marked held is watched for expiry, so a dual national
                         is chased about both. One that has been replaced stays on the file as a
                         record \u2014 a visa may still be stuck in it \u2014 but is not chased.</p>
                    </details>` : ''}
                </div>
              </section>`}

            ${isOrg ? '' : html`
              <section class="card" id="certificates">
                <header class="card-head"><h2>Certificates</h2></header>
                <div class="card-body">
                  ${certificates.length === 0
                    ? emptyState('No police certificate, medical or x-ray recorded yet.')
                    : html`${CERTIFICATE_KINDS.map((kind) => {
                        const mine = certificates.filter((x) => x.kind === kind);
                        if (mine.length === 0) return '';
                        const current = new Set(currentOf(certificates, kind).map((x) => x.id));
                        return html`
                          <p class="subhead">${CERTIFICATE_LABELS[kind]}</p>
                          <ul class="list">
                            ${mine.map((cert) => html`
                              <li class="list-row">
                                <div>
                                  <strong>${cert.country ?? (cert.subtype ? medicalTypeLabel(cert.subtype) : CERTIFICATE_LABELS[kind])}</strong>
                                  ${current.has(cert.id) ? badge('current', 'green') : badge('superseded', 'grey')}
                                  <div class="small muted">
                                    ${cert.issued_on ? html`Issued ${dateShort(cert.issued_on)}` : 'Issue date not recorded'}
                                    ${cert.expires_on ? html` · expires ${dateShort(cert.expires_on)}` : ''}
                                    ${cert.reference ? html` · ${cert.reference}` : ''}
                                  </div>
                                  ${/* Why it expires when it does. The date is worked out by the
                                        database from the issue date and this; saying so on the page
                                        is the difference between a date you trust and one you
                                        re-check against the certificate every time. */ ''}
                                  ${expiryIsDerived(kind) ? html`
                                    <div class="small muted">
                                      ${cert.submitted_on
                                        ? html`Submitted with an application ${dateShort(cert.submitted_on)} —
                                               ${CERTIFICATE_VALIDITY[kind]!.submitted} months from issue.`
                                        : html`Not submitted with an application —
                                               ${CERTIFICATE_VALIDITY[kind]!.held} months from issue.`}
                                    </div>` : ''}
                                  ${/* A date nobody read off the paper must never look like one
                                        somebody did — the expiry above is computed from it. */ ''}
                                  ${issueDateUnverified(cert) ? html`
                                    <div class="small">
                                      ${badge('issue date unverified', 'amber')}
                                      ${cert.issued_on_provenance === 'from_filename'
                                        ? 'Taken from a document’s filename, never confirmed against the certificate.'
                                        : 'Never confirmed against the certificate itself.'}
                                      ${expiryIsDerived(kind) ? 'The expiry shown is worked out from it.' : ''}
                                      ${writable ? html`
                                        <form method="post" class="inline-form mt-sm"
                                              action="/clients/${client.id}/certificates/${cert.id}/confirm-issue-date">
                                          ${csrfField(csrf)}
                                          <button class="btn btn-small btn-secondary" type="submit">
                                            I have checked it against the certificate</button>
                                        </form>` : ''}
                                    </div>` : ''}
                                  ${cert.notes ? html`<div class="small muted">${cert.notes}</div>` : ''}
                                  ${writable && expiryIsDerived(kind) ? html`
                                    <form method="post" class="inline-form mt-sm"
                                          action="/clients/${client.id}/certificates/${cert.id}/submitted">
                                      ${csrfField(csrf)}
                                      <label class="small muted" for="sub-${cert.id}">Submitted with an application on</label>
                                      <input type="date" id="sub-${cert.id}" name="submitted_on"
                                             value="${cert.submitted_on ?? ''}">
                                      <button class="btn btn-small btn-secondary" type="submit">Save</button>
                                    </form>` : ''}
                                </div>
                                <div>
                                  ${cert.expires_on ? expiryCell(cert.expires_on) : ''}
                                  ${writable ? actionButton(`/clients/${client.id}/certificates/${cert.id}/remove`, csrf,
                                      'Remove', { className: 'btn btn-danger btn-small',
                                                  confirm: 'Remove this certificate? Its history goes with it.' }) : ''}
                                </div>
                              </li>`)}
                          </ul>`;
                      })}`}

                  ${writable ? html`
                    <details class="mt">
                      <summary>Record a certificate</summary>
                      <form method="post" action="/clients/${client.id}/certificates" class="row-form">
                        ${csrfField(csrf)}
                        ${select({ label: 'What', name: 'kind', required: true, includeBlank: false,
                                   value: 'police',
                                   options: CERTIFICATE_KINDS.map((k) => ({ value: k, label: CERTIFICATE_LABELS[k] })) })}
                        ${field({ label: 'Country', name: 'country', maxlength: 100,
                                  hint: 'Police certificates only — one per country lived in for 12 months or more.' })}
                        ${select({ label: 'Medical type', name: 'subtype', includeBlank: 'Not a medical',
                                   options: MEDICAL_TYPES })}
                        ${field({ label: 'Issued', name: 'issued_on', type: 'date',
                                  hint: 'Required for a police certificate or a medical.' })}
                        ${select({ label: 'The issue date was', name: 'issued_on_provenance',
                                   value: 'verified', includeBlank: false,
                                   options: PROVENANCE_OPTIONS,
                                   hint: 'The expiry is a legal deadline worked out from this date, '
                                     + 'so the register keeps track of whether it was read off the '
                                     + 'certificate or only inferred. Anything not read from the '
                                     + 'certificate is flagged until somebody checks it.' })}
                        ${field({ label: 'Submitted with an application on', name: 'submitted_on', type: 'date',
                                  hint: 'Leave empty if it has not gone in yet. It can be added later.' })}
                        ${field({ label: 'Expires', name: 'expires_on', type: 'date',
                                  hint: 'X-rays only. A police certificate and a medical are worked '
                                    + 'out from the issue date.' })}
                        ${field({ label: 'Reference', name: 'reference', maxlength: 80 })}
                        ${field({ label: 'Note', name: 'notes', maxlength: 300 })}
                        <button class="btn btn-primary" type="submit">Record it</button>
                      </form>
                      <p class="hint">A new one does not replace the old. The most recent of each
                         kind is marked current and is what the alerts page watches.</p>
                      <p class="hint">INZ works the expiry out rather than reading the one printed on
                         the certificate: a police certificate is
                         ${validityRule('police')} A medical is ${validityRule('medical')}
                         So those two are worked out here too, from the issue date — which means
                         recording that one went in with an application moves its expiry by itself.</p>
                    </details>` : ''}
                </div>
              </section>`}

            ${'' /* Correspondence, read from where it lives rather than copied
                     onto a timeline. A message with two owners disagrees with
                     itself the first time one of them is edited. */}
            ${threads.length > 0
              ? card('Correspondence', html`
                  <ul class="list">${threads.map((t) => html`
                    <li class="list-row">
                      <div>
                        <strong><a href="/inbox/threads/${t.id}">${t.peer_label ?? t.peer_id}</a></strong>
                        ${badge(t.channel, 'grey')}
                        ${t.waiting > 0 ? badge(`${t.waiting} waiting`, 'amber') : ''}
                        ${t.last_body
                          ? html`<div class="muted small clamp-2">${
                              t.last_direction === 'out' ? 'You: ' : ''}${t.last_body}</div>`
                          : ''}
                      </div>
                      <div class="small muted">${dateShort(t.last_message_at)}</div>
                    </li>`)}
                  </ul>`)
              : ''}

            ${otherRoles.length > 0
              ? card('Also a party to', html`
                  <ul class="list">${otherRoles.map((pc) => html`
                    <li><a href="/cases/${pc.case_id}">${pc.case_title}</a>
                        <div class="muted small"><code>${pc.case_ref}</code> ·
                          ${PARTY_ROLE_LABELS[pc.role] ?? pc.role}</div></li>`)}</ul>`)
              : ''}

            ${related.length > 0
              ? card('Related people and organisations', html`
                  <ul class="list">${related.map((rel) => html`
                    <li><a href="/clients/${rel.id}">${rel.full_name}</a>
                        <div class="muted small">${PARTY_ROLE_LABELS[rel.role] ?? rel.role}
                          on <a href="/cases/${rel.via_case_id}">${rel.via_case_ref}</a></div></li>`)}</ul>
                  <p class="hint">Everyone who appears on a matter together — which is how a family
                     group shows itself, without anyone having to maintain a second list.</p>`)
              : ''}

            ${card('Open tasks', tasks.length === 0
              ? emptyState('Nothing outstanding.')
              : html`<ul class="list">${tasks.map((t: any) => html`
                  <li><a href="/tasks#${t.id}">${t.title}</a> <span class="muted small">${dateShort(t.due_at)}</span></li>`)}</ul>`)}

            ${card('Recent inquiries', inquiries.length === 0
              ? emptyState('None recorded.')
              : html`<ul class="list">${inquiries.map((i: any) => html`
                  <li><a href="/inquiries/${i.id}">${i.subject || i.ref}</a>
                      <span class="muted small">${dateShort(i.received_at)}</span></li>`)}</ul>`)}

            ${card('Notes', html`<p class="prewrap">${client.notes || '—'}</p>`)}
          </div>
        </div>`);
    });

    // --- Edit ---------------------------------------------------------------
    r.get('/:id/edit', requirePermission('register:write'), async (c) => {
      const client = await one<ClientRow>(c.env.DB, 'SELECT * FROM clients WHERE id = ?', c.req.param('id')!);
      if (!client) return c.notFound();
      const [users, organisations, tests, passports] = await Promise.all([
        userOptions(c.env), organisationOptions(c.env), englishTests(c.env),
        passportsFor(c.env, client.id)]);
      const englishTestOptions = termOptions(tests);
      const visaTypeOptions = termOptions(await visaTypes(c.env));
      const primary = passports.find((row) => row.is_primary === 1) ?? null;
      return page(c, { title: `Edit ${client.full_name}`, active: '/clients' }, html`
        ${breadcrumbs([{ href: '/clients', label: 'Clients' }, { href: `/clients/${client.id}`, label: client.ref }, { label: 'Edit' }])}
        ${pageHeader(`Edit ${client.full_name}`)}
        ${clientForm(c, { ...client, passport_issued: primary?.issued_on ?? null },
                     users, organisations, englishTestOptions, visaTypeOptions)}`);
    });

    // --- Passports ----------------------------------------------------------
    //
    // The primary one is edited on the client form; these routes are for the
    // second and third. A number is sealed on the way in and never read back
    // except by the reveal route below, one passport at a time.
    r.post('/:id/passports', requirePermission('register:write'), async (c) => {
      const id = c.req.param('id')!;
      const f = new FormReader(await c.req.formData());
      const country = f.optional('country', { max: 100 });
      const number = f.optional('number', { max: 60 });
      const issuedOn = f.date('issued_on');
      const expiresOn = f.date('expires_on');
      const status = f.enum('status', PASSPORT_STATUSES.map((x) => x.value),
        { fallback: 'held' }) as PassportStatus;
      const notes = f.optional('notes', { max: 300 });

      if (!country && !number && !issuedOn && !expiresOn) {
        return redirectWith(c, `/clients/${id}#passports`,
          'A passport needs at least a country, a number or a date.', 'err');
      }
      if (issuedOn && expiresOn && expiresOn < issuedOn) {
        return redirectWith(c, `/clients/${id}#passports`,
          'A passport cannot expire before it was issued.', 'err');
      }

      // Never the primary: that one belongs to the client form, and silently
      // moving it here would change which passport the alerts and the export
      // speak for without anybody asking for that.
      await addPassport(c.env, {
        clientId: id, country, number, issuedOn, expiresOn, status,
        isPrimary: false, notes, userId: c.get('user')!.id,
      });
      await addEntry(c.env, { entityType: 'client', entityId: id, kind: 'system',
        body: `Passport added${country ? ` (${country})` : ''}.`, createdBy: c.get('user')!.id });
      await auditFrom(c, { action: 'client.passport_added', entityType: 'client', entityId: id,
        meta: { country, hadNumber: Boolean(number) } });
      return redirectWith(c, `/clients/${id}#passports`, 'Passport recorded.');
    });

    r.post('/:id/passports/:pid/primary', requirePermission('register:write'), async (c) => {
      const id = c.req.param('id')!;
      const ok = await setPrimaryPassport(c.env, id, c.req.param('pid')!);
      if (ok) {
        await addEntry(c.env, { entityType: 'client', entityId: id, kind: 'system',
          body: 'A different passport was made the primary one.', createdBy: c.get('user')!.id });
        await auditFrom(c, { action: 'client.passport_primary_set', entityType: 'client',
          entityId: id, meta: { passportId: c.req.param('pid') } });
      }
      return redirectWith(c, `/clients/${id}#passports`,
        ok ? 'Primary passport changed.' : 'That passport was not found.', ok ? 'ok' : 'err');
    });

    r.post('/:id/passports/:pid/remove', requirePermission('register:write'), async (c) => {
      const id = c.req.param('id')!;
      const pid = c.req.param('pid')!;
      const target = await passportById(c.env, id, pid);
      if (target?.is_primary === 1) {
        return redirectWith(c, `/clients/${id}#passports`,
          'The primary passport is removed from the client form, not here \u2014 so that the '
          + 'record never ends up with none.', 'err');
      }
      const ok = await removePassport(c.env, id, pid);
      if (ok) {
        await auditFrom(c, { action: 'client.passport_removed', entityType: 'client', entityId: id,
          meta: { country: target?.country ?? null } });
      }
      return redirectWith(c, `/clients/${id}#passports`,
        ok ? 'Passport removed.' : 'That passport was already gone.', ok ? 'ok' : 'err');
    });

    // --- Certificates -------------------------------------------------------
    r.post('/:id/certificates', requirePermission('register:write'), async (c) => {
      const id = c.req.param('id')!;
      const f = new FormReader(await c.req.formData());
      const kind = f.enum('kind', CERTIFICATE_KINDS, { required: true, label: 'What' });
      if (!kind) return redirectWith(c, `/clients/${id}`, 'Choose what kind of certificate.', 'err');

      const issuedOn = f.date('issued_on');
      const submittedOn = f.date('submitted_on');
      const expiresOn = f.date('expires_on');
      const derived = expiryIsDerived(kind as CertificateKind);

      // For a police certificate or a medical the issue date is the whole
      // record: the expiry follows from it, so without one there is nothing to
      // work out and nothing to watch.
      if (derived && !issuedOn) {
        return redirectWith(c, `/clients/${id}#certificates`,
          `A ${CERTIFICATE_LABELS[kind as CertificateKind].toLowerCase()} needs its issue date — `
          + 'the expiry is worked out from it.', 'err');
      }
      if (!derived && !issuedOn && !expiresOn) {
        return redirectWith(c, `/clients/${id}#certificates`,
          'Give at least one date — otherwise there is nothing to watch.', 'err');
      }
      if (submittedOn && issuedOn && submittedOn < issuedOn) {
        return redirectWith(c, `/clients/${id}#certificates`,
          'A certificate cannot have been submitted before it was issued.', 'err');
      }
      if (!derived && issuedOn && expiresOn && expiresOn < issuedOn) {
        return redirectWith(c, `/clients/${id}#certificates`,
          'A certificate cannot expire before it was issued.', 'err');
      }

      await addCertificate(c.env, {
        clientId: id, kind: kind as CertificateKind,
        // A medical's subtype and a police certificate's country belong to
        // different kinds; whichever does not apply is dropped rather than
        // stored against a record it means nothing on.
        subtype: kind === 'medical' ? f.optional('subtype', { max: 40 }) : null,
        country: kind === 'police' ? f.optional('country', { max: 100 }) : null,
        reference: f.optional('reference', { max: 80 }),
        issuedOn,
        // The database refuses a dated row that does not say where its date
        // came from (0040); 'unverified' is the honest fallback for a request
        // that failed to say, not a default anyone is shown.
        issuedOnProvenance: (f.enum('issued_on_provenance',
          PROVENANCE_OPTIONS.map((o) => o.value), { fallback: 'unverified' })
          ?? 'unverified') as IssueDateProvenance,
        submittedOn, expiresOn,
        notes: f.optional('notes', { max: 300 }),
        userId: c.get('user')!.id,
      });
      await addEntry(c.env, {
        entityType: 'client', entityId: id, kind: 'system',
        body: `${CERTIFICATE_LABELS[kind as CertificateKind]} recorded`
          + `${issuedOn ? `, issued ${dateShort(issuedOn)}` : ''}`
          + `${!derived && expiresOn ? `, expiring ${dateShort(expiresOn)}` : ''}.`,
        createdBy: c.get('user')!.id,
      });
      await auditFrom(c, { action: 'client.certificate_added', entityType: 'client', entityId: id,
        meta: { kind, expiresOn } });
      return redirectWith(c, `/clients/${id}#certificates`, 'Certificate recorded.');
    });

    // Whether a certificate went in with an application is usually known after
    // it was recorded, not at the time — so it is its own small form rather
    // than a field you would have to delete and re-enter the certificate to
    // change. It is the only thing about a certificate that can be changed,
    // because it is the only thing that is not a fact about the paper itself.
    r.post('/:id/certificates/:certId/submitted', requirePermission('register:write'), async (c) => {
      const id = c.req.param('id')!;
      const certId = c.req.param('certId')!;
      const f = new FormReader(await c.req.formData());
      const submittedOn = f.date('submitted_on');

      const cert = await one<{ kind: string; issued_on: string | null }>(
        c.env.DB, 'SELECT kind, issued_on FROM client_certificates WHERE id = ? AND client_id = ?',
        certId, id);
      if (!cert) return c.notFound();
      if (submittedOn && cert.issued_on && submittedOn < cert.issued_on) {
        return redirectWith(c, `/clients/${id}#certificates`,
          'A certificate cannot have been submitted before it was issued.', 'err');
      }

      await setCertificateSubmitted(c.env, id, certId, submittedOn);
      const after = await one<{ expires_on: string | null }>(
        c.env.DB, 'SELECT expires_on FROM client_certificates WHERE id = ?', certId);
      await addEntry(c.env, {
        entityType: 'client', entityId: id, kind: 'system',
        body: submittedOn
          ? `${CERTIFICATE_LABELS[cert.kind as CertificateKind]} recorded as submitted with an `
            + `application on ${dateShort(submittedOn)}`
            + `${after?.expires_on ? `; now good until ${dateShort(after.expires_on)}` : ''}.`
          : `${CERTIFICATE_LABELS[cert.kind as CertificateKind]} no longer recorded as submitted`
            + `${after?.expires_on ? `; now good until ${dateShort(after.expires_on)}` : ''}.`,
        createdBy: c.get('user')!.id,
      });
      await auditFrom(c, { action: 'client.certificate_submitted', entityType: 'client', entityId: id,
        meta: { certId, submittedOn } });
      return redirectWith(c, `/clients/${id}#certificates`,
        submittedOn ? 'Noted — the expiry has moved with it.' : 'Cleared.');
    });

    // The way an unverified issue date stops being one: somebody holds the
    // certificate, checks the date, presses the button. One direction only —
    // there is no button to make a verified date doubtful again, because the
    // paper does not stop saying what it says.
    r.post('/:id/certificates/:certId/confirm-issue-date', requirePermission('register:write'), async (c) => {
      const id = c.req.param('id')!;
      const certId = c.req.param('certId')!;
      const cert = await one<{ kind: string; issued_on: string | null }>(
        c.env.DB, 'SELECT kind, issued_on FROM client_certificates WHERE id = ? AND client_id = ?',
        certId, id);
      if (!cert) return c.notFound();

      const ok = await confirmIssueDate(c.env, id, certId);
      if (ok) {
        await addEntry(c.env, {
          entityType: 'client', entityId: id, kind: 'system',
          body: `${CERTIFICATE_LABELS[cert.kind as CertificateKind]} issue date`
            + `${cert.issued_on ? ` (${dateShort(cert.issued_on)})` : ''}`
            + ' confirmed against the certificate.',
          createdBy: c.get('user')!.id,
        });
        await auditFrom(c, { action: 'client.certificate_issue_date_confirmed',
          entityType: 'client', entityId: id, meta: { certId } });
      }
      return redirectWith(c, `/clients/${id}#certificates`,
        ok ? 'Confirmed — the date now counts as read from the certificate.'
           : 'Nothing to confirm on that certificate.', ok ? 'ok' : 'err');
    });

    r.post('/:id/certificates/:certId/remove', requirePermission('register:write'), async (c) => {
      const id = c.req.param('id')!;
      const ok = await removeCertificate(c.env, id, c.req.param('certId')!);
      await auditFrom(c, { action: 'client.certificate_removed', entityType: 'client', entityId: id,
        meta: { ok } });
      return redirectWith(c, `/clients/${id}#certificates`,
        ok ? 'Certificate removed.' : 'That certificate was already gone.', ok ? 'ok' : 'err');
    });

    r.post('/:id', requirePermission('register:write'), async (c) => {
      const id = c.req.param('id')!;
      const user = c.get('user')!;
      const existing = await one<ClientRow>(c.env.DB, 'SELECT * FROM clients WHERE id = ?', id);
      if (!existing) return c.notFound();

      const f = new FormReader(await c.req.formData());
      const v = readClientForm(f);
      if (!f.valid) {
        const [users, organisations, tests] = await Promise.all([
        userOptions(c.env), organisationOptions(c.env), englishTests(c.env)]);
      const englishTestOptions = termOptions(tests);
      const visaTypeOptions = termOptions(await visaTypes(c.env));
        return page(c, { title: 'Edit client', active: '/clients', status: 400 }, html`
          ${pageHeader(`Edit ${existing.full_name}`)}
          ${clientForm(c, { ...existing, ...v } as Partial<ClientRow>, users, organisations, englishTestOptions, visaTypeOptions, f.errors)}`);
      }

      // Three outcomes, and the contradictory one is refused rather than
      // guessed at: replacing a number and removing it are different
      // intentions, and picking one for somebody would be picking wrong half
      // the time.
      if (v.passport_clear && v.passport_number) {
        return redirectWith(c, `/clients/${id}/edit`,
          'Either enter a new passport number or tick to remove the one on file — not both.', 'err');
      }
      await run(
        c.env.DB,
        `UPDATE clients SET kind=?, full_name=?, given_names=?, family_name=?, preferred_name=?,
           nzbn=?, company_number=?, organisation_id=?, organisation_role=?, email=?, phone=?, whatsapp=?, telegram_username=?, telegram_user_id=?,
           nationality=?, date_of_birth=?,
           english_test_type=?, english_test_score=?, english_test_date=?,
           current_visa_type=?, current_visa_expiry=?, current_visa_expiry_rule=?,
           address=?, status=?, assigned_to=?, notes=?, updated_at=?
         WHERE id=?`,
        v.kind, v.full_name, v.given_names, v.family_name, v.preferred_name,
        v.nzbn, v.company_number, v.organisation_id || null, v.organisation_role,
        v.email, v.phone, v.whatsapp, v.telegram_username, v.telegram_user_id,
        v.nationality, v.date_of_birth,
        v.english_test_type, v.english_test_score, v.english_test_date,
        v.current_visa_type, v.current_visa_expiry, v.current_visa_expiry_rule,
        v.address, v.status, v.assigned_to || null, v.notes,
        nowIso(), id,
      );

      // This form owns the primary passport and nothing else about the
      // passports table. A client with none yet gets one made; a client with
      // one gets it changed. Second and third passports are managed on the
      // client's own page, and are left alone here.
      const primary = (await passportsFor(c.env, id)).find((row) => row.is_primary === 1) ?? null;
      const wantsPassport = Boolean(v.passport_number || v.passport_country
        || v.passport_expiry || v.passport_issued);
      if (primary) {
        await updatePassport(c.env, primary.id, {
          clientId: id, country: v.passport_country, number: v.passport_number,
          issuedOn: v.passport_issued, expiresOn: v.passport_expiry,
          status: primary.status, isPrimary: true, notes: primary.notes,
          clearNumber: v.passport_clear, userId: user.id,
        });
      } else if (wantsPassport) {
        await addPassport(c.env, {
          clientId: id, country: v.passport_country, number: v.passport_number,
          issuedOn: v.passport_issued, expiresOn: v.passport_expiry,
          status: 'held', isPrimary: true, notes: null, userId: user.id,
        });
      }

      if (existing.status !== v.status) {
        await addEntry(c.env, { entityType: 'client', entityId: id, kind: 'system',
          body: `Status changed from ${CLIENT_STATUS_LABELS[existing.status]} to ${CLIENT_STATUS_LABELS[v.status]}.`, createdBy: user.id });
      }
      if (existing.full_name !== v.full_name) {
        await addEntry(c.env, { entityType: 'client', entityId: id, kind: 'system',
          body: `Name changed from “${existing.full_name}” to “${v.full_name}”.`, createdBy: user.id });
      }
      // The certificate columns on this row are a cache of client_certificates,
      // and nothing on this form owns them any more. Rebuilding after a save
      // keeps that true by construction rather than by everyone remembering.
      // The passport columns are the same kind of cache; addPassport and
      // updatePassport above have already rebuilt them.
      await refreshClientCache(c.env, id);

      // The encrypted field gets its own entry. A reveal was already recorded
      // specifically; a change was not, which meant you could tell who had
      // looked at a passport number but not who had altered it. The number
      // itself is never written to either the log or the timeline.
      if (v.passport_clear && existing.passport_sealed) {
        await auditFrom(c, { action: 'client.passport_cleared', entityType: 'client', entityId: id });
        await addEntry(c.env, { entityType: 'client', entityId: id, kind: 'system',
          body: 'Passport number removed from the file.', createdBy: c.get('user')!.id });
      } else if (v.passport_number) {
        await auditFrom(c, {
          action: 'client.passport_set', entityType: 'client', entityId: id,
          meta: { replaced: Boolean(existing.passport_sealed) },
        });
        await addEntry(c.env, { entityType: 'client', entityId: id, kind: 'system',
          body: existing.passport_sealed
            ? 'Passport number replaced.' : 'Passport number recorded.',
          createdBy: c.get('user')!.id });
      }
      await auditFrom(c, { action: 'client.updated', entityType: 'client', entityId: id });
      return redirectWith(c, `/clients/${id}`, 'Client updated.');
    });

    // Revealing a passport number is a separate, audited action, and the
    // response is never cached or reachable by a GET a browser might replay.
    // One passport at a time, named in the URL: a client may hold several, and
    // "show me the passport numbers" is not a request the register answers.
    r.post('/:id/passports/:pid/reveal', requirePermission('register:read'), async (c) => {
      const id = c.req.param('id')!;
      const client = await one<ClientRow>(c.env.DB, 'SELECT * FROM clients WHERE id = ?', id);
      if (!client) return c.notFound();
      const passport = await passportById(c.env, id, c.req.param('pid')!);
      if (!passport?.number_sealed || !c.env.FIELD_KEY) {
        return redirectWith(c, `/clients/${id}#passports`, 'No passport number on file.', 'err');
      }
      const value = await unsealField(passport.number_sealed, c.env.FIELD_KEY);
      await auditFrom(c, { action: 'client.passport_revealed', entityType: 'client', entityId: id,
        meta: { passportId: passport.id, country: passport.country } });
      c.header('Cache-Control', 'no-store, private');
      return page(c, { title: 'Passport number', active: '/clients' }, html`
        ${breadcrumbs([{ href: '/clients', label: 'Clients' }, { href: `/clients/${id}`, label: client.ref }, { label: 'Passport' }])}
        ${pageHeader('Passport number',
          `${client.full_name}${passport.country ? ` · ${passport.country}` : ''}`
          + ' · this view has been recorded in the audit log')}
        ${card('Value', value
          ? html`<p class="key-block"><code>${value}</code></p>`
          : html`<p class="alert alert-error">The stored value could not be decrypted with the current key.</p>`)}
        <p><a class="btn btn-secondary" href="${`/clients/${id}#passports`}">Back to client</a></p>`);
    });

    /**
     * A lead and a client are the same record at different stages, so becoming
     * one is a status change rather than a re-keying.
     */
    r.post('/:id/status', requirePermission('register:write'), async (c) => {
      const id = c.req.param('id')!;
      const user = c.get('user')!;
      const existing = await one<ClientRow>(c.env.DB, 'SELECT * FROM clients WHERE id = ?', id);
      if (!existing) return c.notFound();

      const f = new FormReader(await c.req.formData());
      const status = f.enum('status', CLIENT_STATUSES, { required: true, label: 'Status' });
      if (!status) return redirectWith(c, `/clients/${id}`, 'Unknown status.', 'err');

      await run(c.env.DB, 'UPDATE clients SET status = ?, updated_at = ? WHERE id = ?', status, nowIso(), id);
      await addEntry(c.env, { entityType: 'client', entityId: id, kind: 'system',
        body: `Status changed from ${CLIENT_STATUS_LABELS[existing.status]} to ${CLIENT_STATUS_LABELS[status]}.`,
        createdBy: user.id });
      await auditFrom(c, { action: 'client.status_changed', entityType: 'client', entityId: id,
        meta: { from: existing.status, to: status } });
      return redirectWith(c, `/clients/${id}`, `Now recorded as a ${CLIENT_STATUS_LABELS[status].toLowerCase()}.`);
    });

    /**
     * Name (or clear) an organisation's primary contact.
     *
     * SQLite cannot express "must be an individual linked to this
     * organisation" as a constraint across rows, so it is checked here — the
     * only place that sets the column.
     */
    r.post('/:id/primary-contact', requirePermission('register:write'), async (c) => {
      const id = c.req.param('id')!;
      const user = c.get('user')!;
      const org = await one<ClientRow>(c.env.DB, 'SELECT * FROM clients WHERE id = ?', id);
      if (!org) return c.notFound();
      if (org.kind !== 'organisation') {
        return redirectWith(c, `/clients/${id}`, 'Only an organisation has a primary contact.', 'err');
      }

      const f = new FormReader(await c.req.formData());
      const contactId = f.optional('contact_id', { max: 60 });

      if (!contactId) {
        await run(c.env.DB, 'UPDATE clients SET primary_contact_id = NULL, updated_at = ? WHERE id = ?', nowIso(), id);
        await auditFrom(c, { action: 'client.primary_contact_cleared', entityType: 'client', entityId: id });
        return redirectWith(c, `/clients/${id}`, 'Primary contact cleared.');
      }

      const contact = await one<ClientRow>(c.env.DB, 'SELECT * FROM clients WHERE id = ?', contactId);
      if (!contact || contact.kind !== 'individual' || contact.organisation_id !== id) {
        return redirectWith(c, `/clients/${id}`,
          'A primary contact must be a person already linked to this organisation.', 'err');
      }

      await run(c.env.DB, 'UPDATE clients SET primary_contact_id = ?, updated_at = ? WHERE id = ?',
        contactId, nowIso(), id);
      await addEntry(c.env, { entityType: 'client', entityId: id, kind: 'system',
        body: `${contact.full_name} named as the primary contact.`, createdBy: user.id });
      await addEntry(c.env, { entityType: 'client', entityId: contactId, kind: 'system',
        body: `Named as the primary contact for ${org.full_name}.`, createdBy: user.id });
      await auditFrom(c, { action: 'client.primary_contact_set', entityType: 'client', entityId: id,
        meta: { contactId } });
      return redirectWith(c, `/clients/${id}`, `${contact.full_name} is now the primary contact.`);
    });

    r.post('/:id/entries', requirePermission('register:write'), async (c) => {
      const id = c.req.param('id')!;
      const user = c.get('user')!;
      const exists = await one<{ id: string }>(c.env.DB, 'SELECT id FROM clients WHERE id = ?', id);
      if (!exists) return c.notFound();

      const f = new FormReader(await c.req.formData());
      const kind = f.enum('kind', ENTRY_KINDS, { fallback: 'note' })!;
      const body = f.text('body', { required: true, label: 'Entry', max: 5000 });
      if (!f.valid) return redirectWith(c, `/clients/${id}`, Object.values(f.errors)[0]!, 'err');

      await addEntry(c.env, { entityType: 'client', entityId: id, kind, body, createdBy: user.id });
      await run(c.env.DB, 'UPDATE clients SET updated_at = ? WHERE id = ?', nowIso(), id);
      await auditFrom(c, { action: 'client.entry_added', entityType: 'client', entityId: id, meta: { kind } });
      return redirectWith(c, `/clients/${id}`, 'Timeline updated.');
    });

    app.route('/clients', r);
  },
};
