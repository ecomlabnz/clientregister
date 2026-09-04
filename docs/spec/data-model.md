# The data model

**45 tables**, as the schema finally stands after all 59 migrations.
Generated from the built database rather than the migration files, so a rule
later replaced does not appear twice.

Read this with [`invariants.md`](invariants.md): the columns are here, but the
*rules* — what the database refuses — are there, and the rules are the part that
matters. A column list can be inferred by any competent reader; the reasons
cannot.

Two conventions hold throughout:

- **Every id is a prefixed string**, not an integer — `cli_`, `cas_`, `ent_`,
  `flg_`. A bulk load prefixes further (`cli_b03_0001`), which is what lets a
  half-finished load be undone by prefix and run again.
- **Every timestamp is an ISO 8601 string in UTC.** `occurred_at` is when the
  thing happened; `created_at` is when the register was told. They differ, and
  the difference is deliberate — a filed email carries the date it arrived, so it
  lands in the right place on a timeline.

---

## The people and the work

### `clients`

| Column | Type | | Default |
|---|---|---|---|
| `id` | TEXT | PK |  |
| `ref` | TEXT | NOT NULL |  |
| `kind` | TEXT | NOT NULL | 'individual' |
| `full_name` | TEXT | NOT NULL |  |
| `preferred_name` | TEXT |  |  |
| `email` | TEXT |  |  |
| `phone` | TEXT |  |  |
| `whatsapp` | TEXT |  |  |
| `telegram_username` | TEXT |  |  |
| `telegram_user_id` | TEXT |  |  |
| `date_of_birth` | TEXT |  |  |
| `passport_number` | TEXT |  |  |
| `current_visa_type` | TEXT |  |  |
| `current_visa_expiry` | TEXT |  |  |
| `address` | TEXT |  |  |
| `status` | TEXT | NOT NULL | 'prospect' |
| `assigned_to` | TEXT |  |  |
| `notes` | TEXT |  |  |
| `created_at` | TEXT | NOT NULL |  |
| `updated_at` | TEXT | NOT NULL |  |
| `created_by` | TEXT |  |  |
| `given_names` | TEXT |  |  |
| `family_name` | TEXT |  |  |
| `nzbn` | TEXT |  |  |
| `company_number` | TEXT |  |  |
| `passport_country` | TEXT |  |  |
| `passport_expiry` | TEXT |  |  |
| `police_certificate_date` | TEXT |  |  |
| `police_certificate_expiry` | TEXT |  |  |
| `police_certificate_country` | TEXT |  |  |
| `medical_certificate_date` | TEXT |  |  |
| `medical_certificate_expiry` | TEXT |  |  |
| `chest_xray_expiry` | TEXT |  |  |
| `organisation_id` | TEXT |  |  |
| `organisation_role` | TEXT |  |  |
| `primary_contact_id` | TEXT |  |  |
| `english_test_type` | TEXT |  |  |
| `english_test_score` | TEXT |  |  |
| `english_test_date` | TEXT |  |  |
| `medical_certificate_type` | TEXT |  |  |
| `current_visa_expiry_rule` | TEXT |  |  |

### `cases`

| Column | Type | | Default |
|---|---|---|---|
| `id` | TEXT | PK |  |
| `ref` | TEXT | NOT NULL |  |
| `client_id` | TEXT | NOT NULL |  |
| `title` | TEXT | NOT NULL |  |
| `case_type` | TEXT | NOT NULL |  |
| `status` | TEXT | NOT NULL |  |
| `priority` | TEXT | NOT NULL | 'normal' |
| `assigned_to` | TEXT |  |  |
| `inz_application_number` | TEXT |  |  |
| `inz_client_number` | TEXT |  |  |
| `lodged_at` | TEXT |  |  |
| `decision_due_at` | TEXT |  |  |
| `decided_at` | TEXT |  |  |
| `outcome` | TEXT |  |  |
| `fee_quoted_cents` | INTEGER |  |  |
| `fee_agreed_cents` | INTEGER |  |  |
| `currency` | TEXT | NOT NULL | 'NZD' |
| `next_action` | TEXT |  |  |
| `next_action_due` | TEXT |  |  |
| `summary` | TEXT |  |  |
| `created_at` | TEXT | NOT NULL |  |
| `updated_at` | TEXT | NOT NULL |  |
| `created_by` | TEXT |  |  |
| `closed_at` | TEXT |  |  |
| `chase_inz` | INTEGER | NOT NULL | 1 |
| `descriptor` | TEXT |  |  |

