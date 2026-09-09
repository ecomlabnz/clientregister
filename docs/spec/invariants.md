# The invariants

**What the database refuses to do, and why.** The most valuable document here
and the hardest to recover from reading the code: the rules are spread across 63
migrations, and each exists because something went wrong or was foreseen going
wrong.

The register's standing decision: **invariants belong in the database, as
triggers and constraints, not in the route that happens to write the row.** A
guarantee in a handler lasts until somebody adds a second handler — and this
register is written to by the application, by bulk loads, and occasionally by
hand at a console. Everything below holds in all three cases.

**87 refusals** across 24 tables, plus
**10 uniqueness rules**. Each is quoted in the words the
database itself uses, because that is what somebody will see.

The count jumped by fourteen on 9 September 2026 and only nine of those are new
rules. The other five had been kept by the database and left out of this
document since it was written: a trigger may hold a list of refusals, and both
this document and the test holding it honest read only the first. So four of
the five reasons an inquiry cannot be deleted were never written down here.
A trigger is not one refusal; it is a list, and the list is the point.

Read from the schema as it finally stands, after every migration — not from the
migrations as written, which still contain rules that were later replaced.

---

## How to test one

Attack the database directly, never through the application:

```js
const d = migratedSqlite();
expect(() => d.exec(`DELETE FROM entries WHERE id = 'e1'`))
  .toThrow(/append-only/);
```

Then break the guard on purpose and confirm the test fails. A test that passes
whether or not the rule exists is not a test.

---

## The refusals, by table

### `audit_log`

| On | The database refuses |
|---|---|
| delete | audit_log is append-only: rows cannot be deleted |
| update | audit_log is append-only: rows cannot be modified |

### `cases`

| On | The database refuses |
|---|---|
| insert | a matter must be assigned to somebody |
| update | a matter must be assigned to somebody |
| delete | This matter has an invoice against it. An invoice has to say what it was for, so void or move the invoice first. |
| delete | A quotation on this matter has already gone to the client. Withdraw it, or take the matter off it, before deleting. |
| delete | This matter holds documents. Remove them one at a time first — deleting the matter would leave the files stored with nothing pointing at them. |

### `channel_threads`

| On | The database refuses |
|---|---|
| update | a conversation cannot be filed without a client or a matter to file it on |

### `client_certificates`

| On | The database refuses |
|---|---|
| insert | an issue date must say where it came from |
| insert | certificate country must be an ISO 3166-1 alpha-2 country code |
| update | an issue date must say where it came from |
| update | certificate country must be an ISO 3166-1 alpha-2 country code |

### `client_nationalities`

| On | The database refuses |
|---|---|
| insert | nationality must be an ISO 3166-1 alpha-2 country code |
| update | nationality must be an ISO 3166-1 alpha-2 country code |

### `client_passports`

| On | The database refuses |
|---|---|
| insert | passport country must be an ISO 3166-1 alpha-2 country code |
| update | passport country must be an ISO 3166-1 alpha-2 country code |

### `clients`

| On | The database refuses |
|---|---|
| insert | passport country must be an ISO 3166-1 alpha-2 country code |
| update | passport country must be an ISO 3166-1 alpha-2 country code |
| insert | An INZ client number is six to twelve digits and nothing else. |
| update | An INZ client number is six to twelve digits and nothing else. |
| delete | This client has matters. Delete or move those first — each one is its own decision. |
| delete | This client has an invoice. An invoice has to say who it was for, so void or move it first. |
| delete | A quotation has already gone to this client. Withdraw it, or move it, before deleting them. |
| delete | This client holds documents. Remove them one at a time first — deleting the client would leave the files stored with nothing pointing at them. |
| delete | This client has notes on their file. A note cannot be deleted, and there is nowhere to move it to — archive them instead, which keeps the file and stops the alerts. |
| delete | This client is named on another matter. Take them off it first. |

### `documents`

| On | The database refuses |
|---|---|
| insert | a document is stored in R2 or linked by https, one or the other |
| update | a document is stored in R2 or linked by https, one or the other |

### `entries`

| On | The database refuses |
|---|---|
| delete | entries are append-only: a note cannot be deleted |
| update | entries are append-only: a note may be corrected only within five minutes of writing it, and only once |
| update | a note can only be re-filed onto a client who exists |

### `flags`

| On | The database refuses |
|---|---|
| insert | a flag must say what it is warning about |
| update | a flag cannot be cleared before it was raised |
| update | a flag must say what it is warning about |

### `ingest_messages`

| On | The database refuses |
|---|---|
| insert | a filed message records where it was filed and when, or neither |
| insert | a forwarded message is about somebody, not a conversation with them |
| update | a filed message records where it was filed and when, or neither |
| update | a forwarded message is about somebody, not a conversation with them |

### `inquiries`

