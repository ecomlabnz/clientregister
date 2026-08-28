/**
 * Generate demonstration data for the register.
 *
 * Prints SQL to stdout; nothing here touches a database on its own, so the
 * output can be read before it is applied.
 *
 *   node scripts/seed-demo.mjs > /tmp/seed.sql
 *
 * Every row it creates has an id beginning `demo_`, so the whole set can be
 * removed again with scripts/seed-demo-remove.sql. That prefix is the only
 * thing marking it as fabricated, which matters: this data sits in the same
 * tables as real client files.
 *
 * Dates are generated relative to today so the alerts and deadlines are
 * meaningful whenever the seed is run, rather than expiring into the past.
 */

const now = new Date();
const iso = (d) => d.toISOString();
const day = (offset) => {
  const d = new Date(now.getTime() + offset * 86_400_000);
  return d.toISOString().slice(0, 10);
};
const at = (offset) => iso(new Date(now.getTime() + offset * 86_400_000));

const q = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const out = [];
const emit = (sql) => out.push(sql);

let clientSeq = 0;
let caseSeq = 0;
let quoteSeq = 0;

/**
 * Every seeded record says on its face that it is fabricated. The `demo_` id
 * prefix makes removal possible; this makes it obvious on screen, so nobody
 * mistakes Ana Maria Silva for a real client or quotes her a real fee.
 */
const DEMO_NOTE = '[TEST DATA] Fabricated for demonstration. Safe to delete.';

const clients = new Map();
function client(key, row) {
  clientSeq += 1;
  const id = `demo_cli_${key}`;
  const ref = `CL-${String(clientSeq).padStart(4, '0')}`;
  clients.set(key, { id, ref, name: row.full_name });
  emit(
    `INSERT INTO clients (id, ref, kind, full_name, given_names, family_name, preferred_name, nzbn,` +
    ` company_number, email, phone, whatsapp, nationality, date_of_birth, passport_country,` +
    ` passport_expiry, police_certificate_country, police_certificate_date, police_certificate_expiry,` +
    ` medical_certificate_date, medical_certificate_expiry, current_visa_type, current_visa_expiry,` +
    ` address, status, notes, organisation_id, organisation_role, created_at, updated_at) VALUES (` +
    [id, ref, row.kind ?? 'individual', row.full_name, row.given_names ?? null, row.family_name ?? null,
     row.preferred_name ?? null, row.nzbn ?? null, row.company_number ?? null, row.email ?? null,
     row.phone ?? null, row.whatsapp ?? null, row.nationality ?? null, row.date_of_birth ?? null,
     row.passport_country ?? null, row.passport_expiry ?? null, row.police_country ?? null,
     row.police_date ?? null, row.police_expiry ?? null, row.medical_date ?? null,
     row.medical_expiry ?? null, row.visa_type ?? null, row.visa_expiry ?? null, row.address ?? null,
     row.status ?? 'active', DEMO_NOTE + (row.notes ? ` ${row.notes}` : ''),
     row.org ? clients.get(row.org).id : null, row.org_role ?? null,
     at(row.created ?? -120), at(row.updated ?? -3),
    ].map(q).join(', ') + ');',
  );
  return id;
}

const cases = new Map();
function kase(key, row) {
  caseSeq += 1;
  const id = `demo_cas_${key}`;
  const ref = `CASE-${String(caseSeq).padStart(4, '0')}`;
  cases.set(key, { id, ref, title: row.title });
  emit(
    `INSERT INTO cases (id, ref, client_id, title, case_type, status, priority, inz_application_number,` +
    ` lodged_at, decision_due_at, decided_at, outcome, next_action, next_action_due, summary,` +
    ` currency, created_at, updated_at, closed_at) VALUES (` +
    [id, ref, clients.get(row.client).id, row.title, row.case_type, row.status, row.priority ?? 'normal',
     row.inz ?? null, row.lodged ?? null, row.due ?? null, row.decided ?? null, row.outcome ?? null,
     row.next_action ?? null, row.next_due ?? null, row.summary ?? null, 'NZD',
     at(row.created ?? -90), at(row.updated ?? -2), row.closed ?? null,
    ].map(q).join(', ') + ');',
  );
  emit(
    `INSERT INTO case_status_history (id, case_id, from_status, to_status, at, note) VALUES (` +
    [`demo_csh_${key}`, id, null, row.status, at(row.created ?? -90), 'Seeded demonstration data'].map(q).join(', ') + ');',
  );
  return id;
}