### `case_parties`

| Column | Type | | Default |
|---|---|---|---|
| `id` | TEXT | PK |  |
| `case_id` | TEXT | NOT NULL |  |
| `client_id` | TEXT | NOT NULL |  |
| `role` | TEXT | NOT NULL |  |
| `notes` | TEXT |  |  |
| `created_at` | TEXT | NOT NULL |  |
| `created_by` | TEXT |  |  |

### `case_status_history`

| Column | Type | | Default |
|---|---|---|---|
| `id` | TEXT | PK |  |
| `case_id` | TEXT | NOT NULL |  |
| `from_status` | TEXT |  |  |
| `to_status` | TEXT | NOT NULL |  |
| `at` | TEXT | NOT NULL |  |
| `by_user_id` | TEXT |  |  |
| `note` | TEXT |  |  |

### `case_tags`

| Column | Type | | Default |
|---|---|---|---|
| `case_id` | TEXT | PK NOT NULL |  |
| `tag_id` | TEXT | PK NOT NULL |  |
| `created_at` | TEXT | NOT NULL |  |
| `created_by` | TEXT |  |  |

### `tags`

| Column | Type | | Default |
|---|---|---|---|
| `id` | TEXT | PK |  |
| `name` | TEXT | NOT NULL |  |
| `colour` | TEXT | NOT NULL | 'neutral' |
| `created_at` | TEXT | NOT NULL |  |
| `created_by` | TEXT |  |  |

### `entries`

| Column | Type | | Default |
|---|---|---|---|
| `id` | TEXT | PK |  |
| `entity_type` | TEXT | NOT NULL |  |
| `entity_id` | TEXT | NOT NULL |  |
| `kind` | TEXT | NOT NULL |  |
| `body` | TEXT | NOT NULL |  |
| `occurred_at` | TEXT | NOT NULL |  |
| `pinned` | INTEGER | NOT NULL | 0 |
| `created_at` | TEXT | NOT NULL |  |
| `created_by` | TEXT |  |  |
| `document_id` | TEXT |  |  |
| `edited_at` | TEXT |  |  |

### `tasks`

| Column | Type | | Default |
|---|---|---|---|
| `id` | TEXT | PK |  |
| `title` | TEXT | NOT NULL |  |
| `details` | TEXT |  |  |
| `status` | TEXT | NOT NULL | 'open' |
| `priority` | TEXT | NOT NULL | 'normal' |
| `due_at` | TEXT |  |  |
| `assigned_to` | TEXT | NOT NULL |  |
| `entity_type` | TEXT |  |  |
| `entity_id` | TEXT |  |  |
| `created_at` | TEXT | NOT NULL |  |
| `updated_at` | TEXT | NOT NULL |  |
| `created_by` | TEXT |  |  |
| `completed_at` | TEXT |  |  |
| `completion_note` | TEXT |  |  |
| `completion_note_at` | TEXT |  |  |
| `completion_note_by` | TEXT |  |  |

## What a client holds

### `client_passports`

| Column | Type | | Default |
|---|---|---|---|
| `id` | TEXT | PK |  |
| `client_id` | TEXT | NOT NULL |  |
| `country` | TEXT |  |  |
| `number` | TEXT |  |  |
| `issued_on` | TEXT |  |  |
| `expires_on` | TEXT |  |  |
| `status` | TEXT | NOT NULL | 'held' |
| `is_primary` | INTEGER | NOT NULL | 0 |
| `notes` | TEXT |  |  |
| `created_at` | TEXT | NOT NULL |  |
| `created_by` | TEXT |  |  |

### `client_certificates`

