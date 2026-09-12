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
import type { Context } from 'hono';
import type { AppContext, Env } from '../../types';
import type { AppModule } from '../../core/module';
import { searchTerms } from '../../core/search';
import { all, nextRef, nowIso, one, run } from '../../core/db';
import { newId } from '../../core/ids';
import { requireAuth, requirePermission } from '../../core/auth';
import { auditFrom } from '../../core/audit';
import { FormReader } from '../../core/validate';
import { page, redirectWith, breadcrumbs } from '../../ui/layout';
import { html, raw, type Raw } from '../../ui/html';
import { limitFor, pageNumberFor, pageSizeFor, pager } from '../../ui/pager';
import {
  actionButton, badge, card, csrfField, emptyState, errorList, field, flagBand, flagHistory, flagRaiser, foldingCard, optionsFrom, pageHeader, select, stamp, statusTone, table, timelineItem,
  testDataBand,
} from '../../ui/components';
import {
  ageYears, dateInputValue, dateOrDateTime, dateShort, dateTime, isOverdue, money, relativeDays,
  truncate,
} from '../../ui/format';
import {
  CASE_STATUS_LABELS, CLIENT_STATUSES, CLIENT_STATUS_LABELS,
  ENTRY_KIND_LABELS, type EntryKind, PARTY_ROLE_LABELS,
  QUOTE_STATUS_LABELS, type ClientStatus,
} from '../../domain';
import { organisationOptions, userOptions } from '../../core/lookups';
import { emailsForEntity, mailLinkFor, recordMailHref } from '../../mail/stored';
import {
  CORRECTION_WINDOW_MINUTES, addEntry, correctable, listEntries,
} from '../../core/timeline';
import { casesForClient, relatedClients } from '../../core/parties';
import { can } from '../../core/rbac';
import { clientDeleteCard, deleteRefusal } from '../../core/deletes';
import { preferencesFor } from '../../core/preferences';
import {
  caseTypes, docCategories, englishTests, genders, isTerm, labelFor, noteKindLabel, noteKinds,
  relationshipStatuses, termOptions, titles, visaTypes, vocabulary,
  EDUCATION_LEVEL_VOCAB, EDUCATION_OUTCOME_VOCAB, EMPLOYMENT_KIND_VOCAB,
  TRAVEL_MODE_VOCAB, TRAVEL_PURPOSE_VOCAB, type Term,
} from '../../core/vocabulary';
import { renameMattersFor } from '../../core/casename';
import { detachTag, attachTag, findOrCreateTag, listTags, tagsForClient, tagsForClients } from '../../core/tags';
import { filesPanel, listDocuments, readingSourcesForClient } from '../documents';
import { CLIENT_READING, readingCard, registerReadingRoutes } from '../../core/reading';
import { isAiEnabled } from '../../ai/provider';
import { driveConfigured } from '../../integrations/gdrive';
import { countryCodeFor, countryName, countryOptions } from '../../core/countries';
import {
  HISTORIES, historyPanel, militaryQuestions, registerHistoryRoutes, type HistoryVocab,
} from './histories';
import { allHistories } from '../../core/histories';
import { FLAG_LIVES, flagKinds, flagsForClient, isShowing } from '../../core/flags';
import {
  MAX_NATIONALITIES, nationalitiesByClient, nationalitiesFor, nationalityFieldNames,
  normaliseCodes, setNationalityStatements,
} from '../../core/nationalities';
import { threadsFor } from '../../core/channels';
import {
  CERTIFICATE_KINDS, CERTIFICATE_LABELS, MEDICAL_TYPES, type CertificateKind,
  CERTIFICATE_VALIDITY, PROVENANCE_OPTIONS, type CertificateRow, type IssueDateProvenance,
  addCertificate, certificateChanges, certificatesFor, confirmIssueDate, currentOf, expiryIsDerived,
  issueDateUnverified, medicalTypeLabel,
  refreshClientCache, removeCertificate, setCertificateSubmitted, updateCertificate, validityRule,
} from '../../core/certificates';
import {
  PASSPORT_STATUSES, type PassportStatus,
  addPassport, passportById, passportStatusLabel, passportsFor, removePassport,
  setPrimaryPassport, updatePassport,
} from '../../core/passports';
import { composeFullName, familyNameFor, givenNamesFor, plainAscii, splitFullName, type ClientKind } from '../../core/names';
import { dormantClients, stillDormant, type DormantClient } from '../../core/dormant';
import {
  fetchEntity, isValidNzbnFormat, normaliseNzbn, nzbnConfigured, searchEntities,
} from '../../integrations/nzbn';

export interface ClientRow {
  /**
   * 1 when this is test data — a record the practice is only trying things
   * with, which Admin → Test data will delete. See migration 0083.
   */
  is_test: number;

  id: string; ref: string; kind: ClientKind; full_name: string; preferred_name: string | null;
  given_names: string | null; family_name: string | null;
  nzbn: string | null; company_number: string | null;
  organisation_id: string | null; organisation_role: string | null;
  primary_contact_id: string | null;
  email: string | null; phone: string | null; whatsapp: string | null;
  telegram_username: string | null; telegram_user_id: string | null;
  date_of_birth: string | null; passport_number: string | null;
  passport_country: string | null; passport_expiry: string | null;
  police_certificate_date: string | null; police_certificate_expiry: string | null;
  police_certificate_country: string | null;
  medical_certificate_date: string | null; medical_certificate_expiry: string | null;
  chest_xray_expiry: string | null;
  english_test_type: string | null;
  english_test_score: string | null;
  english_test_date: string | null;
  current_visa_type: string | null; current_visa_start: string | null;
  current_visa_expiry: string | null;
  current_visa_expiry_rule: string | null;
  current_visa_conditions: string | null;
  current_visa_stay_limit: string | null;
  inz_client_number: string | null;
  /**
   * The flat facts an application form asks for and nothing here held until
   * migration 0084. Every one of them is a plain fact about the person, so it
   * is a column here like everything else on this record. `title`, `gender` and
   * `relationship_status` are vocabulary keys, edited in Settings; the two
   * country columns are ISO codes like every other country in the register.
   *
   * `other_names` is *not* middle names — `given_names` is where those go and
   * always has been. This is the separate question INZ asks: other names the
   * person has actually used.
   */
  title: string | null; gender: string | null; relationship_status: string | null;
  other_names: string | null;
  birth_country: string | null; birth_region: string | null; birth_town: string | null;
  national_id_number: string | null; national_id_country: string | null;
  /**
   * Section D of INZ 1200, added 12 September 2026 (migration 0099). Three
   * questions, each `yes`, `no`, or NULL for one nobody has asked yet — and the
   * explanation the form demands where the answer to the third is yes.
   */
  military_compulsory: string | null; military_served: string | null;
  military_exempt: string | null; military_exemption_detail: string | null;
  address: string | null; status: ClientStatus; assigned_to: string | null; notes: string | null;
  created_at: string; updated_at: string; created_by: string | null;
}


/** Show a date with a warning when it has passed or is close. */
/**
 * The same date, inline, for a sentence rather than a column.
 *
 * `expiryCell` puts the relative age in a `<div>`, which is right in a table
 * cell and wrong in the middle of a line. Reported 12 September 2026: the
 * derived expiry of a certificate belongs on the line that states the rule it
 * came from — *"'Submitted 12 Aug 2026 · 24 months from issue' should also say
 * the actual calculated end date"* — and that line is prose.
 */
/**
 * The blocks that are open when a client's page is drawn.
 *
 * Everything started closed on 12 September 2026, which went a step too far and
 * the practice said so the same day: *"Cases Quotes Passports and Certificates
 * should be open by default."* Those four are what the page is opened *for* —
 * what is running, what was quoted, and the two sets of dates that decide
 * whether a matter can be lodged. A heading is the right treatment for a block
 * you go to occasionally, not for the reason you came.
 *
 * What stays closed: files, the three histories, military records, and the file
 * notes. Those are things you go looking for, and the file notes alone can run
 * for pages.
 *
 * Not remembered between visits, for the reason the calendar and the matter
 * page give: a block missing because of something you did on another client
 * last week is worse than one you open again.
 */
const OPEN_BY_DEFAULT = ['cases', 'quotes', 'passports', 'certificates'];

/**
 * One block on a client's page: a heading that opens, with a name a link can
 * ask for. See `openBlocks` in the detail route for why the name is a query
 * rather than a fragment.
 */
function block(id: string, open: Set<string>, title: string, body: Raw): Raw {
  return html`<div id="${id}">${foldingCard(title, body, undefined, { open: open.has(id) })}</div>`;
}

/**
 * How long an English test result is accepted for, in months.
 *
 * Two years is the ordinary rule and the one the form has always stated in its
 * own hint. **Asked for on 12 September 2026:** *"the side panels should also
 * calculate the english cert duration - it is valid for 2 years from the issue
 * date."*
 *
 * Worked out on the page rather than stored, and deliberately: it is a function
 * of the test date and nothing else, so a stored copy would be a second owner
 * of a fact that already has one, and it would be the copy that went stale. One
 * fact, one owner.
 *
 * Nothing alerts on it. It is arithmetic put in front of somebody who would
 * otherwise do it in their head, which is the same reason the age sits beside
 * the date of birth.
 */
const ENGLISH_TEST_MONTHS = 24;

/**
 * The only two answers to a question on INZ 1200 Section D.
 *
 * Not a vocabulary, and it is the one list in the register that is not. Every
 * dropdown the practice uses is an administrator's, because those are the words
 * *this practice* works in; these two words are the form's, and a third one
 * added here would be an answer nobody could write on it. The database refuses
 * anything else (migration 0099), which it could not do if the list were a
 * setting somebody edits.
 *
 * A question nobody has answered is neither of these — it is NULL, and it shows
 * as "Not answered".
 */
export const MILITARY_ANSWERS = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];

