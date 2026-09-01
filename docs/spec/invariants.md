# The invariants

**What the database refuses to do, and why.** The most valuable document here
and the hardest to recover from reading the code: the rules are spread across 59
migrations, and each exists because something went wrong or was foreseen going
wrong.

The register's standing decision: **invariants belong in the database, as
triggers and constraints, not in the route that happens to write the row.** A
guarantee in a handler lasts until somebody adds a second handler — and this
register is written to by the application, by bulk loads, and occasionally by
hand at a console. Everything below holds in all three cases.

**39 refusals** across 17 tables, plus
**8 uniqueness rules**. Each is quoted in the words the
database itself uses, because that is what somebody will see.

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

### `kb_article_versions`

| On | The database refuses |
|---|---|
| delete | kb_article_versions is append-only |
| update | kb_article_versions is append-only |

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
| `fee_shares` | case_id, party_key | always |
| `kb_article_versions` | article_id, version | always |
| `service_items` | name COLLATE NOCASE | always |
| `tags` | name | always |
| `users` | email | always |

The partial ones are worth calling out, because both were learned the hard way:
a client may hold many passports but only **one primary**, and a matter may name
many people but only **one principal applicant**. A bulk load that ignored the
first stopped dead mid-run against the live register.