| Column | Type | | Default |
|---|---|---|---|
| `id` | TEXT | PK |  |
| `client_id` | TEXT | NOT NULL |  |
| `kind` | TEXT | NOT NULL |  |
| `subtype` | TEXT |  |  |
| `country` | TEXT |  |  |
| `reference` | TEXT |  |  |
| `issued_on` | TEXT |  |  |
| `expires_on` | TEXT |  |  |
| `notes` | TEXT |  |  |
| `created_at` | TEXT | NOT NULL |  |
| `created_by` | TEXT |  |  |
| `submitted_on` | TEXT |  |  |
| `issued_on_provenance` | TEXT |  |  |

### `client_nationalities`

| Column | Type | | Default |
|---|---|---|---|
| `client_id` | TEXT | PK NOT NULL |  |
| `code` | TEXT | PK NOT NULL |  |
| `position` | INTEGER | NOT NULL | 0 |

### `countries`

| Column | Type | | Default |
|---|---|---|---|
| `code` | TEXT | PK |  |
| `name` | TEXT | NOT NULL |  |

## Warnings

### `flags`

| Column | Type | | Default |
|---|---|---|---|
| `id` | TEXT | PK |  |
| `entity_type` | TEXT | NOT NULL |  |
| `entity_id` | TEXT | NOT NULL |  |
| `kind` | TEXT | NOT NULL |  |
| `body` | TEXT | NOT NULL |  |
| `raised_at` | TEXT | NOT NULL |  |
| `raised_by` | TEXT |  |  |
| `expires_on` | TEXT |  |  |
| `cleared_at` | TEXT |  |  |
| `cleared_by` | TEXT |  |  |
| `cleared_note` | TEXT |  |  |
| `updated_at` | TEXT | NOT NULL |  |
| `source_case_id` | TEXT |  |  |

## Money

### `quotes`

| Column | Type | | Default |
|---|---|---|---|
| `id` | TEXT | PK |  |
| `ref` | TEXT | NOT NULL |  |
| `client_id` | TEXT |  |  |
| `case_id` | TEXT |  |  |
| `inquiry_id` | TEXT |  |  |
| `description` | TEXT | NOT NULL |  |
| `amount_cents` | INTEGER | NOT NULL |  |
| `gst_cents` | INTEGER | NOT NULL | 0 |
| `disbursements_cents` | INTEGER | NOT NULL | 0 |
| `currency` | TEXT | NOT NULL | 'NZD' |
| `status` | TEXT | NOT NULL | 'draft' |
| `valid_until` | TEXT |  |  |
| `sent_at` | TEXT |  |  |
| `responded_at` | TEXT |  |  |
| `notes` | TEXT |  |  |
| `created_at` | TEXT | NOT NULL |  |
| `updated_at` | TEXT | NOT NULL |  |
| `created_by` | TEXT |  |  |
| `issued_on` | TEXT |  |  |
| `validity_days` | INTEGER |  |  |
| `stage_note` | TEXT |  |  |

### `quote_items`

| Column | Type | | Default |
|---|---|---|---|
| `id` | TEXT | PK |  |
| `quote_id` | TEXT | NOT NULL |  |
| `position` | INTEGER | NOT NULL | 0 |
| `service_item_id` | TEXT |  |  |
| `description` | TEXT | NOT NULL |  |
| `kind` | TEXT | NOT NULL | 'professional' |
| `unit_label` | TEXT | NOT NULL | 'item' |
| `quantity_milli` | INTEGER | NOT NULL | 1000 |
| `unit_amount_cents` | INTEGER | NOT NULL |  |
| `gst_treatment` | TEXT | NOT NULL | 'exclusive' |
| `gst_rate_bp` | INTEGER | NOT NULL | 1500 |
| `net_cents` | INTEGER | NOT NULL |  |
| `gst_cents` | INTEGER | NOT NULL |  |
| `gross_cents` | INTEGER | NOT NULL |  |
| `created_at` | TEXT | NOT NULL |  |
| `updated_at` | TEXT | NOT NULL |  |

### `invoices`