function englishExpiry(taken: string | null): string | null {
  if (!taken) return null;
  const d = new Date(`${taken}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCMonth(d.getUTCMonth() + ENGLISH_TEST_MONTHS);
  return d.toISOString().slice(0, 10);
}

function expiryInline(value: string, warnDays = 90): Raw {
  const due = Date.parse(value);
  const soon = !Number.isNaN(due) && due - Date.now() < warnDays * 86_400_000;
  return html`<strong class="${isOverdue(value) ? 'warn' : ''}">${dateShort(value)}</strong>${
    soon ? html` <span class="muted">(${relativeDays(value)})</span>` : ''}`;
}

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
/**
 * A client's nationalities are not a column on the row, so they travel beside
 * it — into the form, and out of it — rather than being folded into the row
 * type and looking like one. See `core/nationalities.ts`.
 */
type ClientFormValues = Partial<ClientRow> & {
  passport_issued?: string | null;
  nationalities?: string[];
};

/**
 * Every editable list this form offers, read once.
 *
 * Passed to `clientForm` *and* to `readClientForm`, deliberately together: the
 * list somebody chose from and the list their choice is checked against have to
 * be the same list. Read twice, an administrator editing a vocabulary between
 * the two reads would have the form refuse a value it had just offered.
 */
interface ClientVocabularies {
  englishTests: Term[];
  visaTypes: Term[];
  titles: Term[];
  genders: Term[];
  relationshipStatuses: Term[];
}

async function clientVocabularies(env: Env): Promise<ClientVocabularies> {
  const [english, visas, titleTerms, genderTerms, statusTerms] = await Promise.all([
    englishTests(env), visaTypes(env), titles(env), genders(env), relationshipStatuses(env),
  ]);
  return {
    englishTests: english, visaTypes: visas, titles: titleTerms,
    genders: genderTerms, relationshipStatuses: statusTerms,
  };
}

function clientForm(
  c: any,
  values: ClientFormValues,
  users: Array<{ value: string; label: string }>,
  organisations: Array<{ value: string; label: string }>,
  vocab: ClientVocabularies,
  errors?: Record<string, string>,
): Raw {
  const csrf = c.get('session').csrf;
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
    <form method="post" action="${action}" class="form-grid js-client-form js-tabbed" data-tabs="client" data-draft>
      ${csrfField(csrf)}
      <div class="form-section" data-panel="who">
        <h3>Who this is</h3>
        ${select({ label: 'Record type', name: 'kind', value: kind, includeBlank: false,
                   options: [{ value: 'individual', label: 'Individual' },
                             { value: 'organisation', label: 'Company or organisation' }] })}
        ${'' /* Lead or client, on the first panel, because it is part of who
                 somebody is rather than how their file is run.

                 It has always been on this form — as "Status", fifth tab along,
                 under a heading called "File management" — and the practice
                 reported on 8 September that they could not choose it when
                 creating a client. They were right about the thing that
                 matters: a control you cannot find is a control you do not
                 have, and the first question about a new record is which of the
                 two it is. */}
        ${select({ label: 'Lead or client', name: 'status', value: values.status ?? 'prospect',
                   includeBlank: false,
                   options: optionsFrom(CLIENT_STATUSES, CLIENT_STATUS_LABELS),
                   hint: values.id
                     ? 'Change this when a lead engages, or when a file goes quiet.'
                     : 'A lead is somebody who has enquired. Change it to Client when they engage.' })}

        ${'' /* Marked hidden by the server, not only by the script: a company
                 has no passport and a person has no NZBN, and the wrong half of
                 this form should never be on the page — with scripting or
                 without it. The script re-computes this when the record type
                 changes without a reload. */}
        <div data-kind="individual" ${kind === 'individual' ? '' : raw('hidden')}>
          ${'' /* How they are addressed. First because it is first on the form
                   and first in a letter, and a vocabulary rather than a fixed
                   list because the honorifics a practice uses are its own
                   business — a client who is a doctor or a professor should not
                   need a deployment to be addressed properly. */}
          ${select({ label: 'Title', name: 'title', value: values.title ?? '',
                     options: termOptions(vocab.titles), includeBlank: 'Not recorded' })}
          ${field({ label: 'Given names', name: 'given_names', value: givenNames, maxlength: 120,
                    hint: 'As they appear in the passport, including any middle names.' })}
          ${'' /* Not marked required in the HTML, deliberately. This box lives in
                   the individual half of the form, and when the record type is a
                   company that half is hidden. A hidden field the browser thinks
                   is required can never be satisfied and can never be shown, so
                   the browser silently refuses to submit and the Create button
                   does nothing at all — which is exactly what it did.

                   The rule it broke: a required field must never sit inside a
                   block that can be hidden. The server still requires a family
                   name for a person (readClientForm), so a person saved without
                   one comes back with the error against the box rather than a
                   dead button. */}
          ${field({ label: 'Family name', name: 'family_name', value: familyName, maxlength: 120 })}
          ${field({ label: 'Preferred name', name: 'preferred_name', value: values.preferred_name, maxlength: 120,
                    hint: 'What to call them in conversation, if different.' })}
          ${'' /* INZ asks this separately from the given names, and it is not a
                   box for middle names: those go in "Given names" and always
                   have. This is for names the person has actually used and been
                   documented under — a maiden name, a name before a legal
                   change, a name their old passport spells differently. Free
                   text because the answer is: "also as Oanh TRUONG-SMITH until
                   2019" has no fields. */}
          ${field({ label: 'Other names ever used', name: 'other_names', type: 'textarea',
                    value: values.other_names, rows: 2, maxlength: 500,
                    hint: 'A maiden name, a name before a legal change, a different spelling on an '
                      + 'older document. Not middle names \u2014 those belong in Given names.' })}
          ${'' /* One box per nationality held, and always one spare. Dual and
                   triple nationality are ordinary in immigration work — they
                   decide whether somebody needs a visa at all, which police
                   certificates are required, and which passport the
                   application is made on — so a register that holds one holds
                   the wrong thing.

                   Boxes rather than a multi-select: picking several from one
                   list means ctrl-clicking, which is a developer's gesture. A
                   spare box rather than an "add another" button: the content
                   policy forbids an inline script, and a control that stops
                   working when script is blocked is a field nobody can reach.
                   Fill the spare, save, and the next one appears. */}
          ${nationalityFieldNames(values.nationalities?.length ?? 0).map((name, i) => select({
            label: i === 0 ? 'Nationality' : `Nationality ${i + 1}`,
            name, value: values.nationalities?.[i] ?? '', options: countryOptions(),
            includeBlank: i === 0 ? 'Not recorded' : 'None',
            hint: i === 0
              ? 'Held as an ISO 3166-1 country code, so it can be counted and filtered.'
              : (i === (values.nationalities?.length ?? 0)
                  ? 'Fill this in and save to add another.' : undefined),
          }))}
          ${field({ label: 'Date of birth', name: 'date_of_birth', type: 'date', value: dateInputValue(values.date_of_birth) })}

          ${'' /* Three boxes and not one, because INZ asks three and answers
                   them separately \u2014 a province is not a city, and "Nghe An,
                   Vinh" typed into one box cannot be taken apart again. Kept in
                   a group of their own so they do not scatter into three
                   different rows with a field between them.

                   The country is a code from the same list as nationality and
                   passport country, and the database refuses one that is not on
                   it (migration 0084). */}
          <fieldset class="field-group">
            <legend>Place of birth</legend>
            ${select({ label: 'Country of birth', name: 'birth_country',
                       value: values.birth_country ?? '', options: countryOptions(),
                       includeBlank: 'Not recorded' })}
            ${field({ label: 'Region, state or province', name: 'birth_region',
                      value: values.birth_region, maxlength: 120 })}
            ${field({ label: 'Town or city', name: 'birth_town',
                      value: values.birth_town, maxlength: 120 })}
          </fieldset>

          ${'' /* Both are lists an administrator owns, not enums in the code.
                   Gender is seeded with Immigration New Zealand's own three
                   values so what is recorded here matches what the form asks
                   for; relationship status decides a whole category of
                   application, and "Separated" is a different answer from
                   "Divorced". */}
          ${select({ label: 'Gender', name: 'gender', value: values.gender ?? '',
                     options: termOptions(vocab.genders), includeBlank: 'Not recorded' })}
          ${select({ label: 'Relationship status', name: 'relationship_status',
                     value: values.relationship_status ?? '',
                     options: termOptions(vocab.relationshipStatuses),
                     includeBlank: 'Not recorded' })}

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
        ${field({ label: 'Passport number', name: 'passport_number', value: '',
                  hint: values.passport_number
                    ? `On file: ${values.passport_number}. Enter a new one to replace it, or leave blank to keep it.`
                    : undefined })}
        ${values.passport_number ? html`
          <div class="field checkbox-field">
            <label><input type="checkbox" name="passport_clear" value="1">
              Remove the number on file</label>
            <p class="hint">For one entered against the wrong person. Leaving the box above
               blank keeps what is stored; this is the only way to take it out.</p>
          </div>` : ''}
        ${select({ label: 'Passport country', name: 'passport_country',
                   value: values.passport_country ?? '', options: countryOptions(),
                   includeBlank: 'Not recorded',
                   hint: 'The country that issued it. Held as a country code, like nationality, '
                     + 'so passports can be counted and matched.' })}
        ${field({ label: 'Passport issued', name: 'passport_issued', type: 'date',
                  value: dateInputValue(values.passport_issued ?? null) })}
        ${field({ label: 'Passport expiry', name: 'passport_expiry', type: 'date', value: dateInputValue(values.passport_expiry),
                  hint: 'Watched on the alerts page — a passport expiring mid-application stalls it.' })}
        ${'' /* A passport is not the only identity document a client carries,
                 and the one that turned up on 11 September 2026 was a
                 Vietnamese Citizen Identity Card whose number had nowhere to
                 go. Two boxes and never one: a twelve-digit number is a
                 Vietnamese CCCD, an Indian Aadhaar or a typing slip depending
                 entirely on who issued it. The database refuses either half on
                 its own \u2014 see migration 0084 \u2014 and the server says so
                 against the box before it gets that far. */}
        <fieldset class="field-group">
          <legend>National identity card</legend>
          ${field({ label: 'National identity number', name: 'national_id_number',
                    value: values.national_id_number, maxlength: 60,
                    hint: 'A national ID card number where the country issues one \u2014 a Vietnamese '
                      + 'Citizen Identity Card, an Indian Aadhaar. Not the passport.' })}
          ${select({ label: 'Country that issued it', name: 'national_id_country',
                     value: values.national_id_country ?? '', options: countryOptions(),
                     includeBlank: 'Not recorded',
                     hint: 'Required with the number, and refused without it: a number nobody can '
                       + 'say the issuer of cannot be put on a form.' })}
        </fieldset>
        <div class="settings-cell-wide">
          <p class="hint">These boxes are the <strong>primary</strong> passport — the travel document
             this file works from. A client may hold more than one: a dual national holds two at
             once, and someone who has just renewed holds the new one plus the old one carrying a
             live visa. Second and third passports are kept on the client's own
             page${values.id ? html` — <a href="/clients/${values.id}?open=passports#passports">add one there</a>` : ''},
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
          ${'' /* First in the block because it is the first thing quoted to INZ
                   about a person, and because the practice asked for it by name
                   on 8 September 2026: "every individual client must have INZ
                   Client Number". It used to be typed onto every matter
                   separately, which is how one client ended up with two. */}
          <div class="settings-cell">${field({ label: 'INZ client number', name: 'inz_client_number',
            value: values.inz_client_number ?? '', maxlength: 20, inputmode: 'numeric',
            hint: 'Digits only. One per person, issued by INZ and never changed \u2014 so it '
              + 'lives here rather than on each matter, and every matter reads it from here. '
              + 'Leave it blank only until INZ has issued one.' })}</div>
          <div class="settings-cell">${select({ label: 'Current visa', name: 'current_visa_type',
            value: values.current_visa_type ?? '', options: termOptions(vocab.visaTypes),
            includeBlank: 'Not recorded',
            hint: 'What they hold now, not what is being applied for. “None — offshore” is an '
              + 'answer, and so is “None — unlawful”.' })}</div>
          ${'' /* Reported 10 September 2026: *"I am not able to enter their
                   NZ immigration status??? type of visa they hold, issue date
                   and expiry date?"* The type and the expiry were here; the
                   issue date had never been built. Almost every question about
                   a temporary visa is about the period rather than its end —
                   maximum continuous stay is counted from the start, and
                   reading an interim visa needs both ends — and it was being
                   answered from the file notes. */}
          <div class="settings-cell">${field({ label: 'Current visa issued', name: 'current_visa_start', type: 'date', value: dateInputValue(values.current_visa_start),
            hint: 'The date this visa was granted. Maximum continuous stay is counted from here.' })}</div>
          <div class="settings-cell">${field({ label: 'Current visa expiry', name: 'current_visa_expiry', type: 'date', value: dateInputValue(values.current_visa_expiry) })}</div>
          <div class="settings-cell">${field({ label: 'Expiry rule, if no date is fixed yet',
            name: 'current_visa_expiry_rule', maxlength: 200,
            value: values.current_visa_expiry_rule ?? '',
            hint: 'Some grants have no date until an event happens — “24 months after first '
              + 'arrival in New Zealand”. Record the rule here; the register shows the expiry '
              + 'as not yet fixed and prompts for the date once the event has happened.' })}</div>
          ${'' /* Both asked for on 11 September 2026, and both deliberately
                   plain text that nothing counts from. A stay limit becomes a
                   date only when somebody crosses a border, and the register
                   does not know when they did: *"we often do not know when the
                   person is entering the country - so do not want to be flooded
                   with alerts and warnings."* Nothing here is ever read by the
                   alerts. See migration 0088. */}
          <div class="settings-cell">${field({ label: 'Stay limit',
            name: 'current_visa_stay_limit', maxlength: 300,
            value: values.current_visa_stay_limit ?? '',
            hint: 'As the grant states it — “4 months per entry, 6 months in any 12”. '
              + 'Nothing is counted from it and nothing alerts on it.' })}</div>
          <div class="settings-cell-wide">${field({ label: 'Visa conditions',
            name: 'current_visa_conditions', type: 'textarea', rows: 3, maxlength: 2000,
            value: values.current_visa_conditions ?? '',
            hint: 'What the grant allows and forbids, in its own words.' })}</div>

          <p class="settings-head subhead">Character and health</p>
          <div class="settings-cell-wide">
            ${'' /* A way through, not a paragraph explaining where to go. These
                     are the documents a file turns on, and pointing at them in
                     small grey text was treating them as a footnote. They are
                     still records rather than boxes, and that is the part that
                     cannot change: a client may hold police certificates from
                     three countries at once, and a new medical must not
                     overwrite the one a March application relied on — that has
                     to stay answerable. A single set of dates here could
                     represent neither. */}
            ${values.id
              ? html`<p><a class="btn btn-secondary" href="/clients/${values.id}?open=certificates#certificates">Add
                       a police certificate, medical or x-ray</a></p>
                     ${'' /* Both branches used to explain why certificates are records
                             rather than boxes — a client may hold several at once, and a
                             new one must never overwrite the one an application relied on.
                             Still true, still the reason; no longer on the screen. */}
                     <p class="hint">A new one never replaces the old.</p>`
              : html`<p class="hint">Added on the client's own page, once this record exists.</p>`}
          </div>

          ${'' /* **Asked for on 12 September 2026:** *"yes build the three
                   questions."* Section D of INZ 1200, and they sit in this block
                   because that is where the questions INZ assesses a person on
                   already live — immigration, character, health and English.

                   Three dropdowns rather than three vocabularies, which is the
                   exception to the standing rule that every list is an
                   administrator's: the answers belong to INZ's form, not to this
                   practice, and an administrator who added "Perhaps" would be
                   recording an answer that cannot be written on it. The database
                   says the same thing — see migration 0099.

                   "Not answered" is the state every client starts in and is not
                   the same as "No". On a character question that difference is
                   the whole point. */}
          <p class="settings-head subhead">Military service</p>
          <div class="settings-cell">${select({
            label: 'Has military service ever been compulsory in their home country?',
            name: 'military_compulsory', value: values.military_compulsory ?? '',
            options: MILITARY_ANSWERS, includeBlank: 'Not answered' })}</div>
          <div class="settings-cell">${select({
            label: 'Have they ever undertaken military service in any country?',
            name: 'military_served', value: values.military_served ?? '',
            options: MILITARY_ANSWERS, includeBlank: 'Not answered',
            hint: values.id
              ? 'Each period goes in Military service on their own page.'
              : 'Each period goes in Military service on their page, once this record exists.' })}</div>
          <div class="settings-cell">${select({
            label: 'Were they exempt from military service?',
            name: 'military_exempt', value: values.military_exempt ?? '',
            options: MILITARY_ANSWERS, includeBlank: 'Not answered' })}</div>
          <div class="settings-cell-wide">${field({
            label: 'How they came to be exempt', name: 'military_exemption_detail',
            type: 'textarea', rows: 3, maxlength: 2000,
            value: values.military_exemption_detail ?? '',
            hint: 'The form asks for a detailed explanation, so this is where it goes. It can '
              + 'only be filled in where the answer above is yes.' })}</div>

          <p class="settings-head subhead">English</p>
          <div class="settings-cell">${select({ label: 'Test or exemption', name: 'english_test_type',
                    value: values.english_test_type ?? '', options: termOptions(vocab.englishTests),
                    includeBlank: 'Not recorded' })}</div>
          <div class="settings-cell">${field({ label: 'Score', name: 'english_test_score', value: values.english_test_score, maxlength: 40,
                    hint: 'As the certificate states it — 6.5, 58, B2. The tests do not share a scale.' })}</div>
          <div class="settings-cell">${field({ label: 'Test date', name: 'english_test_date', type: 'date', value: dateInputValue(values.english_test_date),
                    hint: 'Most results are accepted for two years.' })}</div>
        </div>
      </div>

      <div class="form-section" data-panel="file">
        <h3>File management</h3>
        ${'' /* Lead or client used to be here. It moved to "Who this is" on
                 8 September — see the note there. What is left is how the file
                 is run, which is what this panel is for. */}
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
 * The two halves of a national identity number, refused unless both are there.
 *
 * The rule is the database's (migration 0084) and this is only the place that
 * makes it say so against the right box. Without it a person who fills the
 * number and forgets the country gets a 500 from a trigger, which tells them
 * nothing and loses the rest of what they typed.
 *
 * A number with no country identifies nobody: twelve digits are a Vietnamese
 * CCCD, an Indian Aadhaar or a typing slip depending entirely on who issued
 * them. A country with no number says even less.
 */
/**
 * A refusal the database made, in words a person can act on.
 *
 * **Reported 12 September 2026**, saving a client with the two visa dates the
 * wrong way round: *"this is what appeared when i pressed save - annoying."*
 * The database was right to refuse it. What was wrong was everything after:
 * the refusal came back as *Something went wrong*, a reference number, and a
 * lost form.
 *
 * Every rule the form can break is checked before the write as well, so this is
 * the net rather than the floor. It exists because the rules live in the
 * database — which is the point of them — and the database grows rules that a
 * form written a year earlier does not know about. The one that gets added
 * without a matching check here should cost somebody a sentence, not an
 * afternoon's typing.
 *
 * D1 wraps a trigger's words as `D1_ERROR: <message>: SQLITE_CONSTRAINT ...`,
 * so the message is cut back out of it. Anything that is not a constraint is
 * rethrown: a refusal is a thing to say, and a fault is a thing to log.
 */
export function refusalMessage(err: unknown): string | null {
  const raw = err instanceof Error ? err.message : String(err);
  if (!/SQLITE_CONSTRAINT/.test(raw)) return null;
  const said = /^D1_ERROR:\s*(.+?):\s*SQLITE_CONSTRAINT/.exec(raw)?.[1]?.trim();
  if (!said) return 'The register would not accept that. Check the dates and try again.';
  // The database writes its refusals in lower case, mid-sentence. On a screen
  // it is the whole sentence.
  return `${said.charAt(0).toUpperCase()}${said.slice(1)}.`;
}

/**
 * The three answers about military service, and the explanation of an
 * exemption.
 *
 * The rule is the database's (migration 0099) and this only makes it say so
 * against the right box: an explanation of how somebody came to be exempt,
 * saved against "no, they were not exempt", is a contradiction that would go
 * onto a form. Without this the person who answers yes, types the explanation,
 * then corrects the answer to no gets a refusal with no box named and loses the
 * rest of what they typed.
 *
 * It runs one way only, like the trigger: an exemption with the explanation not
 * yet typed is an ordinary half-filled record and saves.
 *
 * `f.enum` rather than `f.optional`, so a request built by hand carrying
 * "maybe" is refused here with a sentence rather than at the trigger with a
 * 500.
 */
function militaryService(f: FormReader): {
  military_compulsory: string | null; military_served: string | null;
  military_exempt: string | null; military_exemption_detail: string | null;
} {
  const answers = ['yes', 'no'] as const;
  const exempt = f.enum('military_exempt', answers, { label: 'Exempt from military service' });
  const detail = f.optional('military_exemption_detail', { max: 2000 });
  if (detail && exempt !== 'yes') {
    f.errors['military_exemption_detail'] =
      'An explanation of an exemption belongs with an answer of yes. '
      + 'Answer yes to the exemption question, or clear the explanation.';
  }
  return {
    military_compulsory: f.enum('military_compulsory', answers,
      { label: 'Military service compulsory' }),
    military_served: f.enum('military_served', answers, { label: 'Military service undertaken' }),
    military_exempt: exempt,
    military_exemption_detail: detail,
  };
}

function nationalIdentity(f: FormReader): {
  national_id_number: string | null; national_id_country: string | null;
} {
  const number = f.optional('national_id_number', { max: 60 });
  const country = countryCodeFor(f.optional('national_id_country', { max: 100 }));
  if (number && !country) {
    f.errors['national_id_country'] = 'Say which country issued the national identity number.';
  }
  if (country && !number) {
    f.errors['national_id_number'] = 'Enter the national identity number, or clear the country.';
  }
  return { national_id_number: number, national_id_country: country };
}

/**
 * Read the client form. The required fields depend on which kind of client it
 * is, and `full_name` is derived rather than accepted from the browser.
 */
function readClientForm(f: FormReader, vocab: ClientVocabularies) {
  const kind = f.enum('kind', ['individual', 'organisation'] as const, { fallback: 'individual' })!;

  /**
   * A value from one of the practice's own lists, or an error against the box.
   *
   * The list lives in `settings`, so the database cannot check it — a trigger
   * reading a setting would be a rule that changes when somebody edits a text
   * box. Membership is therefore checked here, exactly as a matter's type and a
   * warning's kind already are (`isTerm`), and for the same reason: a value
   * that is not on the list would show as its own raw key wherever every other
   * value shows as a label.
   *
   * A blank is always allowed. None of these is a fact the register may insist
   * on knowing about somebody.
   */
  const fromList = (name: string, terms: Term[], label: string): string | null => {
    const value = f.optional(name, { max: 60 });
    if (value && !isTerm(terms, value)) {
      f.errors[name] = `That is not one of the ${label} you have configured.`;
      return null;
    }
    return value;
  };

  // Names are recorded in plain English letters and the family name in
  // capitals. Applied here, once, rather than left to whoever typed the record.
  const givenNames = givenNamesFor(f.optional('given_names', { max: 120 })) || null;
  const familyName = kind === 'individual'
    ? f.text('family_name', { required: true, label: 'Family name', max: 120 })
    : f.optional('family_name', { max: 120 }) ?? '';
  const organisationName = kind === 'organisation'
    ? f.text('organisation_name', { required: true, label: 'Registered name', max: 200 })
    : '';

  // Spaces and dashes come off first: a number read aloud off a letter is
  // written "64 486 276" as often as not, and refusing that would teach people
  // that the box is broken. What is left has to be digits, and the database
  // says so too — this is here so the message names the box.
  const typedInz = (f.optional('inz_client_number', { max: 40 }) ?? '').replace(/[\s-]/g, '');
  const inzClientNumber = typedInz || null;
  if (inzClientNumber && !/^[0-9]{6,12}$/.test(inzClientNumber)) {
    f.errors['inz_client_number'] = 'An INZ client number is six to twelve digits and nothing else.';
  }

  const nzbn = f.optional('nzbn', { max: 20 });
  if (nzbn && !isValidNzbnFormat(nzbn)) {
    f.errors['nzbn'] = 'An NZBN is 13 digits, starting 9429.';
  }

  // The two visa dates, in the order they have to be in.
  //
  // **Reported 12 September 2026**, filling in a client's details: *"this is
  // what appeared when i pressed save - annoying."* The database refused it, as
  // it has since migration 0081 and should, but the refusal reached the person
  // as *Something went wrong* and took everything they had typed with it.
  //
  // The rule stays in the database, where a rule belongs. This is here so it is
  // said against the right box, before the write, with the rest of the form
  // still in front of them — exactly as the INZ client number above and the
  // national identity number below already are.
  const visaStart = f.date('current_visa_start');
  const visaExpiry = f.date('current_visa_expiry');
  if (visaStart && visaExpiry && visaExpiry < visaStart) {
    f.errors['current_visa_expiry'] = 'A visa cannot expire before it was granted.';
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
    // What somebody is actually called, in ordinary case like a given name.
    preferred_name: givenNamesFor(f.optional('preferred_name', { max: 120 })) || null,
    email: f.email('email'),
    phone: f.optional('phone', { max: 60 }),
    whatsapp: f.optional('whatsapp', { max: 60 }),
    telegram_username: f.optional('telegram_username', { max: 60 }),
    telegram_user_id: f.optional('telegram_user_id', { max: 40, pattern: /^\d+$/, patternMessage: 'Telegram user ID must be numeric.' }),
    // The form is two dropdowns, so these are already codes. Passed through
    // the resolver anyway: a request built by hand carrying "Vietnam" then
    // lands as VN rather than as a 500 from the trigger that guards the table.
    nationalities: normaliseCodes(nationalityFieldNames(MAX_NATIONALITIES)
      .map((name) => countryCodeFor(f.optional(name, { max: 100 })))),
    date_of_birth: f.date('date_of_birth'),
    // A dropdown, so this is already a code. Resolved anyway: a request built
    // by hand carrying "Vietnam" then lands as VN rather than as a 500 from the
    // trigger that guards the column.
    passport_country: countryCodeFor(f.optional('passport_country', { max: 100 })),
    passport_expiry: f.date('passport_expiry'),
    passport_issued: f.date('passport_issued'),
    english_test_type: f.optional('english_test_type', { max: 60 }),
    english_test_score: f.optional('english_test_score', { max: 40 }),
    english_test_date: f.date('english_test_date'),
    current_visa_type: f.optional('current_visa_type', { max: 120 }),
    current_visa_start: visaStart,
    current_visa_expiry: visaExpiry,
    current_visa_expiry_rule: f.optional('current_visa_expiry_rule', { max: 200 }),
    current_visa_conditions: f.optional('current_visa_conditions', { max: 2000 }),
    current_visa_stay_limit: f.optional('current_visa_stay_limit', { max: 300 }),
    inz_client_number: inzClientNumber,
    // --- the flat facts an application form asks for (migration 0084) -------
    title: fromList('title', vocab.titles, 'titles'),
    gender: fromList('gender', vocab.genders, 'genders'),
    relationship_status: fromList('relationship_status', vocab.relationshipStatuses,
      'relationship statuses'),
    other_names: f.optional('other_names', { max: 500 }),
    // A dropdown, so this is already a code \u2014 resolved anyway, so a request
    // built by hand carrying "Vietnam" lands as VN rather than as a 500 from
    // the trigger that guards the column.
    birth_country: countryCodeFor(f.optional('birth_country', { max: 100 })),
    birth_region: f.optional('birth_region', { max: 120 }),
    birth_town: f.optional('birth_town', { max: 120 }),
    ...nationalIdentity(f),
    // --- military service, INZ 1200 Section D (migration 0099) -------------
    ...militaryService(f),
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
  // Thi Kim Oanh" belongs under T for Truong, not under T for Thi. An
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

/**
 * The "Finished with?" view: clients who look done, and a way to say so.
 *
 * Its own renderer rather than a branch inside the main list, because it
 * answers a different question and shows different columns — how much has
 * expired and when, rather than contact details.
 */
function renderDormant(c: Context<AppContext>, rows: DormantClient[], q: string) {
  const csrf = c.get('session')!.csrf;
  const writable = can(c.get('user'), 'register:write');
  const shown = q
    ? rows.filter((r) => `${r.full_name} ${r.ref}`.toLowerCase().includes(q.toLowerCase()))
    : rows;

  return page(c, { title: 'Clients — finished with?', active: '/clients' }, html`
    ${pageHeader('Finished with?',
      'Every matter closed, everything on file expired \u2014 and still raising alerts.')}

    <nav class="tabs">
      <a class="tab" href="/clients">← Back to clients</a>
      <a class="tab current">Finished with? ${String(rows.length)}</a>
    </nav>

    ${rows.length === 0
      ? emptyState('Nobody looks finished with. Every client either has a matter running or '
          + 'something still in date.')
      : html`
        <p class="hint">Archiving stops the alerts. <strong>Nothing is deleted</strong>, and
           changing the status back undoes it.</p>

        <form method="get" action="/clients" class="filters" data-live-search>
          <input type="hidden" name="view" value="dormant">
          <input type="search" name="q" value="${q}" placeholder="Search name or reference">
          <button class="btn btn-secondary js-hide" type="submit">Filter</button>
        </form>

        <form method="post" action="/clients/archive" id="dormant-form">
          ${csrfField(csrf)}
          ${table([
            { label: raw('<span class="sr-only">Select</span>'), width: 'pick' },
            { label: 'Client', width: '36' },
            { label: 'Expired', width: '14' },
            { label: 'Last expiry', width: '18' },
            { label: 'Matters', width: '14', hideOn: 'sm' },
            { label: 'Status', width: '18', hideOn: 'sm' },
          ], shown.map((r) => html`
            <tr>
              <td>${writable
                ? html`<input type="checkbox" name="id" value="${r.id}" form="dormant-form"
                              aria-label="${`Select ${r.full_name}`}">`
                : ''}</td>
              <td><a href="/clients/${r.id}">${r.full_name}</a>
                  <div class="muted small"><code>${r.ref}</code></div></td>
              <td>${badge(`${r.expired} expired`, r.expired > 2 ? 'red' : 'amber')}</td>
              <td class="small">${dateShort(r.last_expiry)}
                  <div class="muted">${relativeDays(r.last_expiry)}</div></td>
              <td class="small col-sm-hide">${String(r.matters)}, all finished</td>
              <td class="col-sm-hide">${badge(
                CLIENT_STATUS_LABELS[r.status as ClientStatus] ?? r.status,
                statusTone(r.status))}</td>
            </tr>`), { fixed: true, empty: 'Nobody matches that.' })}
          ${writable && shown.length ? html`
            <div class="filters mt">
              <button class="btn btn-primary" type="submit">Archive selected</button>
              <span class="hint">You will be shown exactly who before anything happens.</span>
            </div>` : ''}
        </form>`}`);
}

export const clientsModule: AppModule = {
  name: 'clients',
  title: 'Clients',
  basePaths: ['/clients'],
  nav: [{ href: '/clients', label: 'Clients', permission: 'register:read', order: 90 }],

  register(app) {
    const r = new Hono<AppContext>();
    r.use('*', requireAuth);

    // "Read a document into this client's file", registered first for the same
    // reason the matter's is: a parameterised route added above it would
    // swallow `/:id/read`.
    //
    // **Asked for on 12 September 2026:** *"Read a document into this matter
    // section in cases must also be available for clients as well - as we have
    // a lot of info to add to clients. probably more than we have for cases."*
    // Right about the shape of the register — a client carries far more boxes
    // than a matter — and it is the same routes, from `core/reading.ts`, told
    // which file they are working on.
    registerReadingRoutes(r, CLIENT_READING);

    // --- List ---------------------------------------------------------------
    r.get('/', requirePermission('register:read'), async (c) => {
      const q = (c.req.query('q') ?? '').trim();
      const status = c.req.query('status') ?? '';
      const tagFilter = (c.req.query('tag') ?? '').trim();
      const pageNum = pageNumberFor(c.req.query('page'));

      const prefs = await preferencesFor(c.env, c.get('user')!.id);

      const PAGE_SIZE = pageSizeFor(c.req.query('size'), prefs['pref.page_size']);
      const offset = (pageNum - 1) * PAGE_SIZE;

      // Four ways of looking at one list rather than four lists. Leads cuts by
      // stage; individuals and organisations cut by what kind of client it is,
      // because in practice you are either working a pipeline or looking for a
      // person or a company, and those are different errands.
      const view = c.req.query('view') ?? prefs['pref.clients_view'] ?? 'individuals';

      /*
       * "Finished with?" is a proposal, not a filter over the same rows.
       *
       * A person whose matters are all closed and whose documents have all
       * expired goes on raising alerts for ever, and the practice said so:
       * *"some of the visa expiries we cannot handle — as the clients move
       * on."* This view finds them; archiving them silences the alerts without
       * deleting anything. The register never archives anybody on its own.
       */
      if (view === 'dormant') {
        const today = new Date().toISOString().slice(0, 10);
        const candidates = await dormantClients(c.env, today);
        return renderDormant(c, candidates, q);
      }

      const where: string[] = [];
      const params: unknown[] = [];
      if (view === 'leads' && !status) where.push(`status = 'prospect'`);
      else if (view === 'individuals') where.push(`kind = 'individual'`);
      else if (view === 'organisations') where.push(`kind = 'organisation'`);
      if (view !== 'all' && view !== 'leads') where.push(`status <> 'archived'`);
      if (q) {
        // Every word, in any order. A name is stored as it is written on the
        // passport — "Maria Luisa GARCIA" — so one phrase matched against one
        // column found nothing for "GARCIA Maria Luisa", which is how a lawyer
        // and INZ both write it.
        const cols = ['full_name', 'family_name', 'given_names', 'email', 'phone', 'ref',
                      'preferred_name', 'nzbn', 'company_number', 'inz_client_number'];
        for (const term of searchTerms(q)) {
          params.push(`%${term.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`);
          const n = params.length;
          where.push(`(${cols.map((c) => `${c} LIKE ?${n} ESCAPE '\\'`).join(' OR ')})`);
        }
      }
      if (status && (CLIENT_STATUSES as readonly string[]).includes(status)) {
        where.push(`status = ?${params.length + 1}`);
        params.push(status);
      }
      // By name rather than by id, so the address of a filtered list reads as
      // what it filters — and survives a tag being renamed, which is the same
      // reasoning the matters list already uses.
      if (tagFilter) {
        params.push(tagFilter);
        // `c.id`, not `clients.id`: the list query aliases the table, and the
        // count query below reuses the same clause.
        where.push(`EXISTS (SELECT 1 FROM client_tags xt JOIN tags t ON t.id = xt.tag_id
                             WHERE xt.client_id = c.id AND t.name = ?${params.length})`);
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

      const asked = c.req.query('sort') ?? '';
      const sortCols = CLIENT_SORTS[asked];
      const sortKey = sortCols ? asked : '';
      const sortDir = c.req.query('dir') === 'desc' ? 'desc' : 'asc';
      const dirSql = sortDir === 'desc' ? 'DESC' : 'ASC';

      // One spelling of this list's address, so a link that changes the page
      // or the page size keeps the view, the search and the sort.
      const listHref = (over: Record<string, string | number> = {}) =>
        `/clients?${new URLSearchParams({
          view, q, status, tag: tagFilter, sort: sortKey, dir: sortDir,
          page: String(pageNum), size: String(PAGE_SIZE),
          ...Object.fromEntries(Object.entries(over).map(([k, v]) => [k, String(v)])),
        }).toString()}`;
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
      // One query for the page rather than one per row, the same way the
      // matters list does it.
      const [tagsByClient, allTags] = await Promise.all([
        tagsForClients(c.env, shown.map((row: any) => row.id)),
        listTags(c.env),
      ]);
      // One query for the whole page. A list of two hundred clients must not
      // become two hundred queries to say where they are from.
      const nationalities = await nationalitiesByClient(c.env, shown.map((r) => r.id));
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
      // Counted separately: it is a different question, not a slice of the same
      // list, and it is worth showing the number even when nobody is looking.
      const dormantCount = (await dormantClients(c.env, new Date().toISOString().slice(0, 10))).length;
      if (dormantCount > 0) views.push({ id: 'dormant', label: 'Finished with?', count: dormantCount });

      return page(c, { title: 'Clients', active: '/clients' }, html`
        ${pageHeader('Clients',
          // No subtitle. It read "Everyone the practice acts for", which stopped
          // being true the moment the register started holding employers,
          // sponsors, supporting partners, agents and the odd stub record for
          // somebody whose document arrived in another client's folder. The
          // practice does not act for most of them. A heading that overstates
          // what a list contains is worse than no subtitle at all.
          undefined,
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
          <input type="hidden" name="size" value="${String(PAGE_SIZE)}">
          <input type="search" name="q" value="${q}" placeholder="Search name, email, phone, reference or NZBN">
          <select name="status">
            <option value="">All statuses</option>
            ${CLIENT_STATUSES.map((s) => html`<option value="${s}" ${s === status ? raw('selected') : ''}>${CLIENT_STATUS_LABELS[s]}</option>`)}
          </select>
          ${allTags.length ? html`
            <select name="tag">
              <option value="">All tags</option>
              ${allTags.map((tag) => html`<option value="${tag.name}"
                ${tag.name === tagFilter ? raw('selected') : ''}>${tag.name} (${String(tag.uses)})</option>`)}
            </select>` : ''}
          <button class="btn btn-secondary" type="submit">Filter</button>
        </form>
        <div data-live-results>
        ${pager({ page: pageNum, size: PAGE_SIZE, hasMore, shown: shown.length, href: listHref, compact: true })}
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
            <td><a href="/clients/${row.id}">${row.full_name}</a>${row.is_test === 1 ? html` ${badge('Test', 'amber')}` : ''}
                <div class="muted small">
                  ${row.kind === 'organisation'
                    ? html`Organisation${row.nzbn ? html` · NZBN ${row.nzbn}` : ''}`
                    : (nationalities.get(row.id) ?? []).map(countryName).join(' · ')}
                </div>
                ${(tagsByClient.get(row.id) ?? []).length
                  ? html`<div class="tag-row">${(tagsByClient.get(row.id) ?? []).map((tag) =>
                      badge(tag.name, tag.colour))}</div>`
                  : ''}
                <div class="row-meta show-sm">
                  <code>${row.ref}</code>
                  ${badge(CLIENT_STATUS_LABELS[row.status], statusTone(row.status))}
                  ${row.open_cases ? html`<span class="muted">${row.open_cases} open</span>` : ''}
                </div></td>
            <td class="small">${row.email ?? ''}${row.email && row.phone ? raw('<br>') : ''}${row.phone ?? ''}</td>
            <td class="col-sm-hide">${badge(CLIENT_STATUS_LABELS[row.status], statusTone(row.status))}</td>
            <td class="col-sm-hide">${row.open_cases || '—'}</td>
            <td class="small col-sm-hide">${stamp(row.updated_at)}</td>
          </tr>`), { sticky: true, fixed: true, empty: 'No clients match that.',
            // Sorting resets to page one: the second page of one order holds
            // different rows from the second page of another.
            sort: { key: sortKey, dir: sortDir,
                    href: (key, dir) => listHref({ sort: key, dir, page: 1 }) } })}
        ${pager({ page: pageNum, size: PAGE_SIZE, hasMore, shown: shown.length, href: listHref })}
        </div>`);
    });

    /**
     * Archive several clients at once, in two steps.
     *
     * Nothing is deleted. An archived client keeps their file, their matters,
     * their notes and their history; what changes is that they stop raising
     * expiry alerts and stop appearing on the calendar, which is the whole
     * point. Changing the status back brings all of it with them.
     *
     * Two steps rather than a dialog, as with the inbox: the register works
     * with scripting off, and this reaches many live client records at once.
     * The first step names every person about to be archived; only the second
     * writes. Between them the list is read again from the database, because
     * somebody may have opened a matter for one of them in the meantime — and
     * the person pressing the button cannot see that.
     */
    r.post('/archive', requirePermission('register:write'), async (c) => {
      const form = await c.req.formData();
      const ids = [...new Set(form.getAll('id').map(String).filter(Boolean))].slice(0, 500);
      if (ids.length === 0) {
        return redirectWith(c, '/clients?view=dormant', 'Nobody was selected.', 'err');
      }
      const today = new Date().toISOString().slice(0, 10);
      const allowed = await stillDormant(c.env, today, ids);
      const rows = (await dormantClients(c.env, today)).filter((r) => allowed.has(r.id));
      if (rows.length === 0) {
        return redirectWith(c, '/clients?view=dormant',
          'None of those can be archived now — each one has a matter running again.', 'err');
      }

      const csrf = c.get('session')!.csrf;
      const skipped = ids.length - rows.length;
      return page(c, { title: 'Archive these clients?', active: '/clients' }, html`
        ${pageHeader('Archive these clients?',
          'Nothing is deleted. They stop raising expiry alerts.')}

        ${card(`${rows.length} ${rows.length === 1 ? 'client' : 'clients'}`, html`
          <ul class="list">${rows.map((r) => html`
            <li><a href="/clients/${r.id}">${r.full_name}</a>
              <span class="muted small"> · ${r.ref}</span>
              <div class="muted small">${String(r.expired)} expired
                ${r.expired === 1 ? 'document' : 'documents'}, last on
                ${dateShort(r.last_expiry)} · ${String(r.matters)}
                ${r.matters === 1 ? 'matter' : 'matters'}, all finished</div></li>`)}</ul>`)}

        ${skipped ? html`<p class="hint">${String(skipped)} left out: a matter is running again.</p>` : ''}

        <form method="post" action="/clients/archive/confirm" class="filters">
          ${csrfField(csrf)}
          ${rows.map((r) => html`<input type="hidden" name="id" value="${r.id}">`)}
          <button class="btn btn-primary" type="submit">
            Archive ${String(rows.length)} ${rows.length === 1 ? 'client' : 'clients'}
          </button>
          <a class="btn btn-secondary" href="/clients?view=dormant">Cancel</a>
        </form>`);
    });

    r.post('/archive/confirm', requirePermission('register:write'), async (c) => {
      const form = await c.req.formData();
      const ids = [...new Set(form.getAll('id').map(String).filter(Boolean))].slice(0, 500);
      const today = new Date().toISOString().slice(0, 10);
      const allowed = [...await stillDormant(c.env, today, ids)];
      if (allowed.length === 0) {
        return redirectWith(c, '/clients?view=dormant',
          'Nothing was archived — those clients have matters running again.', 'err');
      }

      const user = c.get('user')!;
      const at = nowIso();
      let archived = 0;
      for (const id of allowed) {
        const before = await one<{ status: string; full_name: string }>(
          c.env.DB, 'SELECT status, full_name FROM clients WHERE id = ?', id);
        if (!before || before.status === 'archived') continue;
        await run(c.env.DB, 'UPDATE clients SET status = ?, updated_at = ? WHERE id = ?',
          'archived', at, id);
        // A note on the file and an audit row, exactly as archiving one client
        // by hand writes — so a batch leaves the same trail as forty-three
        // separate decisions would have.
        await addEntry(c.env, {
          entityType: 'client', entityId: id, kind: 'system',
          body: `Status changed from ${CLIENT_STATUS_LABELS[before.status as ClientStatus]} `
            + 'to Archived. Everything on file had expired and no matter was running.',
          createdBy: user.id,
        });
        await auditFrom(c, {
          action: 'client.status_changed', entityType: 'client', entityId: id,
          meta: { from: before.status, to: 'archived', bulk: true },
        });
        archived += 1;
      }

      const skipped = ids.length - archived;
      return redirectWith(c, '/clients?view=dormant',
        `Archived ${archived} ${archived === 1 ? 'client' : 'clients'}.`
        + (skipped ? ` ${skipped} left alone.` : '')
        + ' Their expiry alerts have stopped; nothing was deleted.');
    });

    // --- Create -------------------------------------------------------------
    r.get('/new', requirePermission('register:write'), async (c) => {
      const [users, organisations, vocab] = await Promise.all([
        userOptions(c.env), organisationOptions(c.env), clientVocabularies(c.env)]);
      const kind = c.req.query('kind') === 'organisation' ? 'organisation' : 'individual';

      // The assistant, or any other page, may propose a starting point through
      // the address. It is only ever a draft in a form somebody submits, so the
      // limits here are about length rather than trust — nothing is stored
      // until the ordinary create route validates it.
      const prefill = (name: string, max = 200) => (c.req.query(name) ?? '').slice(0, max) || undefined;
      const proposed: ClientFormValues = {
        kind,
        given_names: prefill('given_names', 120),
        family_name: prefill('family_name', 120),
        email: prefill('email', 320),
        phone: prefill('phone', 60),
        nationalities: normaliseCodes([countryCodeFor(prefill('nationality', 100))]),
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
        ${clientForm(c, proposed, users, organisations, vocab)}`);
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
      const vocab = await clientVocabularies(c.env);
      const v = readClientForm(f, vocab);
      if (!f.valid) {
        const [users, organisations] = await Promise.all([
          userOptions(c.env), organisationOptions(c.env)]);
        return page(c, { title: 'New client', active: '/clients', status: 400 }, html`
          ${pageHeader('New client')}${clientForm(c, v as ClientFormValues, users, organisations, vocab, f.errors)}`);
      }

      const id = newId('cli');
      const ref = await nextRef(c.env.DB, 'client', 'CL');

      // The passport columns are not written here. They are a cache of the
      // primary row in client_passports, filled in below by the same code that
      // maintains them everywhere else — so there is one place that can get it
      // wrong rather than three.
      //
      // Wrapped for the same reason the edit is: a refusal from the database
      // belongs on the form, not on an error page. See `refusalMessage`.
      try {
      await run(
        c.env.DB,
        `INSERT INTO clients (id, ref, kind, full_name, given_names, family_name, preferred_name,
            nzbn, company_number, organisation_id, organisation_role,
            email, phone, whatsapp, telegram_username, telegram_user_id,
            date_of_birth,
            english_test_type, english_test_score, english_test_date,
            current_visa_type, current_visa_start, current_visa_expiry, current_visa_expiry_rule,
            current_visa_conditions, current_visa_stay_limit, inz_client_number,
            title, gender, relationship_status, other_names,
            birth_country, birth_region, birth_town,
            national_id_number, national_id_country,
            military_compulsory, military_served, military_exempt, military_exemption_detail,
            address, status, assigned_to, notes,
            created_at, updated_at, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        id, ref, v.kind, v.full_name, v.given_names, v.family_name, v.preferred_name,
        v.nzbn, v.company_number, v.organisation_id || null, v.organisation_role, v.email, v.phone, v.whatsapp, v.telegram_username, v.telegram_user_id,
        v.date_of_birth,
        v.english_test_type, v.english_test_score, v.english_test_date,
        v.current_visa_type, v.current_visa_start, v.current_visa_expiry, v.current_visa_expiry_rule,
        v.current_visa_conditions, v.current_visa_stay_limit, v.inz_client_number,
        v.title, v.gender, v.relationship_status, v.other_names,
        v.birth_country, v.birth_region, v.birth_town,
        v.national_id_number, v.national_id_country,
        v.military_compulsory, v.military_served, v.military_exempt, v.military_exemption_detail,
        v.address, v.status, v.assigned_to || null, v.notes,
        nowIso(), nowIso(), user.id,
      );
      } catch (err) {
        const said = refusalMessage(err);
        if (!said) throw err;
        const [users, organisations] = await Promise.all([
          userOptions(c.env), organisationOptions(c.env)]);
        return page(c, { title: 'New client', active: '/clients', status: 400 }, html`
          ${pageHeader('New client')}${clientForm(c, v as ClientFormValues, users, organisations,
            vocab, { ...f.errors, _form: said })}`);
      }
      // Written straight after the row rather than in the same batch, because
      // the row has to exist for the foreign key to hold. Failing here leaves a
      // client with no nationality, which is the state every client without one
      // is already in — not a half-written record.
      await c.env.DB.batch(setNationalityStatements(c.env, id, v.nationalities));

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
      // What this practice calls its own file notes. See NOTE_KIND_VOCAB.
      const noteKindList = await noteKinds(c.env);
      const types = await caseTypes(c.env);
      const id = c.req.param('id')!;
      const client = await one<ClientRow & { assignee_name: string | null }>(
        c.env.DB,
        `SELECT c.*, u.name AS assignee_name FROM clients c
           LEFT JOIN users u ON u.id = c.assigned_to WHERE c.id = ?`,
        id,
      );
      if (!client) return c.notFound();
      const clientNationalities = await nationalitiesFor(c.env, id);
      const [clientFlags, flagKindTerms, clientTags, allTags,
             histories, employmentKinds, educationLevels, educationOutcomes,
             travelPurposes, travelModes] = await Promise.all([
        flagsForClient(c.env, id), flagKinds(c.env),
        tagsForClient(c.env, id), listTags(c.env),
        allHistories(c.env, id),
        vocabulary(c.env, EMPLOYMENT_KIND_VOCAB), vocabulary(c.env, EDUCATION_LEVEL_VOCAB),
        vocabulary(c.env, EDUCATION_OUTCOME_VOCAB),
        vocabulary(c.env, TRAVEL_PURPOSE_VOCAB), vocabulary(c.env, TRAVEL_MODE_VOCAB),
      ]);
      const historyVocab: HistoryVocab = {
        employment_kinds: employmentKinds, education_levels: educationLevels,
        education_outcomes: educationOutcomes,
        travel_purposes: travelPurposes, travel_modes: travelModes,
      };

      // Which blocks on this page start open.
      //
      // **Asked for on 12 September 2026:** *"The block need to be collapsible,
      // starting from collapsed position, when client file is opened."* A
      // client's page is nine blocks and the file notes alone can run for
      // pages; opening it on a list of headings is the difference between a
      // page you scan and a page you scroll.
      //
      // Named in the address rather than remembered, for the reason the
      // calendar and the matter page give: a block missing because of something
      // you did on another client last week is worse than one you open again.
      // `?open=passports` is how a link from the client's own form still lands
      // on an open block — a `#fragment` never reaches the server, so it cannot
      // decide what is open.
      const openBlocks = new Set([
        ...OPEN_BY_DEFAULT,
        ...(c.req.query('open') ?? '').split(',').filter(Boolean),
      ]);

      const canReadMail = can(c.get('user'), 'mail:send');
      // Whether the reading card is drawn at all, and what it may be pointed
      // at. Only this client's own documents — a document filed to one of their
      // matters was filed there on purpose, and the query in
      // `modules/documents` is the whole of that boundary.
      const readingAvailable = isAiEnabled(c.env) && can(c.get('user'), 'ai:run')
        && can(c.get('user'), 'register:write');
      const [cases, quotes, inquiries, entries, sentMail, tasks, partyCases, related, employer, people,
             feesByCase, englishTestTerms, visaTerms, certificates, passports, threads,
             clientFiles, docCats, titleTerms, genderTerms, relationshipTerms,
             readingSources] = await Promise.all([
        all<any>(c.env.DB, `SELECT id, ref, title, case_type, status, priority, next_action, next_action_due, updated_at
                              FROM cases WHERE client_id = ? ORDER BY updated_at DESC`, id),
        all<any>(c.env.DB, `SELECT id, ref, description, amount_cents, gst_cents, disbursements_cents, currency, status, created_at
                              FROM quotes WHERE client_id = ? ORDER BY created_at DESC`, id),
        all<any>(c.env.DB, `SELECT id, ref, source, subject, status, received_at
                              FROM inquiries WHERE client_id = ? ORDER BY received_at DESC LIMIT 20`, id),
        listEntries(c.env, 'client', id),
        // See the inquiry page for why this is read here and why it is guarded.
        canReadMail ? emailsForEntity(c.env, 'client', id) : Promise.resolve([]),
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
                  COALESCE(SUM(i.gross_cents), 0) AS gross,
                  COALESCE(SUM(i.paid_cents), 0) AS paid,
                  COALESCE(SUM(CASE WHEN i.status <> 'draft' THEN i.gross_cents ELSE 0 END), 0) AS billed
             FROM cases k JOIN invoices i ON i.case_id = k.id
            WHERE k.client_id = ? AND i.status <> 'void'
            GROUP BY k.id ORDER BY k.updated_at DESC`, id),
        englishTests(c.env),
        visaTypes(c.env),
        certificatesFor(c.env, id),
        passportsFor(c.env, id),
        threadsFor(c.env, 'client', id),
        listDocuments(c.env, 'client', id),
        docCategories(c.env),
        // The three lists added with the application-form fields (0084). Read
        // here rather than on the form alone, because a stored key shows as its
        // own raw word without its label, and "gender_diverse" on a client page
        // is the register talking to itself.
        titles(c.env),
        genders(c.env),
        relationshipStatuses(c.env),
        // Asked for only where the card is drawn.
        readingAvailable ? readingSourcesForClient(c.env, id) : Promise.resolve([]),
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
        ${testDataBand({ isTest: client.is_test === 1, table: 'clients', id: client.id, csrf: c.get('session')!.csrf, canMark: can(c.get('user'), 'data:test'), noun: 'client', returnTo: `/clients/${client.id}` })}
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

        ${'' /* Above everything on the record, because that is the point of
                 it: a fact that changes how a matter is handled has to be read
                 before anything is said, not found three screens down after it
                 mattered. Nothing at all when there is nothing to warn about —
                 a band on every file teaches people to look past it. */}
        ${flagBand({
          flags: clientFlags.filter((f) => isShowing(f)),
          label: (kind) => labelFor(flagKindTerms, kind),
          clear: writable ? { csrf } : null,
          kinds: termOptions(flagKindTerms), lives: FLAG_LIVES,
        })}
        ${writable ? flagRaiser({
          entityType: 'client', entityId: client.id, csrf,
          kinds: termOptions(flagKindTerms), lives: FLAG_LIVES,
        }) : ''}

        <div class="cols">
          <div class="col-main">
            ${block('cases', openBlocks, 'Cases', table(['Reference', 'Matter', 'Type', 'Status', 'Next action'], cases.map((k: any) => html`
              <tr>
                <td><a href="/cases/${k.id}"><code>${k.ref}</code></a></td>
                <td><a href="/cases/${k.id}">${k.title}</a></td>
                <td class="small">${labelFor(types, k.case_type)}</td>
                <td>${badge(CASE_STATUS_LABELS[k.status as keyof typeof CASE_STATUS_LABELS] ?? k.status, statusTone(k.status))}</td>
                <td class="small">${k.next_action ? html`${truncate(k.next_action, 60)}<div class="muted">${dateShort(k.next_action_due)}</div>` : '—'}</td>
              </tr>`)))}

            ${block('quotes', openBlocks, 'Quotes', table(['Reference', 'Description', 'Total', 'Status', 'Raised'], quotes.map((qt: any) => html`
              <tr>
                <td><a href="/quotes/${qt.id}"><code>${qt.ref}</code></a></td>
                <td>${truncate(qt.description, 70)}</td>
                <td>${money(qt.amount_cents + qt.gst_cents + qt.disbursements_cents, qt.currency)}</td>
                <td>${badge(QUOTE_STATUS_LABELS[qt.status as keyof typeof QUOTE_STATUS_LABELS] ?? qt.status, statusTone(qt.status))}</td>
                <td class="small">${stamp(qt.created_at)}</td>
              </tr>`)))}


            ${(() => {
              const past = clientFlags.filter((f) => !isShowing(f));
              return past.length === 0 ? '' : foldingCard('Warnings taken down',
                flagHistory({ flags: past, label: (k) => labelFor(flagKindTerms, k),
                              csrf: writable ? csrf : null }));
            })()}


            ${isOrg ? '' : block('passports', openBlocks, 'Passports', html`
                  ${passports.length === 0
                    ? emptyState('No passport recorded yet. The first one is entered on the client\u2019s '
                        + 'own form, under Identity.')
                    : html`<ul class="list">
                        ${passports.map((pp) => html`
                          <li class="list-row">
                            <div>
                              ${'' /* The country's name, not its code. Reported 12 September
                                      2026, looking at a Tongan passport headed "TO": *"Do not
                                      like the country abbreviation - insufficient - Use full
                                      country name."* Right — the code is how the register
                                      stores it, and a stored form is not a heading. */}
                              <strong>${countryName(pp.country) || 'Passport'}</strong>
                              ${pp.is_primary === 1 ? badge('primary', 'green') : ''}
                              ${pp.status === 'held' ? '' : badge(passportStatusLabel(pp.status), 'grey')}
                              <div class="small muted">
                                ${pp.number
                                  ? html`<code>${pp.number}</code>` : 'No number recorded'}
                                ${pp.issued_on ? html` \u00b7 issued ${dateShort(pp.issued_on)}` : ''}
                                ${/* Not the expiry of a passport still held: it is in the column
                                      at the right, with its colour and its "in 4 months".
                                      Reported 11 September 2026, about "02 Dec 2031" printed twice
                                      on one row. A passport no longer held has no cell there, so
                                      it keeps its date here. */ ''}
                                ${pp.expires_on && pp.status !== 'held'
                                  ? html` \u00b7 expired ${dateShort(pp.expires_on)}` : ''}
                              </div>
                              ${pp.notes ? html`<div class="small muted">${pp.notes}</div>` : ''}
                            </div>
                            <div>
                              ${pp.status === 'held' && pp.expires_on ? expiryCell(pp.expires_on, 180) : ''}
                              ${writable && pp.is_primary !== 1
                                ? actionButton(`/clients/${client.id}/passports/${pp.id}/primary`, csrf,
                                    'Make primary', { className: 'btn btn-small btn-secondary' })
                                : ''}
                              ${writable && pp.is_primary !== 1
                                ? actionButton(`/clients/${client.id}/passports/${pp.id}/remove`, csrf,
                                    'Remove this passport',
                                    { className: 'btn-remove', icon: '\u00d7',
                                      confirm: 'Remove this passport from the file?' })
                                : ''}
                            </div>
                          </li>`)}
                      </ul>`}

                  ${writable ? html`
                    <details class="reveal mt">
                      <summary class="btn btn-primary reveal-open">Add another passport</summary>
                      <form method="post" action="/clients/${client.id}/passports" class="row-form">
                        ${csrfField(csrf)}
                        ${select({ label: 'Country', name: 'country', value: '',
                                   options: countryOptions(), includeBlank: 'Not recorded',
                                   hint: 'The country that issued it.' })}
                        ${field({ label: 'Number', name: 'number', maxlength: 60,
                                })}
                        ${field({ label: 'Issued', name: 'issued_on', type: 'date' })}
                        ${field({ label: 'Expires', name: 'expires_on', type: 'date' })}
                        ${select({ label: 'Status', name: 'status', value: 'held', includeBlank: false,
                                   options: PASSPORT_STATUSES })}
                        ${field({ label: 'Note', name: 'notes', maxlength: 300 })}
                        <button class="btn btn-primary" type="submit">Add it</button>
                      </form>
                      ${'' /* Was four sentences: where the primary is edited, that every
                              held passport is watched so a dual national is chased about
                              both, and that a replaced one stays on the file as a record
                              because a visa may still be stuck in it. All true; the Status
                              dropdown above already offers the choice. */}
                      <p class="hint">Only a passport marked held is watched for expiry.</p>
                    </details>` : ''}`)}

            ${isOrg ? '' : block('certificates', openBlocks, 'Certificates', html`
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
                                  <strong>${countryName(cert.country)
                                    || (cert.subtype ? medicalTypeLabel(cert.subtype) : CERTIFICATE_LABELS[kind])}</strong>
                                  ${current.has(cert.id) ? badge('current', 'green') : badge('superseded', 'grey')}
                                  <div class="small muted">
                                    ${cert.issued_on ? html`Issued ${dateShort(cert.issued_on)}` : 'Issue date not recorded'}
                                    ${cert.reference ? html` · ${cert.reference}` : ''}
                                  </div>
                                  ${/* Why it expires when it does. The date is worked out by the
                                        database from the issue date and this; saying so on the page
                                        is the difference between a date you trust and one you
                                        re-check against the certificate every time. */ ''}
                                  ${'' /* The rule, and the date it comes out at. Reported 12
                                          September 2026: *"'Submitted 12 Aug 2026 · 24 months
                                          from issue' should also say the actual calculated end
                                          date - in that case 29 Jun 2028."* Right: a line that
                                          states an arithmetic and stops before the answer makes
                                          the reader do the sum. The date is still the database's
                                          — this only prints it beside the rule that produced it. */}
                                  ${expiryIsDerived(kind) ? html`
                                    <div class="small muted">
                                      ${cert.submitted_on
                                        ? html`Submitted ${dateShort(cert.submitted_on)} ·
                                               ${CERTIFICATE_VALIDITY[kind]!.submitted} months from issue`
                                        : html`Not submitted ·
                                               ${CERTIFICATE_VALIDITY[kind]!.held} months from issue`}${
                                        cert.expires_on
                                          ? html` · expires ${current.has(cert.id)
                                              ? expiryInline(cert.expires_on)
                                              : html`<strong>${dateShort(cert.expires_on)}</strong>`}`
                                          : ''}
                                    </div>` : ''}
                                  ${'' /* An x-ray derives nothing, so its expiry has no rule to
                                          sit beside. It gets its own line, in the same place the
                                          eye is already looking. */}
                                  ${'' /* An x-ray derives nothing, so there is no rule for its
                                          expiry to sit beside, and no "N months from issue" to
                                          say. It gets the two facts plainly. */}
                                  ${!expiryIsDerived(kind) ? html`
                                    <div class="small muted">
                                      ${cert.submitted_on
                                        ? html`Submitted ${dateShort(cert.submitted_on)}`
                                        : 'Not submitted'}${cert.expires_on
                                        ? html` \u00b7 expires ${current.has(cert.id)
                                            ? expiryInline(cert.expires_on)
                                            : html`<strong>${dateShort(cert.expires_on)}</strong>`}`
                                        : ''}
                                    </div>` : ''}
                                  ${/* A date nobody read off the paper must never look like one
                                        somebody did — the expiry above is computed from it. */ ''}
                                  ${issueDateUnverified(cert) ? html`
                                    <div class="small">
                                      ${badge('issue date unverified', 'amber')}
                                      ${cert.issued_on_provenance === 'from_filename'
                                        ? 'From a filename.'
                                        : cert.issued_on_provenance === 'from_ocr'
                                        ? 'Read by machine.'
                                        : 'Source unknown.'}
                                      ${writable ? html`
                                        <form method="post" class="inline-form mt-sm"
                                              action="/clients/${client.id}/certificates/${cert.id}/confirm-issue-date">
                                          ${csrfField(csrf)}
                                          <button class="btn btn-small btn-secondary" type="submit">
                                            Confirm against the certificate</button>
                                        </form>` : ''}
                                    </div>` : ''}
                                  ${cert.notes ? html`<div class="small muted">${cert.notes}</div>` : ''}
                                  ${/* The quick way to record the day it went in, and it goes
                                        away once it has been. Reported 11 September 2026: *"the
                                        'Submitted with an application on' box must disappear once
                                        its function is fulfilled."* Changing the date afterwards
                                        is a correction, and corrections are made under Edit, where
                                        they are written to the file. */ ''}
                                  ${writable && !cert.submitted_on ? html`
                                    <form method="post" class="inline-form mt-sm"
                                          action="/clients/${client.id}/certificates/${cert.id}/submitted">
                                      ${csrfField(csrf)}
                                      <label class="small muted" for="sub-${cert.id}">Submitted with an application on</label>
                                      <input type="date" id="sub-${cert.id}" name="submitted_on">
                                      <button class="btn btn-small btn-secondary" type="submit">Save</button>
                                    </form>` : ''}
                                  ${/* Correcting the record rather than deleting it. Asked for on
                                        11 September 2026: *"need an option to edit PC and Medical
                                        Cert details when needed, with appropriate log entries."*
                                        Every change lands in a file note and the audit log, which
                                        is what makes it safe on a certificate an application has
                                        already relied on. */ ''}
                                  ${writable ? html`
                                    <details class="reveal mt-sm">
                                      <summary class="btn btn-small btn-secondary reveal-open">Edit</summary>
                                      <form method="post" class="row-form"
                                            action="/clients/${client.id}/certificates/${cert.id}">
                                        ${csrfField(csrf)}
                                        ${kind === 'police'
                                          ? select({ label: 'Country', name: 'country',
                                                     value: cert.country ?? '',
                                                     options: countryOptions(), includeBlank: 'Not recorded' })
                                          : ''}
                                        ${kind === 'medical'
                                          ? select({ label: 'Medical type', name: 'subtype',
                                                     value: cert.subtype ?? '',
                                                     includeBlank: 'Not recorded', options: MEDICAL_TYPES })
                                          : ''}
                                        ${field({ label: 'Issued', name: 'issued_on', type: 'date',
                                                  value: cert.issued_on ?? '' })}
                                        ${select({ label: 'The issue date was', name: 'issued_on_provenance',
                                                   value: cert.issued_on_provenance ?? 'unverified',
                                                   includeBlank: false, options: PROVENANCE_OPTIONS })}
                                        ${field({ label: 'Submitted with an application on',
                                                  name: 'submitted_on', type: 'date',
                                                  value: cert.submitted_on ?? '',
                                                  hint: expiryIsDerived(kind)
                                                    ? 'Clear it to undo. The expiry moves with it.'
                                                    : 'Clear it to undo.' })}
                                        ${expiryIsDerived(kind) ? '' : field({
                                          label: 'Expires', name: 'expires_on', type: 'date',
                                          value: cert.expires_on ?? '' })}
                                        ${field({ label: 'Reference', name: 'reference', maxlength: 80,
                                                  value: cert.reference ?? '' })}
                                        ${field({ label: 'Note', name: 'notes', maxlength: 300,
                                                  value: cert.notes ?? '' })}
                                        <button class="btn btn-primary btn-small" type="submit">Save changes</button>
                                      </form>
                                      <p class="hint">Every change is written to the file.</p>
                                    </details>` : ''}
                                </div>
                                <div>
                                  ${'' /* A superseded certificate's expiry is history, not a
                                          deadline. Reported 11 September 2026, looking at one
                                          expired sixteen months ago sitting in alarm red beside a
                                          current certificate good until 2028: *"this is what i do
                                          not need - an old certificate bugging me! especially where
                                          there is a new one already in place."*

                                          It raised no alert — the alerts read the current one — but
                                          the page said otherwise, and a page that shouts about a
                                          solved problem is how a person stops reading the page. So
                                          the red and the "472 days ago" are for the certificate the
                                          register is actually watching; a superseded one keeps its
                                          date, quietly, because a matter lodged in March relied on
                                          what was held in March. */}
                                  ${'' /* The date used to be repeated here, in the column at the
                                          right. It now sits on the line that explains where it
                                          came from, which is where the practice asked for it and
                                          where it reads as an answer rather than as a loose date.
                                          A superseded certificate still shows its expiry plainly
                                          rather than in alarm red — the red is for the one the
                                          register is actually watching. */}
                                  ${writable ? actionButton(`/clients/${client.id}/certificates/${cert.id}/remove`, csrf,
                                      'Remove this certificate',
                                      { className: 'btn-remove', icon: '\u00d7',
                                        confirm: 'Remove this certificate? Its history goes with it.' }) : ''}
                                </div>
                              </li>`)}
                          </ul>`;
                      })}`}

                  ${writable ? html`
                    <details class="reveal mt">
                      <summary class="btn btn-primary reveal-open">Add a police certificate, medical or x-ray</summary>
                      <form method="post" action="/clients/${client.id}/certificates" class="row-form">
                        ${csrfField(csrf)}
                        ${select({ label: 'What', name: 'kind', required: true, includeBlank: false,
                                   value: 'police',
                                   options: CERTIFICATE_KINDS.map((k) => ({ value: k, label: CERTIFICATE_LABELS[k] })) })}
                        ${select({ label: 'Country', name: 'country', value: '',
                                   options: countryOptions(), includeBlank: 'Not recorded',
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
                      ${'' /* Two paragraphs used to sit here: that a new certificate does
                              not replace the old and the most recent of each kind is what
                              the alerts watch, and that INZ works the expiry out from the
                              issue date rather than reading the one printed on the paper —
                              which is why recording that one went in with an application
                              moves its expiry by itself. Both still true; `validityRule`
                              still says the rule beside the box it applies to. */}
                      <p class="hint">The expiry is worked out from the issue date: a police
                         certificate is ${validityRule('police')} A medical is
                         ${validityRule('medical')}</p>
                    </details>` : ''}`)}

            ${'' /* Asked for on 12 September 2026: *"Read a document into this
                     matter section in cases must also be available for clients
                     as well."* The same card, the same routes and the same
                     press as the matter's — see `core/reading.ts` — pointed at
                     this client's file. It sits above Files because what it
                     reads is what is in there. */}
            ${readingAvailable
              ? readingCard({ host: CLIENT_READING, id: client.id, csrf,
                              filesKept: Boolean(c.env.DOCS), sources: readingSources as any,
                              driveOn: driveConfigured(c.env) })
              : ''}

            ${block('files', openBlocks, 'Files', filesPanel({
              csrf, entityType: 'client', entityId: client.id, returnTo: `/clients/${client.id}`,
              files: clientFiles as any, categories: docCats,
              canDelete: can(c.get('user'), 'register:delete'),
            }))}

            ${'' /* Employment, education and travel, each closed. Asked for on 11
                    September 2026, to be "formatted in a fashion that is similar to
                    existing pattern - whatever blocks there are - Quotes, Files,
                    Passports, Certificates". So they sit here, under the certificates,
                    and behave like the quotation lines: one table, a number to reorder
                    by, a cross to take a line out, one Save. */}
            ${'' /* Military service is the fourth of these, and the three questions
                     Section D of INZ 1200 asks ride on top of its table rather than
                     sitting in a block of their own: they are about the same thing,
                     and two headings for one subject is how a page gets long. Asked
                     for on 12 September 2026 — see migration 0099. */}
            ${isOrg ? '' : html`
              ${HISTORIES.map((def) => html`
                <div id="history-${def.key}">
                  ${historyPanel({ def, rows: histories[def.key], vocab: historyVocab,
                                   clientId: client.id, csrf, writable,
                                   intro: def.key === 'military'
                                     ? militaryQuestions({
                                         clientId: client.id,
                                         compulsory: client.military_compulsory,
                                         served: client.military_served,
                                         exempt: client.military_exempt,
                                         exemptionDetail: client.military_exemption_detail,
                                         writable })
                                     : undefined })}
                </div>`)}`}

            ${'' /* Last on the page, by instruction on 12 September 2026: "reorder,
                    Cases, Quotes, Passports, Certificates, Files, the rest, and at the
                    bottom - File Notes." It is the longest block on a client and the
                    one that grows for ever, so anything under it would be unreachable
                    in practice. */}
            ${block('filenotes', openBlocks, 'File notes', html`
              ${writable ? html`
              <form method="post" action="/clients/${client.id}/entries" class="entry-form">
                ${csrfField(csrf)}
                ${select({ label: 'Kind', name: 'kind', value: 'note', includeBlank: false,
                           options: termOptions(noteKindList) })}
                ${field({ label: 'Note', name: 'body', type: 'textarea', rows: 3, required: true, maxlength: 5000,
                          placeholder: 'What happened, what was advised, what was agreed.' })}
                <button class="btn btn-primary" type="submit">Add a note</button>
              </form>` : ''}
              ${entries.length === 0 ? emptyState('Nothing on the file yet.') : html`
                <ul class="timeline">
                  ${entries.map((e) => timelineItem({
                    entry: e,
                    kindLabel: noteKindLabel(noteKindList, e.kind, ENTRY_KIND_LABELS),
                    mail: canReadMail ? mailLinkFor(e, sentMail, recordMailHref('client', client.id)) : null,
                    happened: stamp(e.occurred_at),
                    written: stamp(e.created_at),
                    correction: writable && correctable(e, c.get('user')?.id ?? null)
                      ? { csrf, minutes: CORRECTION_WINDOW_MINUTES,
                          kindOptions: termOptions(noteKindList) }
                      : null,
                  }))}
                </ul>`}`)}
          </div>

          <div class="col-side">
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
              : foldingCard('Key details', html`
                  ${'' /* One card, grouped, with the name at the top.
                           **Asked for on 12 September 2026:** *"the set of panes to the
                           right and the data is not optimal under a client's profile. I
                           can see that under a particular case - Key Details - is better
                           organised ... maybe they should all appear under Key Details?
                           but with the name up top? say Name, Contacts, Passport details,
                           Certificate, English, and the rest."*

                           The old split was Identity and compliance beside Contact, and
                           it did not survive being looked at: the given names and family
                           name sat under *Contact*, which they are not, and "Works for"
                           sat under *Identity*, which it is not either. Eighteen rows in
                           one undifferentiated list is a list nobody reads to the end of.

                           Grouped in the practice's own order, with one change said out
                           loud: **Immigration comes third**, before the passport. A visa
                           expiry is the single most-looked-at fact on a client and it was
                           fourteen rows down. Everything else follows the order asked
                           for. */}
                  <p class="subhead">Name</p>
                  <dl class="kv kv-aligned">
                    <dt>Full name</dt><dd><strong>${client.full_name}</strong></dd>
                    <dt>Given names</dt><dd>${client.given_names ?? '—'}</dd>
                    <dt>Family name</dt><dd>${client.family_name ?? '—'}</dd>
                    <dt>Preferred</dt><dd>${client.preferred_name ?? '—'}</dd>
                    <dt>Title</dt><dd>${client.title
                      ? labelFor(titleTerms, client.title) : html`<span class="muted">—</span>`}</dd>
                    ${'' /* Shown even when empty, like the INZ number below: a blank
                             here is a box somebody will have to fill before a form can be
                             lodged, and a row that disappears when empty is a gap nobody
                             sees. */}
                    <dt>Other names used</dt><dd>${client.other_names
                      ? html`${client.other_names}` : html`<span class="muted">—</span>`}</dd>
                  </dl>

                  <p class="subhead">Contact</p>
                  <dl class="kv kv-aligned">
                    <dt>Phone</dt><dd>${client.phone
                      ? html`<a href="tel:${client.phone}">${client.phone}</a>` : '—'}</dd>
                    <dt>Email</dt><dd>${client.email
                      ? html`<a href="mailto:${client.email}">${client.email}</a>` : '—'}</dd>
                    <dt>WhatsApp</dt><dd>${client.whatsapp
                      ? html`<a href="tel:${client.whatsapp}">${client.whatsapp}</a>` : '—'}</dd>
                    <dt>Telegram</dt><dd>${client.telegram_username ?? client.telegram_user_id ?? '—'}</dd>
                    <dt>Address</dt><dd>${client.address ?? '—'}</dd>
                  </dl>

                  <p class="subhead">Immigration</p>
                  <dl class="kv kv-aligned">
                    ${'' /* The number quoted on everything sent to INZ about this person,
                             so it leads. */}
                    <dt>INZ client no.</dt><dd>${client.inz_client_number
                      ? html`<code>${client.inz_client_number}</code>`
                      : html`${badge('not recorded', 'amber')}`}</dd>
                    ${'' /* The grant, not only its end. Almost every question about a
                             temporary visa turns on the period — maximum continuous stay
                             counts from the start. */}
                    <dt>Current visa</dt><dd>${labelFor(visaTerms, client.current_visa_type) || '—'}${
                      client.current_visa_start
                        ? html`<div class="muted small">Granted ${dateShort(client.current_visa_start)}</div>`
                        : ''}</dd>
                    <dt>Visa expiry</dt><dd>${!client.current_visa_expiry && client.current_visa_expiry_rule
                      ? html`${badge('not yet fixed', 'amber')}
                             <div class="muted small">${client.current_visa_expiry_rule}</div>`
                      : expiryCell(client.current_visa_expiry)}</dd>
                    ${'' /* Shown only when there is something to show: a row reading
                             "Stay limit —" on every client is a line that makes a page
                             long without saying anything. */}
                    ${client.current_visa_stay_limit
                      ? html`<dt>Stay limit</dt><dd>${client.current_visa_stay_limit}</dd>` : ''}
                    ${client.current_visa_conditions
                      ? html`<dt>Conditions</dt>
                             <dd class="prewrap">${client.current_visa_conditions}</dd>` : ''}
                  </dl>

                  <p class="subhead">Passport</p>
                  <dl class="kv kv-aligned">
                    <dt>Passport</dt><dd>${passports.length === 0
                      ? html`<span class="muted">—</span>`
                      : html`${countryName(client.passport_country) || 'Primary'}${
                          client.passport_expiry ? html` · ${expiryCell(client.passport_expiry, 180)}` : ''}
                             ${passports.length > 1
                               ? html`<div class="muted small"><a href="?open=passports#passports">${passports.length} passports on file</a></div>`
                               : html`<div class="muted small"><a href="?open=passports#passports">Details</a></div>`}`}</dd>
                    ${'' /* Beside the passport, because it is the other identity document
                             a client hands over, and never without its issuing country —
                             which the database guarantees, so this cannot print half of
                             one. */}
                    <dt>National ID</dt><dd>${client.national_id_number
                      ? html`<code>${client.national_id_number}</code>
                             <div class="muted small">${countryName(client.national_id_country)}</div>`
                      : html`<span class="muted">—</span>`}</dd>
                  </dl>

                  <p class="subhead">Certificates</p>
                  <dl class="kv kv-aligned">
                    <dt>Police cert.</dt><dd>${client.police_certificate_country
                      ? html`${countryName(client.police_certificate_country)}<br>` : ''}${expiryCell(client.police_certificate_expiry)}
                      ${certificateDateUnverified(certificates, 'police', client.police_certificate_expiry)
                        ? badge('unverified date', 'amber') : ''}</dd>
                    <dt>Medical</dt><dd>${expiryCell(client.medical_certificate_expiry)}
                      ${certificateDateUnverified(certificates, 'medical', client.medical_certificate_expiry)
                        ? badge('unverified date', 'amber') : ''}</dd>
                    <dt>Chest x-ray</dt><dd>${expiryCell(client.chest_xray_expiry)}</dd>
                  </dl>

                  <p class="subhead">English</p>
                  <dl class="kv kv-aligned">
                    <dt>Test</dt><dd>${client.english_test_type
                      ? html`${labelFor(englishTestTerms, client.english_test_type)}${
                          client.english_test_score ? html` · <strong>${client.english_test_score}</strong>` : ''}
                          ${client.english_test_date
                            ? html`<div class="muted small">Taken ${dateShort(client.english_test_date)}</div>` : ''}`
                      : html`<span class="muted">—</span>`}</dd>
                    ${'' /* Worked out, not stored: it is the test date plus two years and
                             nothing else. See `englishExpiry`. */}
                    ${englishExpiry(client.english_test_date) ? html`
                      <dt>Accepted until</dt>
                      <dd>${expiryCell(englishExpiry(client.english_test_date))}
                        <div class="muted small">Two years from the test date.</div></dd>` : ''}
                  </dl>

                  <p class="subhead">Personal</p>
                  <dl class="kv kv-aligned">
                    ${'' /* Plural, because a person may be. Listed in the order the
                             practice entered them: the first is the passport an
                             application is likely to be made on. */}
                    <dt>${clientNationalities.length > 1 ? 'Nationalities' : 'Nationality'}</dt>
                    <dd>${clientNationalities.map(countryName).join(' · ') || '—'}</dd>
                    ${'' /* The age, not just the birthday. Half the thresholds in the
                             instructions are ages — a dependent child under 25, a parent
                             for the Parent Category — and working one out from a date in
                             the head, on a page being read for something else, is where a
                             mistake gets made. */}
                    <dt>Date of birth</dt><dd>${dateShort(client.date_of_birth)}${
                      ageYears(client.date_of_birth) === null
                        ? ''
                        : html` <span class="muted">· ${ageYears(client.date_of_birth)}</span>`}</dd>
                    ${'' /* Town, region, country — read outwards, the way it is said
                             aloud and the way it is written on the form. */}
                    <dt>Place of birth</dt><dd>${(() => {
                      const parts = [client.birth_town, client.birth_region,
                                     countryName(client.birth_country) || null].filter(Boolean);
                      return parts.length
                        ? html`${parts.join(', ')}` : html`<span class="muted">—</span>`;
                    })()}</dd>
                    <dt>Gender</dt><dd>${client.gender
                      ? labelFor(genderTerms, client.gender) : html`<span class="muted">—</span>`}</dd>
                    <dt>Relationship status</dt><dd>${client.relationship_status
                      ? labelFor(relationshipTerms, client.relationship_status)
                      : html`<span class="muted">—</span>`}</dd>
                  </dl>

                  ${employer ? html`
                    <p class="subhead">Employment</p>
                    <dl class="kv kv-aligned">
                      <dt>Works for</dt><dd><a href="/clients/${employer.id}">${employer.full_name}</a>
                        ${client.organisation_role ? html`<div class="muted small">${client.organisation_role}</div>` : ''}
                        ${employer.primary_contact_id === client.id ? badge('Primary contact', 'green') : ''}</dd>
                    </dl>` : ''}`)}


            ${'' /* Correspondence, read from where it lives rather than copied
                     onto a timeline. A message with two owners disagrees with
                     itself the first time one of them is edited. */}
            ${'' /* An organisation keeps a Contact card of its own. A person's
                    contact details moved into Key details on 12 September 2026, with
                    the given names and family name that had been sitting in this box
                    and are not contact details at all. */}
            ${isOrg ? card('Contact', html`
              <dl class="kv">
                <dt>Phone</dt><dd>${client.phone
                  ? html`<a href="tel:${client.phone}">${client.phone}</a>` : '—'}</dd>
                <dt>Email</dt><dd>${client.email ? html`<a href="mailto:${client.email}">${client.email}</a>` : '—'}</dd>
                <dt>WhatsApp</dt><dd>${client.whatsapp
                  ? html`<a href="tel:${client.whatsapp}">${client.whatsapp}</a>` : '—'}</dd>
                <dt>Telegram</dt><dd>${client.telegram_username ?? client.telegram_user_id ?? '—'}</dd>
                <dt>Address</dt><dd>${client.address ?? '—'}</dd>
              </dl>`) : ''}

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

            ${'' /* Reaching them comes first. The card used to open with
                     three rows of name parts — given, family, preferred — above
                     the email address, on a page whose heading already says
                     their name in full. The parts still matter, because an
                     INZ form asks for them separately, so they stay; they
                     simply stop standing between the reader and the phone
                     number. Both the phone and the email are links, so the row
                     is the action rather than something to copy out of. */}
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
                      <div class="small muted">${stamp(t.last_message_at)}</div>
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
                  ${'' /* Was a sentence saying this is how a family group shows itself
                          without a second list being maintained. The list above already
                          shows it. */}`)
              : ''}

            ${'' /* Matters have had these since migration 0007 and clients
                     never did, for no reason anybody recorded. Asked for
                     8 September 2026. The same tag list serves both, so a tag
                     invented on a matter is the same tag here. */}
            ${card('Open tasks', tasks.length === 0
              ? emptyState('Nothing outstanding.')
              : html`<ul class="list">${tasks.map((t: any) => html`
                  <li><a href="/tasks#${t.id}">${t.title}</a> <span class="muted small">${dateShort(t.due_at)}</span></li>`)}</ul>`)}

            ${card('Recent inquiries', inquiries.length === 0
              ? emptyState('None recorded.')
              : html`<ul class="list">${inquiries.map((i: any) => html`
                  <li><a href="/inquiries/${i.id}">${i.subject || i.ref}</a>
                      <span class="muted small">${stamp(i.received_at)}</span></li>`)}</ul>`)}

            ${card('Notes', html`<p class="prewrap">${client.notes || '—'}</p>`)}
            ${foldingCard('Tags', html`
              ${clientTags.length === 0
                ? html`<p class="muted small">No tags yet.</p>`
                : html`<div class="tag-row">${clientTags.map((tag) => html`
                    <span class="tag-chip">
                      ${badge(tag.name, tag.colour)}
                      ${writable ? html`
                        <form method="post" action="/clients/${client.id}/tags/${tag.id}/remove" class="inline-form">
                          ${csrfField(csrf)}
                          <button class="btn-tag-remove" type="submit"
                                  aria-label="Remove the tag ${tag.name}"
                                  title="Remove the tag ${tag.name}">×</button>
                        </form>` : ''}
                    </span>`)}</div>`}
              ${writable ? html`
                <details class="tag-add">
                  <summary>Add a tag</summary>
                  <form method="post" action="/clients/${client.id}/tags" class="tag-form">
                    ${csrfField(csrf)}
                    <label class="sr-only" for="f_tag">Tag</label>
                    <input id="f_tag" name="tag" list="client-tag-options" maxlength="40" required
                           placeholder="Type a new tag or pick one" autocomplete="off">
                    <datalist id="client-tag-options">
                      ${allTags.map((tag) => html`<option value="${tag.name}"></option>`)}
                    </datalist>
                    <button class="btn btn-secondary btn-small" type="submit">Add</button>
                    <p class="hint">Anything you type that does not exist yet is created, and is
                       then available on matters too.</p>
                  </form>
                </details>` : ''}`)}

          </div>
        </div>`);
    });

    // --- Edit ---------------------------------------------------------------
    r.get('/:id/edit', requirePermission('register:write'), async (c) => {
      const client = await one<ClientRow>(c.env.DB, 'SELECT * FROM clients WHERE id = ?', c.req.param('id')!);
      if (!client) return c.notFound();
      const [users, organisations, vocab, passports] = await Promise.all([
        userOptions(c.env), organisationOptions(c.env), clientVocabularies(c.env),
        passportsFor(c.env, client.id)]);
      const primary = passports.find((row) => row.is_primary === 1) ?? null;
      const nationalities = await nationalitiesFor(c.env, client.id);
      return page(c, { title: `Edit ${client.full_name}`, active: '/clients' }, html`
        ${breadcrumbs([{ href: '/clients', label: 'Clients' }, { href: `/clients/${client.id}`, label: client.ref }, { label: 'Edit' }])}
        ${pageHeader(`Edit ${client.full_name}`)}
        ${clientForm(c, { ...client, passport_issued: primary?.issued_on ?? null, nationalities },
                     users, organisations, vocab)}
        ${await clientDeleteCard(c, client)}`);
    });

    /**
     * Delete a client.
     *
     * **Asked for on 9 September 2026:** *"the same for clients - must be able
     * to delete"*, immediately after the same for matters, and for the same
     * reason — an intake that ran twice left three empty people behind.
     *
     * For a record made by mistake, and nothing else. Everything that would
     * make it something else is refused by migration 0076 rather than checked
     * here, so a second route cannot forget: matters, invoices, a quotation
     * that has gone out, documents, a note anybody wrote, or being named on
     * somebody else's matter.
     *
     * The note rule is the one that will surprise, so the message says what to
     * do instead. A note cannot be deleted and there is nowhere above a client
     * to move it to, so a client who has been written about is archived, not
     * removed — which keeps the file and stops the alerts.
     */
    r.post('/:id/delete', requirePermission('register:delete'), async (c) => {
      const id = c.req.param('id')!;
      const client = await one<ClientRow>(c.env.DB, 'SELECT * FROM clients WHERE id = ?', id);
      if (!client) return c.notFound();

      // Typing the reference survives a mis-click, a double submit, and a
      // browser with scripting switched off, which the dialogue does not.
      const f = new FormReader(await c.req.formData());
      const typed = (f.optional('confirm_ref', { max: 20 }) ?? '').trim().toUpperCase();
      if (typed !== client.ref.toUpperCase()) {
        return redirectWith(c, `/clients/${id}/edit`,
          `Type ${client.ref} exactly to delete it.`, 'err');
      }

      try {
        await run(c.env.DB, 'DELETE FROM clients WHERE id = ?', id);
      } catch (err) {
        return redirectWith(c, `/clients/${id}/edit`,
          deleteRefusal(err) ?? 'That client could not be deleted.', 'err');
      }

      await auditFrom(c, {
        action: 'client.deleted_by_hand', entityType: 'client', entityId: id,
        meta: { ref: client.ref, kind: client.kind, status: client.status },
      });
      return redirectWith(c, '/clients',
        `${client.ref} deleted. The reference is retired and will not be reissued.`);
    });

    // --- Passports ----------------------------------------------------------
    //
    // The primary one is edited on the client form; these routes are for the
    // second and third.
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
        return redirectWith(c, `/clients/${id}?open=passports#passports`,
          'A passport needs at least a country, a number or a date.', 'err');
      }
      if (issuedOn && expiresOn && expiresOn < issuedOn) {
        return redirectWith(c, `/clients/${id}?open=passports#passports`,
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
      return redirectWith(c, `/clients/${id}?open=passports#passports`, 'Passport recorded.');
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
      return redirectWith(c, `/clients/${id}?open=passports#passports`,
        ok ? 'Primary passport changed.' : 'That passport was not found.', ok ? 'ok' : 'err');
    });

    r.post('/:id/passports/:pid/remove', requirePermission('register:write'), async (c) => {
      const id = c.req.param('id')!;
      const pid = c.req.param('pid')!;
      const target = await passportById(c.env, id, pid);
      if (target?.is_primary === 1) {
        return redirectWith(c, `/clients/${id}?open=passports#passports`,
          'The primary passport is removed from the client form, not here \u2014 so that the '
          + 'record never ends up with none.', 'err');
      }
      const ok = await removePassport(c.env, id, pid);
      if (ok) {
        await auditFrom(c, { action: 'client.passport_removed', entityType: 'client', entityId: id,
          meta: { country: target?.country ?? null } });
      }
      return redirectWith(c, `/clients/${id}?open=passports#passports`,
        ok ? 'Passport removed.' : 'That passport was already gone.', ok ? 'ok' : 'err');
    });

    // --- Certificates -------------------------------------------------------
    // Employment, education and travel. Registered from their own file, which
    // is where everything about them lives — the three differ only in their
    // columns, and one set of routes reads that difference from a definition.
    registerHistoryRoutes(r);

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
        return redirectWith(c, `/clients/${id}?open=certificates#certificates`,
          `A ${CERTIFICATE_LABELS[kind as CertificateKind].toLowerCase()} needs its issue date — `
          + 'the expiry is worked out from it.', 'err');
      }
      if (!derived && !issuedOn && !expiresOn) {
        return redirectWith(c, `/clients/${id}?open=certificates#certificates`,
          'Give at least one date — otherwise there is nothing to watch.', 'err');
      }
      if (submittedOn && issuedOn && submittedOn < issuedOn) {
        return redirectWith(c, `/clients/${id}?open=certificates#certificates`,
          'A certificate cannot have been submitted before it was issued.', 'err');
      }
      if (!derived && issuedOn && expiresOn && expiresOn < issuedOn) {
        return redirectWith(c, `/clients/${id}?open=certificates#certificates`,
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
      return redirectWith(c, `/clients/${id}?open=certificates#certificates`, 'Certificate recorded.');
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
        return redirectWith(c, `/clients/${id}?open=certificates#certificates`,
          'A certificate cannot have been submitted before it was issued.', 'err');
      }

      await setCertificateSubmitted(c.env, id, certId, submittedOn);
      const after = await one<{ expires_on: string | null }>(
        c.env.DB, 'SELECT expires_on FROM client_certificates WHERE id = ?', certId);
      // "Now good until" only where the date actually moved. An x-ray derives
      // nothing, so its expiry is whatever somebody typed and saying it moved
      // would put a false sentence on an append-only file.
      const movedTo = expiryIsDerived(cert.kind as CertificateKind) && after?.expires_on
        ? `; now good until ${dateShort(after.expires_on)}` : '';
      await addEntry(c.env, {
        entityType: 'client', entityId: id, kind: 'system',
        body: submittedOn
          ? `${CERTIFICATE_LABELS[cert.kind as CertificateKind]} recorded as submitted with an `
            + `application on ${dateShort(submittedOn)}${movedTo}.`
          : `${CERTIFICATE_LABELS[cert.kind as CertificateKind]} no longer recorded as submitted`
            + `${movedTo}.`,
        createdBy: c.get('user')!.id,
      });
      await auditFrom(c, { action: 'client.certificate_submitted', entityType: 'client', entityId: id,
        meta: { certId, submittedOn } });
      return redirectWith(c, `/clients/${id}?open=certificates#certificates`,
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
      return redirectWith(c, `/clients/${id}?open=certificates#certificates`,
        ok ? 'Confirmed — the date now counts as read from the certificate.'
           : 'Nothing to confirm on that certificate.', ok ? 'ok' : 'err');
    });

    // Correcting what a certificate says.
    //
    // Asked for on 11 September 2026: *"need an option to edit PC and Medical
    // Cert details when needed, with appropriate log entries."* The log entries
    // are the reason this is a route and not a delete-and-retype: a file note
    // naming the date that moved is a record, and a removed certificate is not.
    //
    // The kind is not editable. A police certificate that turns out to be a
    // medical is a different document, not a corrected one.
    r.post('/:id/certificates/:certId', requirePermission('register:write'), async (c) => {
      const id = c.req.param('id')!;
      const certId = c.req.param('certId')!;
      const f = new FormReader(await c.req.formData());

      const existing = await one<CertificateRow>(
        c.env.DB, 'SELECT * FROM client_certificates WHERE id = ? AND client_id = ?', certId, id);
      if (!existing) return c.notFound();
      const derived = expiryIsDerived(existing.kind);

      const issuedOn = f.date('issued_on');
      const submittedOn = f.date('submitted_on');
      const expiresOn = f.date('expires_on');

      // The same three refusals the add form makes, in the same words, because
      // they are the same three facts.
      if (derived && !issuedOn) {
        return redirectWith(c, `/clients/${id}?open=certificates#certificates`,
          `A ${CERTIFICATE_LABELS[existing.kind].toLowerCase()} needs its issue date — `
          + 'the expiry is worked out from it.', 'err');
      }
      if (!derived && !issuedOn && !expiresOn) {
        return redirectWith(c, `/clients/${id}?open=certificates#certificates`,
          'Give at least one date — otherwise there is nothing to watch.', 'err');
      }
      if (submittedOn && issuedOn && submittedOn < issuedOn) {
        return redirectWith(c, `/clients/${id}?open=certificates#certificates`,
          'A certificate cannot have been submitted before it was issued.', 'err');
      }
      if (!derived && issuedOn && expiresOn && expiresOn < issuedOn) {
        return redirectWith(c, `/clients/${id}?open=certificates#certificates`,
          'A certificate cannot expire before it was issued.', 'err');
      }

      const before = await updateCertificate(c.env, id, certId, {
        subtype: f.optional('subtype', { max: 40 }),
        country: f.optional('country', { max: 100 }),
        reference: f.optional('reference', { max: 80 }),
        issuedOn,
        issuedOnProvenance: (f.enum('issued_on_provenance',
          PROVENANCE_OPTIONS.map((o) => o.value), { fallback: 'unverified' })
          ?? 'unverified') as IssueDateProvenance,
        submittedOn, expiresOn,
        notes: f.optional('notes', { max: 300 }),
      });
      if (!before) return c.notFound();

      // Read back rather than assumed: the expiry is the database's to set, and
      // the whole reason to note the change is that moving the issue date moves
      // the deadline by itself.
      const after = await one<CertificateRow>(
        c.env.DB, 'SELECT * FROM client_certificates WHERE id = ?', certId);
      const changes = after ? certificateChanges(before, after, dateShort) : [];
      if (changes.length > 0) {
        await addEntry(c.env, {
          entityType: 'client', entityId: id, kind: 'system',
          body: `${CERTIFICATE_LABELS[existing.kind]} corrected: ${changes.join('; ')}.`,
          createdBy: c.get('user')!.id,
        });
        await auditFrom(c, { action: 'client.certificate_edited', entityType: 'client', entityId: id,
          meta: { certId, changes } });
      }
      return redirectWith(c, `/clients/${id}?open=certificates#certificates`,
        changes.length > 0 ? 'Certificate updated.' : 'Nothing changed.');
    });

    r.post('/:id/certificates/:certId/remove', requirePermission('register:write'), async (c) => {
      const id = c.req.param('id')!;
      const ok = await removeCertificate(c.env, id, c.req.param('certId')!);
      await auditFrom(c, { action: 'client.certificate_removed', entityType: 'client', entityId: id,
        meta: { ok } });
      return redirectWith(c, `/clients/${id}?open=certificates#certificates`,
        ok ? 'Certificate removed.' : 'That certificate was already gone.', ok ? 'ok' : 'err');
    });

    r.post('/:id', requirePermission('register:write'), async (c) => {
      const id = c.req.param('id')!;
      const user = c.get('user')!;
      const existing = await one<ClientRow>(c.env.DB, 'SELECT * FROM clients WHERE id = ?', id);
      if (!existing) return c.notFound();

      const f = new FormReader(await c.req.formData());
      const vocab = await clientVocabularies(c.env);
      const v = readClientForm(f, vocab);
      if (!f.valid) {
        const [users, organisations] = await Promise.all([
          userOptions(c.env), organisationOptions(c.env)]);
        return page(c, { title: 'Edit client', active: '/clients', status: 400 }, html`
          ${pageHeader(`Edit ${existing.full_name}`)}
          ${clientForm(c, { ...existing, ...v } as ClientFormValues, users, organisations, vocab, f.errors)}`);
      }

      // Three outcomes, and the contradictory one is refused rather than
      // guessed at: replacing a number and removing it are different
      // intentions, and picking one for somebody would be picking wrong half
      // the time.
      if (v.passport_clear && v.passport_number) {
        return redirectWith(c, `/clients/${id}/edit`,
          'Either enter a new passport number or tick to remove the one on file — not both.', 'err');
      }
      // The database has the last word, and its refusal is shown on the form
      // rather than as a 500. See `refusalMessage`.
      try {
      await run(
        c.env.DB,
        `UPDATE clients SET kind=?, full_name=?, given_names=?, family_name=?, preferred_name=?,
           nzbn=?, company_number=?, organisation_id=?, organisation_role=?, email=?, phone=?, whatsapp=?, telegram_username=?, telegram_user_id=?,
           date_of_birth=?,
           english_test_type=?, english_test_score=?, english_test_date=?,
           current_visa_type=?, current_visa_start=?, current_visa_expiry=?, current_visa_expiry_rule=?,
           current_visa_conditions=?, current_visa_stay_limit=?, inz_client_number=?,
           title=?, gender=?, relationship_status=?, other_names=?,
           birth_country=?, birth_region=?, birth_town=?,
           national_id_number=?, national_id_country=?,
           military_compulsory=?, military_served=?, military_exempt=?,
           military_exemption_detail=?,
           address=?, status=?, assigned_to=?, notes=?, updated_at=?
         WHERE id=?`,
        v.kind, v.full_name, v.given_names, v.family_name, v.preferred_name,
        v.nzbn, v.company_number, v.organisation_id || null, v.organisation_role,
        v.email, v.phone, v.whatsapp, v.telegram_username, v.telegram_user_id,
        v.date_of_birth,
        v.english_test_type, v.english_test_score, v.english_test_date,
        v.current_visa_type, v.current_visa_start, v.current_visa_expiry, v.current_visa_expiry_rule,
        v.current_visa_conditions, v.current_visa_stay_limit, v.inz_client_number,
        v.title, v.gender, v.relationship_status, v.other_names,
        v.birth_country, v.birth_region, v.birth_town,
        v.national_id_number, v.national_id_country,
        v.military_compulsory, v.military_served, v.military_exempt, v.military_exemption_detail,
        v.address, v.status, v.assigned_to || null, v.notes,
        nowIso(), id,
      );
      await c.env.DB.batch(setNationalityStatements(c.env, id, v.nationalities));
      } catch (err) {
        const said = refusalMessage(err);
        if (!said) throw err;
        const [users, organisations] = await Promise.all([
          userOptions(c.env), organisationOptions(c.env)]);
        return page(c, { title: 'Edit client', active: '/clients', status: 400 }, html`
          ${pageHeader(`Edit ${existing.full_name}`)}
          ${clientForm(c, { ...existing, ...v } as ClientFormValues, users, organisations, vocab,
            { ...f.errors, _form: said })}`);
      }

      // A matter is named after the person it is for, so correcting a spelling
      // here has to reach the matters as well. Without this the old spelling
      // stays on the front of every matter they have, and the name drifts out
      // of step with the record it names — which is exactly how every matter in
      // the register came to be called by its own description. See
      // `src/core/casename.ts`.
      if (existing.full_name !== v.full_name) {
        const renamed = await renameMattersFor(c.env, id, await caseTypes(c.env));
        if (renamed) {
          await addEntry(c.env, {
            entityType: 'client', entityId: id, kind: 'system',
            body: `Name changed from ${existing.full_name} to ${v.full_name}. `
              + `${renamed} ${renamed === 1 ? 'matter was' : 'matters were'} renamed to match.`,
            createdBy: user.id,
          });
        }
      }

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

      // A change to the passport number gets its own entry, so the file says
      // who altered it and when. The number itself is never written to either
      // the log or the timeline — the record says that it changed, not what to.
      if (v.passport_clear && existing.passport_number) {
        await auditFrom(c, { action: 'client.passport_cleared', entityType: 'client', entityId: id });
        await addEntry(c.env, { entityType: 'client', entityId: id, kind: 'system',
          body: 'Passport number removed from the file.', createdBy: c.get('user')!.id });
      } else if (v.passport_number) {
        await auditFrom(c, {
          action: 'client.passport_set', entityType: 'client', entityId: id,
          meta: { replaced: Boolean(existing.passport_number) },
        });
        await addEntry(c.env, { entityType: 'client', entityId: id, kind: 'system',
          body: existing.passport_number
            ? 'Passport number replaced.' : 'Passport number recorded.',
          createdBy: c.get('user')!.id });
      }
      await auditFrom(c, { action: 'client.updated', entityType: 'client', entityId: id });
      return redirectWith(c, `/clients/${id}`, 'Client updated.');
    });

    // --- Tags -----------------------------------------------------------------
    r.post('/:id/tags', requirePermission('register:write'), async (c) => {
      const id = c.req.param('id')!;
      const user = c.get('user')!;
      const f = new FormReader(await c.req.formData());
      const name = f.text('tag', { required: true, label: 'Tag', max: 40 });
      if (!f.valid) return redirectWith(c, `/clients/${id}`, 'Type a tag.', 'err');

      const tag = await findOrCreateTag(c.env, name, user.id);
      if (!tag) return redirectWith(c, `/clients/${id}`, 'That tag name is empty.', 'err');

      await attachTag(c.env, 'client', id, tag.id, user.id);
      await auditFrom(c, { action: 'client.tagged', entityType: 'client', entityId: id,
        meta: { tag: tag.name } });
      return redirectWith(c, `/clients/${id}`, `Tagged “${tag.name}”.`);
    });

    r.post('/:id/tags/:tagId/remove', requirePermission('register:write'), async (c) => {
      const id = c.req.param('id')!;
      const tagId = c.req.param('tagId')!;
      await detachTag(c.env, 'client', id, tagId);
      await auditFrom(c, { action: 'client.untagged', entityType: 'client', entityId: id,
        meta: { tag: tagId } });
      return redirectWith(c, `/clients/${id}`, 'Tag removed.');
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
      // Checked against the practice's own list rather than a list in the
      // code — see NOTE_KIND_VOCAB. A kind that is not on it falls back to
      // a plain note rather than being refused: the words are the note.
      const writable_kinds = await noteKinds(c.env);
      const submitted = f.optional('kind', { max: 40 });
      const kind = (isTerm(writable_kinds, submitted) ? submitted : 'note') as EntryKind;
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