let partySeq = 0;
function party(caseKey, clientKey, role, notes) {
  partySeq += 1;
  emit(
    `INSERT INTO case_parties (id, case_id, client_id, role, notes, created_at) VALUES (` +
    [`demo_prt_${partySeq}`, cases.get(caseKey).id, clients.get(clientKey).id, role, notes ?? null,
     at(-80)].map(q).join(', ') + ');',
  );
}

const tagIds = new Map();
function tag(name, colour = 'neutral') {
  const id = `demo_tag_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
  if (!tagIds.has(name)) {
    tagIds.set(name, id);
    emit(`INSERT INTO tags (id, name, colour, created_at) VALUES (${[id, name, colour, at(-100)].map(q).join(', ')});`);
  }
  return tagIds.get(name);
}

function tagCase(caseKey, names) {
  // Always include the marker tag, so the whole set is visible on any case
  // list and can be filtered down to in one click.
  for (const name of [...names, 'Test data']) {
    emit(
      `INSERT INTO case_tags (case_id, tag_id, created_at) VALUES (` +
      [cases.get(caseKey).id, tagIds.get(name), at(-80)].map(q).join(', ') + ');',
    );
  }
}

let feeSeq = 0;
function fee(caseKey, description, kind, amountCents, treatment, status, includeInSplit = 1) {
  feeSeq += 1;
  const rate = treatment === 'none' ? 0 : 1500;
  let net; let gst;
  if (treatment === 'inclusive') { net = Math.round((amountCents * 10000) / (10000 + rate)); gst = amountCents - net; }
  else if (treatment === 'none') { net = amountCents; gst = 0; }
  else { net = amountCents; gst = Math.round((amountCents * rate) / 10000); }
  emit(
    `INSERT INTO fee_items (id, case_id, description, kind, amount_cents, gst_treatment, gst_rate_bp,` +
    ` net_cents, gst_cents, gross_cents, currency, include_in_split, status, invoiced_at, paid_at,` +
    ` created_at, updated_at) VALUES (` +
    [`demo_fee_${feeSeq}`, cases.get(caseKey).id, description, kind, amountCents, treatment, rate,
     net, gst, net + gst, 'NZD', includeInSplit, status,
     status === 'invoiced' || status === 'paid' ? at(-30) : null,
     status === 'paid' ? at(-20) : null, at(-60), at(-30)].map(q).join(', ') + ');',
  );
}

let shareSeq = 0;
function split(caseKey, shares) {
  for (const [i, sh] of shares.entries()) {
    shareSeq += 1;
    emit(
      `INSERT INTO fee_shares (id, case_id, party_key, label, percent_bp, position, created_at, updated_at) VALUES (` +
      [`demo_shr_${shareSeq}`, cases.get(caseKey).id, sh.key, sh.label, sh.bp, i, at(-60), at(-60)].map(q).join(', ') + ');',
    );
  }
}

let taskSeq = 0;
/**
 * Every task has an owner, so the demonstration data has to name one. It cannot
 * be hard-coded — the accounts differ between installations — so the owner
 * account is looked up in the statement itself. If somehow no account is
 * active, the insert is skipped rather than failing the whole seed.
 */
const OWNER_ID = `(SELECT id FROM users WHERE status = 'active'` +
  ` ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, created_at LIMIT 1)`;

function task(caseKey, title, dueOffset, priority = 'normal', status = 'open') {
  taskSeq += 1;
  emit(
    `INSERT INTO tasks (id, title, details, status, priority, due_at, assigned_to, entity_type,` +
    ` entity_id, created_at, updated_at)` +
    ` SELECT ${[`demo_tsk_${taskSeq}`, title, null, status, priority, day(dueOffset)].map(q).join(', ')},` +
    ` ${OWNER_ID}, ${q('case')}, ${q(cases.get(caseKey).id)}, ${q(at(-30))}, ${q(at(-5))}` +
    ` WHERE ${OWNER_ID} IS NOT NULL;`,
  );
}

function quote(caseKey, clientKey, description, netCents, disbCents, status, validOffset) {
  quoteSeq += 1;
  const ref = `Q-${String(quoteSeq).padStart(4, '0')}`;
  emit(
    `INSERT INTO quotes (id, ref, client_id, case_id, description, amount_cents, gst_cents,` +
    ` disbursements_cents, currency, status, valid_until, sent_at, created_at, updated_at) VALUES (` +
    [`demo_quo_${quoteSeq}`, ref, clients.get(clientKey).id, cases.get(caseKey).id, description,
     netCents, Math.round(netCents * 0.15), disbCents, 'NZD', status, day(validOffset),
     status === 'draft' ? null : at(-40), at(-45), at(-20)].map(q).join(', ') + ');',
  );
}

let entrySeq = 0;
function note(entityType, entityId, body, kind = 'note', offset = -10) {
  entrySeq += 1;
  emit(
    `INSERT INTO entries (id, entity_type, entity_id, kind, body, occurred_at, pinned, created_at) VALUES (` +
    [`demo_ent_${entrySeq}`, entityType, entityId, kind, body, at(offset), 0, at(offset)].map(q).join(', ') + ');',
  );
}

// ---------------------------------------------------------------------------
emit('-- Demonstration data. Every id begins `demo_`; see scripts/seed-demo-remove.sql.');
emit('PRAGMA foreign_keys = ON;');

// --- Organisations ---------------------------------------------------------
// Each of these is a client of its own matter and an employer on someone
// else's, which is the case the party model exists for.
client('harbour', {
  kind: 'organisation', full_name: 'Harbour Cafe Group Limited', nzbn: '9429041234567',
  company_number: '1234567', email: 'accounts@harbourcafe.example', phone: '09 555 0110',
  address: '12 Quay Street, Auckland 1010', status: 'active',
  notes: 'Accredited employer. Client of its own accreditation, and the employer on Rahul Sharma’s AEWV.',
});
client('orchards', {
  kind: 'organisation', full_name: 'Kiwi Orchards Limited', nzbn: '9429045678901',
  company_number: '2345678', email: 'hr@kiwiorchards.example', phone: '07 555 0120',
  address: '480 Te Puke Highway, Te Puke 3183', status: 'active',
  notes: 'Seasonal horticulture employer. Client of the job check, employer on Sione Tagata’s AEWV.',
});
client('vineyards', {
  kind: 'organisation', full_name: 'Southern Vineyards Limited', nzbn: '9429049876543',
  company_number: '3456789', email: 'admin@southernvineyards.example', phone: '03 555 0130',
  address: '5 Vine Road, Blenheim 7201', status: 'active',
  notes: 'Employer on the Chen skilled residence, and the target business in the Park investor matter.',
});

// --- People at those organisations -----------------------------------------
// A company client is not who you ring: somebody signs the accreditation
// declaration. That person is a client record of their own.
client('tom', {
  full_name: 'Tom Whitfield', given_names: 'Tom', family_name: 'Whitfield', nationality: 'New Zealand',
  email: 'tom@harbourcafe.example', phone: '021 555 0111',
  address: '12 Quay Street, Auckland 1010',
  org: 'harbour', org_role: 'Director and signatory',
  notes: 'Signs the accreditation declarations for Harbour Cafe Group.',
});
client('hine', {
  full_name: 'Hine Rāwiri', given_names: 'Hine', family_name: 'Rāwiri', nationality: 'New Zealand',
  email: 'hine@kiwiorchards.example', phone: '027 555 0121',
  address: '480 Te Puke Highway, Te Puke 3183',
  org: 'orchards', org_role: 'People and Capability Manager',
  notes: 'Handles job checks and AEWV paperwork for Kiwi Orchards.',
});

// --- Sharma family (India) --------------------------------------------------
client('rahul', {
  full_name: 'Rahul Sharma', given_names: 'Rahul', family_name: 'Sharma', nationality: 'India',
  email: 'rahul.sharma@example.com', phone: '021 555 0201', whatsapp: '6421555201',
  date_of_birth: '1988-06-14', passport_country: 'India', passport_expiry: day(400),
  police_country: 'India', police_date: day(-120), police_expiry: day(60),
  medical_date: day(-150), medical_expiry: day(30),
  visa_type: 'AEWV (pending)', visa_expiry: day(45), address: '3/22 Grafton Road, Auckland',
});
client('priya', {
  full_name: 'Priya Sharma', given_names: 'Priya', family_name: 'Sharma', nationality: 'India',
  email: 'priya.sharma@example.com', phone: '021 555 0202', date_of_birth: '1990-02-03',
  passport_country: 'India', passport_expiry: day(120),
  visa_type: 'Visitor visa', visa_expiry: day(25), address: '3/22 Grafton Road, Auckland',
});
client('aarav', {
  full_name: 'Aarav Sharma', given_names: 'Aarav', family_name: 'Sharma', nationality: 'India',
  date_of_birth: '2013-09-21', passport_country: 'India', passport_expiry: day(700),
  visa_type: 'Dependent child visitor visa', visa_expiry: day(25),
  address: '3/22 Grafton Road, Auckland',
});

// --- Silva family (Brazil) --------------------------------------------------
client('ana', {
  full_name: 'Ana Maria Silva', given_names: 'Ana Maria', family_name: 'Silva', preferred_name: 'Ana',
  nationality: 'Brazil', email: 'ana.silva@example.com', phone: '022 555 0301', whatsapp: '6422555301',
  date_of_birth: '1992-04-11', passport_country: 'Brazil', passport_expiry: day(210),
  police_country: 'Brazil', police_date: day(-60), police_expiry: day(120),
  medical_date: day(-40), medical_expiry: day(320),
  visa_type: 'Interim visa', visa_expiry: day(90), address: '18 Ponsonby Road, Auckland',
});
client('bruno', {
  full_name: 'Bruno Silva', given_names: 'Bruno', family_name: 'Silva', nationality: 'New Zealand',
  email: 'bruno.silva@example.com', phone: '022 555 0302', date_of_birth: '1990-11-30',
  address: '18 Ponsonby Road, Auckland', notes: 'New Zealand citizen. Supporting partner on Ana’s residence application.',
});
client('mariasilva', {
  full_name: 'Maria Silva', given_names: 'Maria', family_name: 'Silva', nationality: 'Brazil',
  date_of_birth: '1962-01-19', passport_country: 'Brazil', passport_expiry: day(500),
  visa_type: 'Visitor visa', visa_expiry: day(150), status: 'inactive',
  notes: 'Ana’s mother. Visitor visa granted.',
});

// --- Chen family (China) ----------------------------------------------------
client('wei', {
  full_name: 'Wei Chen', given_names: 'Wei', family_name: 'Chen', nationality: 'China',
  email: 'wei.chen@example.com', phone: '027 555 0401', date_of_birth: '1985-08-02',
  passport_country: 'China', passport_expiry: day(340),
  police_country: 'China', police_date: day(-30), police_expiry: day(150),
  visa_type: 'AEWV', visa_expiry: day(260), address: '9 Redwood Avenue, Blenheim',
});
client('li', {
  full_name: 'Li Chen', given_names: 'Li', family_name: 'Chen', nationality: 'China',
  email: 'li.chen@example.com', phone: '027 555 0402', date_of_birth: '1987-12-15',
  passport_country: 'China', passport_expiry: day(75),
  visa_type: 'Visitor visa', visa_expiry: day(55), address: '9 Redwood Avenue, Blenheim',
});

// --- Others -----------------------------------------------------------------
client('sione', {
  full_name: 'Sione Tagata', given_names: 'Sione', family_name: 'Tagata', nationality: 'Samoa',
  email: 'sione.tagata@example.com', phone: '021 555 0501', whatsapp: '6421555501',
  date_of_birth: '1994-03-08', passport_country: 'Samoa', passport_expiry: day(180),
  police_country: 'Samoa', police_date: day(-200), police_expiry: day(-10),
  visa_type: 'AEWV', visa_expiry: day(20), address: 'RD 2, Te Puke',
  notes: 'Police certificate has expired — a fresh one is needed before the RFI response.',
});
client('mai', {
  full_name: 'Nguyen Thi Mai', given_names: 'Thi Mai', family_name: 'Nguyen', nationality: 'Vietnam',
  email: 'mai.nguyen@example.com', phone: '020 555 0601', date_of_birth: '2004-07-22',
  passport_country: 'Vietnam', passport_expiry: day(900),
  visa_type: 'Student visa', visa_expiry: day(40), address: '55 Symonds Street, Auckland',
});
client('joseph', {
  full_name: 'Joseph Okafor', given_names: 'Joseph', family_name: 'Okafor', nationality: 'Nigeria',
  email: 'joseph.okafor@example.com', phone: '021 555 0701', date_of_birth: '1991-05-05',
  passport_country: 'Nigeria', passport_expiry: day(260),
  visa_type: 'None — unlawful', address: '2 Hobson Street, Auckland',
  notes: 'Unlawful since visa expired. Section 61 request lodged.',
});
client('elena', {
  full_name: 'Elena Petrova', given_names: 'Elena', family_name: 'Petrova', nationality: 'Russia',
  email: 'elena.petrova@example.com', phone: '021 555 0801', date_of_birth: '1983-10-12',
  passport_country: 'Russia', passport_expiry: day(150),
  police_country: 'Russia', police_date: day(-90), police_expiry: day(90),
  visa_type: 'Work visa', visa_expiry: day(110), address: '14 Oriental Parade, Wellington',
  notes: 'PPI letter received regarding an undisclosed conviction.',
});
client('ahmed', {
  full_name: 'Ahmed Hassan', given_names: 'Ahmed', family_name: 'Hassan', nationality: 'Egypt',
  email: 'ahmed.hassan@example.com', phone: '021 555 0901', date_of_birth: '1989-01-27',
  passport_country: 'Egypt', passport_expiry: day(300),
  visa_type: 'None — visitor visa declined', address: 'Cairo, Egypt',
  notes: 'Visitor visa declined for insufficient funds. Reconsideration lodged.',
});
client('daniel', {
  full_name: 'Daniel Park', given_names: 'Daniel', family_name: 'Park', nationality: 'South Korea',
  email: 'daniel.park@example.com', phone: '021 555 1001', date_of_birth: '1976-09-09',
  passport_country: 'South Korea', passport_expiry: day(600),
  visa_type: 'Visitor visa', visa_expiry: day(200), address: 'Seoul, South Korea',
  notes: 'Considering an investment in Southern Vineyards. On hold pending due diligence.',
});
client('grace', {
  full_name: 'Grace Mwangi', given_names: 'Grace', family_name: 'Mwangi', nationality: 'Kenya',
  email: 'grace.mwangi@example.com', phone: '021 555 1101', status: 'prospect',
  notes: 'Enquired about a partnership work visa. Not yet engaged.', created: -6, updated: -6,
});

// Name each organisation's primary contact, now that both rows exist.
emit(`UPDATE clients SET primary_contact_id = ${q(clients.get('tom').id)} WHERE id = ${q(clients.get('harbour').id)};`);
emit(`UPDATE clients SET primary_contact_id = ${q(clients.get('hine').id)} WHERE id = ${q(clients.get('orchards').id)};`);

// --- Tags -------------------------------------------------------------------
tag('AEWV', 'blue');
tag('Partnership', 'neutral');
tag('Residence', 'green');
tag('Student', 'neutral');
tag('Visitor', 'neutral');
tag('Employer', 'amber');
tag('Family group', 'neutral');
tag('Urgent deadline', 'red');
tag('Seasonal', 'neutral');
tag('Section 61', 'red');
tag('Character', 'red');
tag('Appeal', 'amber');
tag('Investor', 'green');
tag('Accreditation', 'amber');
tag('Test data', 'red');

// --- Cases ------------------------------------------------------------------
kase('sharma_aewv', {
  client: 'rahul', title: 'AEWV — Chef, Harbour Cafe', case_type: 'wv_aewv', status: 'lodged',
  priority: 'high', inz: 'INZ-2026-114552', lodged: day(-35), due: day(28),
  next_action: 'Await decision; chase if nothing by the due date', next_due: day(28),
  summary: 'AEWV for a chef role with an accredited employer. Job check approved; application lodged.',
});
party('sharma_aewv', 'rahul', 'principal_applicant');
party('sharma_aewv', 'harbour', 'employer', 'Accredited employer, job check approved');
tagCase('sharma_aewv', ['AEWV', 'Employer', 'Family group']);
fee('sharma_aewv', 'AEWV — preparation and lodgement', 'professional', 250000, 'exclusive', 'paid');
fee('sharma_aewv', 'INZ application fee', 'disbursement', 75000, 'none', 'paid', 0);
split('sharma_aewv', [{ key: 'principal', label: 'Principal (me)', bp: 7000 }, { key: 'admin', label: 'Admin team', bp: 3000 }]);
task('sharma_aewv', 'Diarise decision follow-up with INZ', 28, 'normal');

kase('priya_partnership', {
  client: 'priya', title: 'Partnership work visa — partner of AEWV holder', case_type: 'wv_partner',
  status: 'gathering_documents', priority: 'high',
  next_action: 'Collect joint bank statements and tenancy agreement', next_due: day(9),
  summary: 'Partnership-based work visa relying on Rahul’s AEWV. Relationship evidence being assembled.',
});
party('priya_partnership', 'priya', 'principal_applicant');
party('priya_partnership', 'rahul', 'supporting_partner', 'AEWV holder');
tagCase('priya_partnership', ['Partnership', 'Family group']);
fee('priya_partnership', 'Partnership work visa — preparation', 'professional', 200000, 'exclusive', 'invoiced');
split('priya_partnership', [{ key: 'principal', label: 'Principal (me)', bp: 7000 }, { key: 'admin', label: 'Admin team', bp: 3000 }]);
task('priya_partnership', 'Chase joint bank statements', 9, 'high');
task('priya_partnership', 'Draft relationship submission', 16, 'normal');

kase('aarav_student', {
  client: 'aarav', title: 'Dependent child student visa', case_type: 'sv_general', status: 'preparing',
  next_action: 'Obtain offer of place from school', next_due: day(14),
  summary: 'Dependent child of an AEWV holder; domestic-fee student visa sought.',
});
party('aarav_student', 'aarav', 'principal_applicant');
party('aarav_student', 'rahul', 'sponsor', 'Parent and AEWV holder');
tagCase('aarav_student', ['Student', 'Family group']);
fee('aarav_student', 'Dependent child student visa', 'professional', 90000, 'exclusive', 'quoted');
split('aarav_student', [{ key: 'principal', label: 'Principal (me)', bp: 5000 }, { key: 'admin', label: 'Admin team', bp: 5000 }]);

kase('harbour_accreditation', {
  client: 'harbour', title: 'Employer accreditation renewal', case_type: 'ot_other', status: 'approved',
  inz: 'INZ-2026-098771', lodged: day(-120), decided: at(-70), outcome: 'approved',
  summary: 'Standard accreditation renewal for up to five migrant workers. Granted.',
});
party('harbour_accreditation', 'harbour', 'principal_applicant', 'The employer is the client on this matter');
tagCase('harbour_accreditation', ['Employer', 'Accreditation']);
fee('harbour_accreditation', 'Accreditation renewal', 'professional', 180000, 'exclusive', 'paid');
split('harbour_accreditation', [{ key: 'principal', label: 'Principal (me)', bp: 7000 }, { key: 'admin', label: 'Admin team', bp: 3000 }]);

kase('orchards_jobcheck', {
  client: 'orchards', title: 'Job check — 3 seasonal orchard roles', case_type: 'ot_other', status: 'lodged',
  inz: 'INZ-2026-121004', lodged: day(-18), due: day(12),
  next_action: 'Await job check outcome', next_due: day(12),
  summary: 'Job check for three seasonal orchard roles, advertised as required.',
});
party('orchards_jobcheck', 'orchards', 'principal_applicant', 'The employer is the client on this matter');
tagCase('orchards_jobcheck', ['Employer', 'Seasonal']);
fee('orchards_jobcheck', 'Job check — 3 roles', 'professional', 150000, 'exclusive', 'invoiced');
split('orchards_jobcheck', [{ key: 'principal', label: 'Principal (me)', bp: 6000 }, { key: 'admin', label: 'Admin team', bp: 4000 }]);

kase('sione_aewv', {
  client: 'sione', title: 'AEWV — Orchard worker, Kiwi Orchards', case_type: 'wv_aewv',
  status: 'inz_rfi', priority: 'urgent', inz: 'INZ-2026-118330', lodged: day(-50), due: day(6),
  next_action: 'Respond to RFI — fresh police certificate required', next_due: day(5),
  summary: 'INZ has asked for a current Samoan police certificate; the one on file has expired.',
});
party('sione_aewv', 'sione', 'principal_applicant');
party('sione_aewv', 'orchards', 'employer', 'Accredited employer');
tagCase('sione_aewv', ['AEWV', 'Employer', 'Seasonal', 'Urgent deadline']);
fee('sione_aewv', 'AEWV — preparation and lodgement', 'professional', 220000, 'exclusive', 'paid');
fee('sione_aewv', 'RFI response', 'professional', 60000, 'exclusive', 'invoiced');
split('sione_aewv', [{ key: 'principal', label: 'Principal (me)', bp: 7000 }, { key: 'admin', label: 'Admin team', bp: 3000 }]);
task('sione_aewv', 'Order replacement Samoan police certificate', 2, 'urgent');
task('sione_aewv', 'File RFI response with INZ', 5, 'urgent');

kase('ana_residence', {
  client: 'ana', title: 'Partnership residence — partner of NZ citizen', case_type: 'rv_partnership',
  status: 'interim_visa', priority: 'high', inz: 'INZ-2026-104488', lodged: day(-75), due: day(55),
  next_action: 'Await decision; client is on an interim visa', next_due: day(55),
  summary: 'Partnership residence with a New Zealand citizen partner. Lodged onshore before expiry; '
    + 'client holds an interim visa with the conditions of her previous visa.',
});
party('ana_residence', 'ana', 'principal_applicant');
party('ana_residence', 'bruno', 'supporting_partner', 'New Zealand citizen');
tagCase('ana_residence', ['Partnership', 'Residence', 'Family group']);
fee('ana_residence', 'Partnership residence — preparation and lodgement', 'professional', 380000, 'exclusive', 'paid');
fee('ana_residence', 'INZ application fee', 'disbursement', 153500, 'none', 'paid', 0);
split('ana_residence', [{ key: 'principal', label: 'Principal (me)', bp: 7500 }, { key: 'admin', label: 'Admin team', bp: 2500 }]);
quote('ana_residence', 'ana', 'Partnership residence — preparation and lodgement', 380000, 153500, 'accepted', -40);

kase('maria_visitor', {
  client: 'mariasilva', title: 'Visitor visa — parent of resident applicant', case_type: 'vv_general',
  status: 'approved', lodged: day(-100), decided: at(-60), outcome: 'approved',
  summary: 'Nine-month visitor visa to attend the birth of a grandchild. Granted.',
});
party('maria_visitor', 'mariasilva', 'principal_applicant');
party('maria_visitor', 'ana', 'sponsor', 'Daughter, residence applicant');
tagCase('maria_visitor', ['Visitor', 'Family group']);
fee('maria_visitor', 'Visitor visa', 'professional', 95000, 'exclusive', 'paid');
split('maria_visitor', [{ key: 'principal', label: 'Principal (me)', bp: 5000 }, { key: 'admin', label: 'Admin team', bp: 5000 }]);

kase('wei_skilled', {
  client: 'wei', title: 'Skilled residence — Green List straight to residence', case_type: 'rv_smc',
  status: 'preparing', priority: 'high',
  next_action: 'Obtain occupational registration evidence', next_due: day(21),
  summary: 'Green List residence with the partner included as a secondary applicant.',
});
party('wei_skilled', 'wei', 'principal_applicant');
party('wei_skilled', 'li', 'secondary_applicant', 'Partner, included in the application');
party('wei_skilled', 'vineyards', 'employer', 'Current AEWV employer');
tagCase('wei_skilled', ['Residence', 'Family group', 'Employer']);
fee('wei_skilled', 'Skilled residence — preparation', 'professional', 450000, 'exclusive', 'invoiced');
split('wei_skilled', [{ key: 'principal', label: 'Principal (me)', bp: 7000 }, { key: 'admin', label: 'Admin team', bp: 3000 }]);
task('wei_skilled', 'Chase occupational registration certificate', 21, 'high');
quote('wei_skilled', 'wei', 'Skilled residence — preparation and lodgement', 450000, 240000, 'sent', 20);

kase('li_partnership', {
  client: 'li', title: 'Partnership work visa — interim cover', case_type: 'wv_partner',
  status: 'engaged',
  next_action: 'Prepare application to maintain lawful status', next_due: day(18),
  summary: 'Partnership work visa to keep the partner lawful while the residence application is prepared.',
});
party('li_partnership', 'li', 'principal_applicant');
party('li_partnership', 'wei', 'supporting_partner', 'AEWV holder');
tagCase('li_partnership', ['Partnership', 'Family group']);
fee('li_partnership', 'Partnership work visa', 'professional', 200000, 'exclusive', 'quoted');
split('li_partnership', [{ key: 'principal', label: 'Principal (me)', bp: 7000 }, { key: 'admin', label: 'Admin team', bp: 3000 }]);

kase('joseph_s61', {
  client: 'joseph', title: 'Section 61 request — unlawful since March', case_type: 'rq_section_61_request',
  status: 'lodged', priority: 'urgent', lodged: day(-10), due: day(3),
  next_action: 'Follow up with the Resolution team', next_due: day(3),
  summary: 'Section 61 request following a visa expiry that went unnoticed. No right of appeal; '
    + 'the request is entirely at the Minister’s discretion.',
});
party('joseph_s61', 'joseph', 'principal_applicant');
tagCase('joseph_s61', ['Section 61', 'Urgent deadline']);
fee('joseph_s61', 'Section 61 request', 'professional', 175000, 'exclusive', 'invoiced');
split('joseph_s61', [{ key: 'principal', label: 'Principal (me)', bp: 8000 }, { key: 'admin', label: 'Admin team', bp: 2000 }]);
task('joseph_s61', 'Call INZ Resolution team for an update', 3, 'urgent');

kase('mai_student', {
  client: 'mai', title: 'Student visa — further study, Bachelor of Nursing', case_type: 'sv_general',
  status: 'ready_to_lodge',
  next_action: 'Lodge once the tuition receipt arrives', next_due: day(7),
  summary: 'Second-year student visa. All documents held except the tuition fee receipt.',
});
party('mai_student', 'mai', 'principal_applicant');
tagCase('mai_student', ['Student']);
fee('mai_student', 'Student visa — further study', 'professional', 85000, 'exclusive', 'invoiced');
split('mai_student', [{ key: 'principal', label: 'Principal (me)', bp: 5000 }, { key: 'admin', label: 'Admin team', bp: 5000 }]);
task('mai_student', 'Lodge student visa application', 7, 'high');

kase('ahmed_recon', {
  client: 'ahmed', title: 'Reconsideration — visitor visa declined', case_type: 'rq_reconsideration_temporary_visa_decline',
  status: 'appeal', priority: 'high', lodged: day(-12), due: day(9),
  next_action: 'File further financial evidence', next_due: day(8),
  summary: 'Visitor visa declined for insufficient funds. Reconsideration lodged within the '
    + '14-day window with fresh bank evidence.',
});
party('ahmed_recon', 'ahmed', 'principal_applicant');
tagCase('ahmed_recon', ['Appeal', 'Urgent deadline', 'Visitor']);
fee('ahmed_recon', 'Reconsideration request', 'professional', 140000, 'exclusive', 'invoiced');
split('ahmed_recon', [{ key: 'principal', label: 'Principal (me)', bp: 8000 }, { key: 'admin', label: 'Admin team', bp: 2000 }]);
task('ahmed_recon', 'File supplementary bank statements', 8, 'urgent');

kase('elena_ppi', {
  client: 'elena', title: 'PPI response — undisclosed conviction', case_type: 'reply_ppi_response',
  status: 'ppi', priority: 'urgent', due: day(11),
  next_action: 'Draft PPI response and obtain character references', next_due: day(10),
  summary: 'PPI letter regarding a conviction not disclosed on the original application. '
    + 'Response due within the period INZ has given.',
});
party('elena_ppi', 'elena', 'principal_applicant');
tagCase('elena_ppi', ['Character', 'Urgent deadline']);
fee('elena_ppi', 'PPI response — submissions', 'professional', 260000, 'exclusive', 'invoiced');
split('elena_ppi', [{ key: 'principal', label: 'Principal (me)', bp: 8500 }, { key: 'admin', label: 'Admin team', bp: 1500 }]);
task('elena_ppi', 'Obtain character references', 6, 'urgent');
task('elena_ppi', 'Draft PPI response', 10, 'urgent');

kase('daniel_investor', {
  client: 'daniel', title: 'Active Investor Plus — vineyard acquisition', case_type: 'rv_entrepreneur',
  status: 'on_hold',
  next_action: 'Awaiting the client’s due diligence on the target business', next_due: day(45),
  summary: 'Investor residence linked to a proposed acquisition. Paused at the client’s request '
    + 'until due diligence on the vineyard completes.',
});
party('daniel_investor', 'daniel', 'principal_applicant');
party('daniel_investor', 'vineyards', 'ot_other', 'Target business for the proposed investment');
tagCase('daniel_investor', ['Investor', 'Residence']);
fee('daniel_investor', 'Investor residence — initial advice', 'professional', 300000, 'exclusive', 'paid');
split('daniel_investor', [{ key: 'principal', label: 'Principal (me)', bp: 9000 }, { key: 'admin', label: 'Admin team', bp: 1000 }]);
quote('daniel_investor', 'daniel', 'Active Investor Plus — full application', 1200000, 0, 'sent', 30);

// A few file notes, so timelines are not empty.
note('client', clients.get('sione').id, 'Called client — he is chasing the Samoan police certificate through his brother in Apia. Confirmed the RFI deadline and what happens if it is missed.', 'call', -4);
note('client', clients.get('ana').id, 'Confirmed interim visa conditions: she may continue working for the same employer while the residence application is decided.', 'note', -20);
note('client', clients.get('grace').id, 'Initial enquiry by phone about a partnership work visa. Quote to follow once relationship length is confirmed.', 'call', -6);
note('case', cases.get('elena_ppi').id, 'PPI letter received. Deadline diarised. Advised client that a full and frank response is the only realistic course.', 'note', -8);

// Counters must continue from the seeded references, or the next real record
// would be handed one already in use.
emit(`UPDATE counters SET value = ${clientSeq} WHERE name = 'client';`);
emit(`UPDATE counters SET value = ${caseSeq} WHERE name = 'case';`);
emit(`UPDATE counters SET value = ${quoteSeq} WHERE name = 'quote';`);

console.log(out.join('\n'));
console.error(
  `Generated ${clientSeq} clients, ${caseSeq} cases, ${partySeq} party links, ${quoteSeq} quotes.\n` +
  'Every row is marked: ids begin `demo_`, clients carry a [TEST DATA] note, and every case is\n' +
  'tagged "Test data". Remove it all from Admin, or with scripts/seed-demo-remove.sql.',
);