| Column | Type | | Default |
|---|---|---|---|
| `id` | TEXT | PK |  |
| `ref` | TEXT | NOT NULL |  |
| `quote_id` | TEXT |  |  |
| `client_id` | TEXT |  |  |
| `case_id` | TEXT |  |  |
| `description` | TEXT | NOT NULL |  |
| `issued_on` | TEXT |  |  |
| `due_on` | TEXT |  |  |
| `payment_terms_days` | INTEGER | NOT NULL | 7 |
| `status` | TEXT | NOT NULL | 'draft' |
| `currency` | TEXT | NOT NULL | 'NZD' |
| `net_cents` | INTEGER | NOT NULL | 0 |
| `gst_cents` | INTEGER | NOT NULL | 0 |
| `gross_cents` | INTEGER | NOT NULL | 0 |
| `paid_cents` | INTEGER | NOT NULL | 0 |
| `notes` | TEXT |  |  |
| `xero_invoice_id` | TEXT |  |  |
| `xero_pushed_at` | TEXT |  |  |
| `xero_error` | TEXT |  |  |
| `created_at` | TEXT | NOT NULL |  |
| `updated_at` | TEXT | NOT NULL |  |
| `created_by` | TEXT |  |  |
| `issued_by` | TEXT |  |  |
| `voided_at` | TEXT |  |  |
| `void_reason` | TEXT |  |  |

### `invoice_items`

| Column | Type | | Default |
|---|---|---|---|
| `id` | TEXT | PK |  |
| `invoice_id` | TEXT | NOT NULL |  |
| `position` | INTEGER | NOT NULL | 0 |
| `service_item_id` | TEXT |  |  |
| `description` | TEXT | NOT NULL |  |
| `kind` | TEXT | NOT NULL | 'professional' |
| `unit_label` | TEXT | NOT NULL | 'item' |
| `quantity_milli` | INTEGER | NOT NULL | 1000 |
| `unit_amount_cents` | INTEGER | NOT NULL |  |
| `gst_treatment` | TEXT | NOT NULL | 'exclusive' |
| `gst_rate_bp` | INTEGER | NOT NULL | 1500 |
| `net_cents` | INTEGER | NOT NULL |  |
| `gst_cents` | INTEGER | NOT NULL |  |
| `gross_cents` | INTEGER | NOT NULL |  |
| `created_at` | TEXT | NOT NULL |  |

### `invoice_shares`

How one invoice's professional fees are divided between the parties who owe
them. Frozen with the invoice: once it is issued the split cannot be changed,
and it must come to 100% before it will issue at all.

| Column | Type | | Default |
|---|---|---|---|
| `id` | TEXT | PK |  |
| `invoice_id` | TEXT | NOT NULL |  |
| `party_key` | TEXT | NOT NULL |  |
| `label` | TEXT | NOT NULL |  |
| `percent_bp` | INTEGER | NOT NULL |  |
| `user_id` | TEXT |  |  |
| `position` | INTEGER | NOT NULL | 0 |
| `created_at` | TEXT | NOT NULL |  |
| `updated_at` | TEXT | NOT NULL |  |

## Things that arrive

### `inquiries`

| Column | Type | | Default |
|---|---|---|---|
| `id` | TEXT | PK |  |
| `ref` | TEXT | NOT NULL |  |
| `source` | TEXT | NOT NULL |  |
| `source_ref` | TEXT |  |  |
| `received_at` | TEXT | NOT NULL |  |
| `contact_name` | TEXT |  |  |
| `contact_email` | TEXT |  |  |
| `contact_phone` | TEXT |  |  |
| `subject` | TEXT |  |  |
| `body` | TEXT |  |  |
| `status` | TEXT | NOT NULL | 'new' |
| `client_id` | TEXT |  |  |
| `case_id` | TEXT |  |  |
| `assigned_to` | TEXT |  |  |
| `ingest_message_id` | TEXT |  |  |
| `created_at` | TEXT | NOT NULL |  |
| `updated_at` | TEXT | NOT NULL |  |
| `created_by` | TEXT |  |  |
| `filed_at` | TEXT |  |  |
| `filed_by` | TEXT |  |  |
| `filed_entry_id` | TEXT |  |  |

### `ingest_messages`