| On | The database refuses |
|---|---|
| delete | an inquiry that became a matter cannot be deleted |
| update | an inquiry cannot be filed without a client or a matter to file it on |
| delete | an inquiry that has been quoted cannot be deleted |
| delete | an inquiry with documents cannot be deleted |
| delete | an inquiry with tasks cannot be deleted |
| delete | an inquiry with a file note cannot be deleted |

### `invoice_items`

| On | The database refuses |
|---|---|
| delete | an issued invoice cannot lose a line |
| insert | an issued invoice cannot gain a line |
| update | an issued invoice cannot have its lines changed |

### `invoice_payments`

| On | The database refuses |
|---|---|
| delete | a payment cannot be deleted; add a correcting entry instead |
| update | a payment cannot be edited; add a correcting entry instead |

### `invoices`

| On | The database refuses |
|---|---|
| delete | an invoice cannot be deleted; void it instead |
| update | an issued invoice cannot be altered; void it and raise another |
| insert | an invoice has to say what it is for |
| update | an invoice has to say what it is for |
| update | the split on this invoice does not add up to 100%; fix it or remove it |

### `invoice_shares`

| On | The database refuses |
|---|---|
| insert | this invoice has been issued; its split cannot be changed |
| update | this invoice has been issued; its split cannot be changed |
| delete | this invoice has been issued; its split cannot be changed |

### `quotes`

| On | The database refuses |
|---|---|
| insert | a quote has to say what it is for |
| update | a quote has to say what it is for |
| insert | A quotation on a matter is for that matter's client. Move the matter, or take the matter off the quotation. |
| update | A quotation on a matter is for that matter's client. Move the matter, or take the matter off the quotation. |

### `quote_stages`

| On | The database refuses |
|---|---|
| insert | The payment stages would come to more than the quotation does. A schedule divides up the fees and disbursements; it cannot add to them. Lower a stage, or add the work to the items first. |
| update | The payment stages would come to more than the quotation does. A schedule divides up the fees and disbursements; it cannot add to them. Lower a stage, or add the work to the items first. |

The schedule of payments divides up the quotation; it cannot add to it. Stages
that came to more than the fees and disbursements would ask a client to pay
twice for part of the work, in a document that is a contract.

The reverse — lowering a fee line under a schedule already written — is
deliberately **not** refused. That guard would have to sit on `quotes` and would
block an ordinary correction to an item until the schedule was taken apart
first. It is reported under the schedule instead, which is the right instrument
for "these two no longer agree" as against "this would be wrong the moment you
wrote it".

### `engagement_clauses`

| On | The database refuses |
|---|---|
| insert | a clause needs a heading and something to say |
| update | a clause needs a heading and something to say |

### `intake_uploads`

| On | The database refuses |
|---|---|
| insert | a staged file needs a name and some content |
| insert | an attached file records both the document and when — or neither |
| update | an attached file records both the document and when — or neither |
| update | that file has already been put on a record |

### `quote_parties`

| On | The database refuses |
|---|---|
| insert | a party on a quotation has to have a name |
| update | a party on a quotation has to have a name |
| insert | an organisation has no date of birth |
| update | an organisation has no date of birth |
| insert | a date of birth has to be a real date in the past, written 1987-04-18 |
| update | a date of birth has to be a real date in the past, written 1987-04-18 |
| insert | an administrative contact needs an email address or a phone number |
| update | an administrative contact needs an email address or a phone number |
| insert | an administrative contact cannot be the nominated representative |
| update | an administrative contact cannot be the nominated representative |

### `kb_article_versions`

| On | The database refuses |
|---|---|
| delete | kb_article_versions is append-only |
| update | kb_article_versions is append-only |

### `kb_documents`

| On | The database refuses |
|---|---|
| insert | this file is not stored under the article it is filed against |
| update | this file is not stored under the article it is filed against |
| insert | a file has to have a name |
| update | a file has to have a name |

### `tasks`

| On | The database refuses |
|---|---|
| insert | a note must record when it was written |
| update | a note must record when it was written |

---

## Uniqueness

| Table | Unique on | Only where |
|---|---|---|
| `case_parties` | case_id, client_id | always |
| `case_parties` | case_id | role = 'principal_applicant' |
| `client_passports` | client_id | is_primary = 1 |
| `invoice_shares` | invoice_id, party_key | always |
| `kb_article_versions` | article_id, version | always |
| `service_items` | name COLLATE NOCASE | always |
| `clients` | inz_client_number | inz_client_number IS NOT NULL |
| `tags` | name | always |
| `users` | email | always |

The INZ client number is partial for a different reason from the other two:
empty is the normal state of a client INZ has never issued one to, and most of
the register is in it. What it catches is the same person entered twice — which
is exactly what it caught the day it was added.

The other partial ones are worth calling out, because both were learned the hard way:
a client may hold many passports but only **one primary**, and a matter may name
many people but only **one principal applicant**. A bulk load that ignored the
first stopped dead mid-run against the live register.