| Column | Type | | Default |
|---|---|---|---|
| `id` | TEXT | PK |  |
| `channel` | TEXT | NOT NULL |  |
| `external_id` | TEXT |  |  |
| `dedupe_key` | TEXT | NOT NULL |  |
| `received_at` | TEXT | NOT NULL |  |
| `sender` | TEXT |  |  |
| `sender_display` | TEXT |  |  |
| `subject` | TEXT |  |  |
| `body_text` | TEXT |  |  |
| `attachments_json` | TEXT |  |  |
| `trusted` | INTEGER | NOT NULL | 0 |
| `status` | TEXT | NOT NULL | 'pending' |
| `processed_at` | TEXT |  |  |
| `inquiry_id` | TEXT |  |  |
| `error` | TEXT |  |  |
| `meta_json` | TEXT |  |  |
| `created_at` | TEXT | NOT NULL |  |
| `thread_id` | TEXT |  |  |
| `to_addrs` | TEXT |  |  |
| `cc_addrs` | TEXT |  |  |
| `body_html` | TEXT |  |  |
| `filed_to_type` | TEXT |  |  |
| `filed_to_id` | TEXT |  |  |
| `filed_at` | TEXT |  |  |
| `filed_by` | TEXT |  |  |
| `filed_entry_id` | TEXT |  |  |

### `channel_threads`

| Column | Type | | Default |
|---|---|---|---|
| `id` | TEXT | PK |  |
| `channel` | TEXT | NOT NULL |  |
| `peer_id` | TEXT | NOT NULL |  |
| `peer_label` | TEXT |  |  |
| `client_id` | TEXT |  |  |
| `case_id` | TEXT |  |  |
| `status` | TEXT | NOT NULL | 'open' |
| `last_message_at` | TEXT |  |  |
| `created_at` | TEXT | NOT NULL |  |
| `filed_at` | TEXT |  |  |
| `filed_by` | TEXT |  |  |
| `filed_entry_id` | TEXT |  |  |

### `channel_replies`

| Column | Type | | Default |
|---|---|---|---|
| `id` | TEXT | PK |  |
| `thread_id` | TEXT | NOT NULL |  |
| `channel` | TEXT | NOT NULL |  |
| `body` | TEXT | NOT NULL |  |
| `status` | TEXT | NOT NULL | 'queued' |
| `provider_id` | TEXT |  |  |
| `error` | TEXT |  |  |
| `created_at` | TEXT | NOT NULL |  |
| `created_by` | TEXT | NOT NULL |  |
| `sent_at` | TEXT |  |  |
| `to_addr` | TEXT |  |  |
| `cc_addr` | TEXT |  |  |
| `bcc_addr` | TEXT |  |  |
| `sent_html` | INTEGER | NOT NULL | 0 |

### `documents`

| Column | Type | | Default |
|---|---|---|---|
| `id` | TEXT | PK |  |
| `entity_type` | TEXT | NOT NULL |  |
| `entity_id` | TEXT | NOT NULL |  |
| `r2_key` | TEXT | NOT NULL |  |
| `filename` | TEXT | NOT NULL |  |
| `content_type` | TEXT | NOT NULL |  |
| `size_bytes` | INTEGER | NOT NULL |  |
| `sha256` | TEXT |  |  |
| `description` | TEXT |  |  |
| `uploaded_at` | TEXT | NOT NULL |  |
| `uploaded_by` | TEXT |  |  |
| `external_url` | TEXT |  |  |
| `category` | TEXT | NOT NULL | 'other' |

## Knowledge

### `kb_articles`

| Column | Type | | Default |
|---|---|---|---|
| `id` | TEXT | PK |  |
| `ref` | TEXT | NOT NULL |  |
| `kind` | TEXT | NOT NULL |  |
| `title` | TEXT | NOT NULL |  |
| `summary` | TEXT |  |  |
| `body` | TEXT | NOT NULL | '' |
| `status` | TEXT | NOT NULL | 'draft' |
| `published_at` | TEXT |  |  |
| `effective_at` | TEXT |  |  |
| `expires_at` | TEXT |  |  |
| `review_at` | TEXT |  |  |
| `source` | TEXT | NOT NULL | 'manual' |
| `source_ref` | TEXT |  |  |
| `ingest_message_id` | TEXT |  |  |
| `supersedes_id` | TEXT |  |  |
| `version` | INTEGER | NOT NULL | 1 |
| `created_at` | TEXT | NOT NULL |  |
| `updated_at` | TEXT | NOT NULL |  |
| `created_by` | TEXT |  |  |
| `updated_by` | TEXT |  |  |

### `kb_article_versions`

| Column | Type | | Default |
|---|---|---|---|
| `id` | TEXT | PK |  |
| `article_id` | TEXT | NOT NULL |  |
| `version` | INTEGER | NOT NULL |  |
| `kind` | TEXT | NOT NULL |  |
| `title` | TEXT | NOT NULL |  |
| `summary` | TEXT |  |  |
| `body` | TEXT | NOT NULL | '' |
| `status` | TEXT | NOT NULL |  |
| `published_at` | TEXT |  |  |
| `effective_at` | TEXT |  |  |
| `expires_at` | TEXT |  |  |
| `review_at` | TEXT |  |  |
| `source_ref` | TEXT |  |  |
| `change_note` | TEXT |  |  |
| `edited_at` | TEXT | NOT NULL |  |
| `edited_by` | TEXT |  |  |

### `kb_article_tags`

| Column | Type | | Default |
|---|---|---|---|
| `article_id` | TEXT | PK NOT NULL |  |
| `tag_id` | TEXT | PK NOT NULL |  |
| `created_at` | TEXT | NOT NULL |  |
| `created_by` | TEXT |  |  |

## The register itself

### `users`

| Column | Type | | Default |
|---|---|---|---|
| `id` | TEXT | PK |  |
| `email` | TEXT | NOT NULL |  |
| `name` | TEXT | NOT NULL |  |
| `password_hash` | TEXT | NOT NULL |  |
| `role` | TEXT | NOT NULL |  |
| `status` | TEXT | NOT NULL | 'active' |
| `totp_secret` | TEXT |  |  |
| `totp_enabled` | INTEGER | NOT NULL | 0 |
| `recovery_code_hashes` | TEXT |  |  |
| `failed_logins` | INTEGER | NOT NULL | 0 |
| `locked_until` | TEXT |  |  |
| `last_login_at` | TEXT |  |  |
| `password_changed_at` | TEXT |  |  |
| `created_at` | TEXT | NOT NULL |  |
| `updated_at` | TEXT | NOT NULL |  |
| `theme` | TEXT | NOT NULL | 'slate' |
| `colour_mode` | TEXT | NOT NULL | 'system' |

### `counters`

| Column | Type | | Default |
|---|---|---|---|
| `name` | TEXT | PK |  |
| `value` | INTEGER | NOT NULL | 0 |

### `settings`

| Column | Type | | Default |
|---|---|---|---|
| `key` | TEXT | PK |  |
| `value` | TEXT | NOT NULL |  |
| `updated_at` | TEXT | NOT NULL |  |
| `updated_by` | TEXT |  |  |

### `audit_log`

| Column | Type | | Default |
|---|---|---|---|
| `id` | TEXT | PK |  |
| `at` | TEXT | NOT NULL |  |
| `actor_id` | TEXT |  |  |
| `actor_label` | TEXT | NOT NULL |  |
| `action` | TEXT | NOT NULL |  |
| `entity_type` | TEXT |  |  |
| `entity_id` | TEXT |  |  |
| `ip` | TEXT |  |  |
| `user_agent` | TEXT |  |  |
| `meta_json` | TEXT |  |  |

### `ai_runs`

| Column | Type | | Default |
|---|---|---|---|
| `id` | TEXT | PK |  |
| `kind` | TEXT | NOT NULL |  |
| `provider` | TEXT | NOT NULL |  |
| `model` | TEXT | NOT NULL |  |
| `entity_type` | TEXT |  |  |
| `entity_id` | TEXT |  |  |
| `input_hash` | TEXT | NOT NULL |  |
| `status` | TEXT | NOT NULL |  |
| `output_json` | TEXT |  |  |
| `error` | TEXT |  |  |
| `latency_ms` | INTEGER |  |  |
| `created_at` | TEXT | NOT NULL |  |
| `created_by` | TEXT |  |  |
| `kept_at` | TEXT |  |  |
| `discarded_at` | TEXT |  |  |

## Everything else

### `automation_actions`

| Column | Type | | Default |
|---|---|---|---|
| `id` | TEXT | PK |  |
| `automation_id` | TEXT |  |  |
| `automation_name` | TEXT | NOT NULL |  |
| `trigger_key` | TEXT | NOT NULL |  |
| `action_kind` | TEXT | NOT NULL |  |
| `subject_type` | TEXT |  |  |
| `subject_id` | TEXT |  |  |
| `subject_label` | TEXT | NOT NULL |  |
| `subject_href` | TEXT |  |  |
| `event_date` | TEXT |  |  |
| `dedupe_key` | TEXT | NOT NULL |  |
| `payload_json` | TEXT | NOT NULL |  |
| `status` | TEXT | NOT NULL | 'pending' |
| `created_at` | TEXT | NOT NULL |  |
| `decided_at` | TEXT |  |  |
| `decided_by` | TEXT |  |  |
| `result` | TEXT |  |  |

### `automation_runs`

| Column | Type | | Default |
|---|---|---|---|
| `id` | TEXT | PK |  |
| `ran_at` | TEXT | NOT NULL |  |
| `trigger` | TEXT | NOT NULL |  |
| `ran_by` | TEXT |  |  |
| `rules` | INTEGER | NOT NULL | 0 |
| `events` | INTEGER | NOT NULL | 0 |
| `proposed` | INTEGER | NOT NULL | 0 |
| `performed` | INTEGER | NOT NULL | 0 |
| `duplicates` | INTEGER | NOT NULL | 0 |
| `skipped` | INTEGER | NOT NULL | 0 |
| `error` | TEXT |  |  |

### `automations`

| Column | Type | | Default |
|---|---|---|---|
| `id` | TEXT | PK |  |
| `name` | TEXT | NOT NULL |  |
| `trigger_key` | TEXT | NOT NULL |  |
| `within_days` | INTEGER | NOT NULL | 7 |
| `action_kind` | TEXT | NOT NULL |  |
| `action_json` | TEXT | NOT NULL | '{}' |
| `requires_approval` | INTEGER | NOT NULL | 1 |
| `enabled` | INTEGER | NOT NULL | 1 |
| `created_at` | TEXT | NOT NULL |  |
| `created_by` | TEXT |  |  |
| `updated_at` | TEXT |  |  |

### `case_documents`

| Column | Type | | Default |
|---|---|---|---|
| `case_id` | TEXT | PK NOT NULL |  |
| `document_id` | TEXT | PK NOT NULL |  |
| `created_at` | TEXT | NOT NULL |  |
| `created_by` | TEXT |  |  |

### `case_followups`

| Column | Type | | Default |
|---|---|---|---|
| `case_id` | TEXT | PK NOT NULL |  |
| `sequence` | INTEGER | PK NOT NULL |  |
| `task_id` | TEXT | NOT NULL |  |
| `due_on` | TEXT | NOT NULL |  |
| `created_at` | TEXT | NOT NULL |  |

### `invoice_payments`

| Column | Type | | Default |
|---|---|---|---|
| `id` | TEXT | PK |  |
| `invoice_id` | TEXT | NOT NULL |  |
| `paid_on` | TEXT | NOT NULL |  |
| `amount_cents` | INTEGER | NOT NULL |  |
| `method` | TEXT | NOT NULL | 'bank' |
| `reference` | TEXT |  |  |
| `note` | TEXT |  |  |
| `created_at` | TEXT | NOT NULL |  |
| `created_by` | TEXT | NOT NULL |  |

### `kb_documents`

Files filed against an article — the circular, the instructions, whatever the
article is about. Its own table rather than a row in `documents`, and migration
0063 says why at length: `documents` restricts what a file may hang off, and
that restriction cannot be widened on D1 without putting existing file-note
attachments at risk.

| Column | Type | | Default |
|---|---|---|---|
| `id` | TEXT | PK |  |
| `article_id` | TEXT | NOT NULL |  |
| `r2_key` | TEXT | NOT NULL |  |
| `filename` | TEXT | NOT NULL |  |
| `content_type` | TEXT | NOT NULL |  |
| `size_bytes` | INTEGER | NOT NULL |  |
| `sha256` | TEXT |  |  |
| `uploaded_at` | TEXT | NOT NULL |  |
| `uploaded_by` | TEXT |  |  |

### `kb_followups`

| Column | Type | | Default |
|---|---|---|---|
| `article_id` | TEXT | PK NOT NULL |  |
| `kind` | TEXT | PK NOT NULL |  |
| `task_id` | TEXT | NOT NULL |  |
| `due_at` | TEXT | NOT NULL |  |
| `created_at` | TEXT | NOT NULL |  |

### `outbound_emails`

| Column | Type | | Default |
|---|---|---|---|
| `id` | TEXT | PK |  |
| `to_addr` | TEXT | NOT NULL |  |
| `cc_addr` | TEXT |  |  |
| `subject` | TEXT | NOT NULL |  |
| `body_text` | TEXT | NOT NULL |  |
| `body_html` | TEXT |  |  |
| `status` | TEXT | NOT NULL | 'queued' |
| `provider` | TEXT |  |  |
| `provider_id` | TEXT |  |  |
| `entity_type` | TEXT |  |  |
| `entity_id` | TEXT |  |  |
| `error` | TEXT |  |  |
| `created_at` | TEXT | NOT NULL |  |
| `sent_at` | TEXT |  |  |
| `created_by` | TEXT |  |  |
| `reply_to` | TEXT |  |  |
| `bcc_addr` | TEXT |  |  |
| `attachment_ids` | TEXT |  |  |

### `quote_stages`

| Column | Type | | Default |
|---|---|---|---|
| `id` | TEXT | PK |  |
| `quote_id` | TEXT | NOT NULL |  |
| `position` | INTEGER | NOT NULL | 0 |
| `label` | TEXT | NOT NULL | '' |
| `description` | TEXT | NOT NULL |  |
| `amount_cents` | INTEGER | NOT NULL | 0 |
| `gst_treatment` | TEXT | NOT NULL | 'exclusive' |
| `gst_rate_bp` | INTEGER | NOT NULL | 1500 |
| `net_cents` | INTEGER | NOT NULL | 0 |
| `gst_cents` | INTEGER | NOT NULL | 0 |
| `gross_cents` | INTEGER | NOT NULL | 0 |
| `created_at` | TEXT | NOT NULL |  |
| `updated_at` | TEXT | NOT NULL |  |

### `reply_attachments`

| Column | Type | | Default |
|---|---|---|---|
| `id` | TEXT | PK |  |
| `reply_id` | TEXT | NOT NULL |  |
| `document_id` | TEXT | NOT NULL |  |
| `created_at` | TEXT | NOT NULL |  |

### `service_items`

| Column | Type | | Default |
|---|---|---|---|
| `id` | TEXT | PK |  |
| `name` | TEXT | NOT NULL |  |
| `description` | TEXT |  |  |
| `kind` | TEXT | NOT NULL | 'professional' |
| `unit_label` | TEXT | NOT NULL | 'item' |
| `unit_amount_cents` | INTEGER | NOT NULL | 0 |
| `gst_treatment` | TEXT | NOT NULL | 'exclusive' |
| `active` | INTEGER | NOT NULL | 1 |
| `sort_order` | INTEGER | NOT NULL | 100 |
| `created_at` | TEXT | NOT NULL |  |
| `updated_at` | TEXT | NOT NULL |  |
| `created_by` | TEXT |  |  |

### `session_records`

| Column | Type | | Default |
|---|---|---|---|
| `id` | TEXT | PK |  |
| `user_id` | TEXT | NOT NULL |  |
| `created_at` | TEXT | NOT NULL |  |
| `last_seen_at` | TEXT | NOT NULL |  |
| `expires_at` | TEXT | NOT NULL |  |
| `revoked_at` | TEXT |  |  |
| `ip` | TEXT |  |  |
| `user_agent` | TEXT |  |  |

### `user_preferences`

| Column | Type | | Default |
|---|---|---|---|
| `user_id` | TEXT | PK NOT NULL |  |
| `key` | TEXT | PK NOT NULL |  |
| `value` | TEXT | NOT NULL |  |
| `updated_at` | TEXT | NOT NULL |  |

