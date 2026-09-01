# The routes

**175 routes across 21 modules.** Generated from the module
registrations, so it cannot drift.

## How access control works here

Every route carries a permission, and the permission is checked by middleware
rather than inside the handler — so a route added later cannot forget. A module
usually registers one guard for everything it owns; a route needing more says so
itself.

| Permission | Routes |
|---|---:|
| `register:write` | 68 |
| `register:read` | 23 |
| `quote:write` | 20 |
| `admin:settings` | 14 |
| `PUBLIC` | 12 |
| `auth` | 9 |
| `ingest:triage` | 8 |
| `admin:users` | 4 |
| `ai:run` | 4 |
| `mail:send` | 4 |
| `document:write` | 3 |
| `register:delete` | 3 |
| `document:read` | 2 |
| `audit:read` | 1 |

### The 12 routes with no guard at all

These are the whole of the register's public surface. Anything not on this list
requires a signed-in person, and most require a named permission.

| | Path | What it is |
|---|---|---|
| GET | `/setup` | first-run: creates the first owner, and refuses once one exists |
| POST | `/setup` | first-run: creates the first owner, and refuses once one exists |
| GET | `/login` | the sign-in form and its submission |
| POST | `/login` | the sign-in form and its submission |
| GET | `/login/verify` | the second factor |
| POST | `/login/verify` | the second factor |
| POST | `/logout` | ends the session |
| GET | `/` | the public website |
| GET | `/robots.txt` | search-engine directives |
| GET | `/sitemap.xml` | for the public pages only |
| GET | `/llms.txt` | what this site is, for machine readers |
| POST | `/enquiry` | the public enquiry form — the one route where a stranger writes |

`POST /enquiry` deserves attention in any rebuild: it is the only route where an
unauthenticated stranger causes a row to be written. It is rate-limited, it
writes to `inquiries` and nowhere else, and nothing it writes is trusted — an
inquiry becomes a client only when a person converts it.

---

## Every route

### admin

| | Path | Requires |
|---|---|---|
| GET | `/admin/` | admin:settings |
| GET | `/admin/audit` | audit:read |
| POST | `/admin/demo-data/remove` | admin:settings |
| POST | `/admin/mail/flush` | admin:settings |
| POST | `/admin/mail/poll` | admin:settings |
| POST | `/admin/mail/test` | admin:settings |
| GET | `/admin/settings` | admin:settings |
| POST | `/admin/settings` | admin:settings |
| POST | `/admin/settings/default-shares` | admin:settings |
| GET | `/admin/users` | admin:users |
| POST | `/admin/users` | admin:users |
| POST | `/admin/users/:id` | admin:users |
| POST | `/admin/users/:id/reset-password` | admin:users |

### alerts

| | Path | Requires |
|---|---|---|
| GET | `/alerts/` | register:read |

### assistant

| | Path | Requires |
|---|---|---|
| GET | `/assistant/` | ai:run |
| POST | `/assistant/` | ai:run |

### auth

| | Path | Requires |
|---|---|---|
| GET | `/account` | auth |
| GET | `/account/2fa` | auth |
| POST | `/account/2fa/disable` | auth |
| POST | `/account/2fa/enable` | auth |
| POST | `/account/appearance` | auth |
| POST | `/account/password` | auth |
| POST | `/account/preferences` | auth |
| POST | `/account/sessions/revoke` | auth |
| GET | `/login` | PUBLIC |
| POST | `/login` | PUBLIC |
| GET | `/login/verify` | PUBLIC |
| POST | `/login/verify` | PUBLIC |
| POST | `/logout` | PUBLIC |
| GET | `/setup` | PUBLIC |
| POST | `/setup` | PUBLIC |

### cases

| | Path | Requires |
|---|---|---|
| GET | `/cases/` | register:read |
| POST | `/cases/` | register:write |
| GET | `/cases/:id` | register:read |
| POST | `/cases/:id` | register:write |
| POST | `/cases/:id/brief` | ai:run |
| GET | `/cases/:id/edit` | register:write |
| POST | `/cases/:id/entries` | register:write |
| POST | `/cases/:id/parties` | register:write |
| POST | `/cases/:id/parties/:partyId/remove` | register:write |
| POST | `/cases/:id/parties/new` | register:write |
| POST | `/cases/:id/status` | register:write |
| POST | `/cases/:id/tags` | register:write |
| POST | `/cases/:id/tags/:tagId/remove` | register:write |
| GET | `/cases/new` | register:write |

### clients

| | Path | Requires |
|---|---|---|
| GET | `/clients/` | register:read |
| POST | `/clients/` | register:write |
| GET | `/clients/:id` | register:read |
| POST | `/clients/:id` | register:write |
| POST | `/clients/:id/certificates` | register:write |
| POST | `/clients/:id/certificates/:certId/confirm-issue-date` | register:write |
| POST | `/clients/:id/certificates/:certId/remove` | register:write |
| POST | `/clients/:id/certificates/:certId/submitted` | register:write |
| GET | `/clients/:id/edit` | register:write |
| POST | `/clients/:id/entries` | register:write |
| POST | `/clients/:id/passports` | register:write |
| POST | `/clients/:id/passports/:pid/primary` | register:write |
| POST | `/clients/:id/passports/:pid/remove` | register:write |
| POST | `/clients/:id/primary-contact` | register:write |
| POST | `/clients/:id/status` | register:write |
| GET | `/clients/lookup` | register:write |
| POST | `/clients/lookup/create` | register:write |
| GET | `/clients/new` | register:write |

### dashboard

| | Path | Requires |
|---|---|---|
| GET | `/` | register:read |
| GET | `/search` | register:read |

### documents

| | Path | Requires |
|---|---|---|
| GET | `/documents/` | document:read |
| POST | `/documents/` | document:write |
| GET | `/documents/:id` | document:read |
| POST | `/documents/:id/delete` | register:delete |
| POST | `/documents/case-link` | document:write |
| POST | `/documents/external` | document:write |

### fees

| | Path | Requires |
|---|---|---|
| POST | `/cases/:caseId/fees` | register:write |
| POST | `/cases/:caseId/fees/:feeId` | register:write |
| POST | `/cases/:caseId/fees/:feeId/delete` | register:delete |
| GET | `/cases/:caseId/fees/:feeId/edit` | register:write |
| POST | `/cases/:caseId/fees/:feeId/status` | register:write |
| POST | `/cases/:caseId/fees/shares` | register:write |
| GET | `/fees` | register:read |

### flags

| | Path | Requires |
|---|---|---|
| POST | `/flags` | register:write |
| POST | `/flags/:id/clear` | register:write |
| POST | `/flags/:id/delete` | register:write |
| POST | `/flags/:id/edit` | register:write |
| POST | `/flags/:id/raise-again` | register:write |

### help

| | Path | Requires |
|---|---|---|
| GET | `/help/` | auth |

### inbox

| | Path | Requires |
|---|---|---|
| GET | `/inbox/` | ingest:triage |
| GET | `/inbox/:id` | ingest:triage |
| POST | `/inbox/:id/delete` | ingest:triage |
| POST | `/inbox/:id/file` | register:write |
| POST | `/inbox/:id/ignore` | ingest:triage |
| POST | `/inbox/:id/process` | ingest:triage |
| POST | `/inbox/:id/triage` | ai:run |
| POST | `/inbox/:id/unfile` | register:write |
| GET | `/inbox/api/pending` | ingest:triage |
| GET | `/inbox/threads` | ingest:triage |
| GET | `/inbox/threads/:id` | ingest:triage |
| POST | `/inbox/threads/:id/file` | register:write |
| GET | `/inbox/threads/:id/forward/:kind/:entryId` | mail:send |
| POST | `/inbox/threads/:id/forward/:kind/:entryId` | mail:send |
| POST | `/inbox/threads/:id/link` | register:write |
| POST | `/inbox/threads/:id/reply` | register:write |
| POST | `/inbox/threads/:id/unfile` | register:write |

### inquiries

| | Path | Requires |
|---|---|---|
| GET | `/inquiries/` | register:read |
| POST | `/inquiries/` | register:write |
| GET | `/inquiries/:id` | register:read |
| POST | `/inquiries/:id` | register:write |
| POST | `/inquiries/:id/convert` | register:write |
| POST | `/inquiries/:id/delete` | register:delete |
| GET | `/inquiries/:id/edit` | register:write |
| POST | `/inquiries/:id/entries` | register:write |
| POST | `/inquiries/:id/file` | register:write |
| POST | `/inquiries/:id/status` | register:write |
| POST | `/inquiries/:id/unfile` | register:write |
| GET | `/inquiries/new` | register:write |

### invoices

| | Path | Requires |
|---|---|---|
| GET | `/invoices/` | register:read |
| GET | `/invoices/:id` | register:read |
| POST | `/invoices/:id/issue` | quote:write |
| POST | `/invoices/:id/items` | quote:write |
| POST | `/invoices/:id/items/:itemId/remove` | quote:write |
| POST | `/invoices/:id/payments` | quote:write |
| GET | `/invoices/:id/print` | register:read |
| POST | `/invoices/:id/void` | quote:write |

### knowledge

| | Path | Requires |
|---|---|---|
| GET | `/knowledge/` | register:read |
| POST | `/knowledge/` | register:write |
| GET | `/knowledge/:id` | register:read |
| POST | `/knowledge/:id` | register:write |
| GET | `/knowledge/:id/edit` | register:write |
| GET | `/knowledge/:id/history` | register:read |
| POST | `/knowledge/:id/tags` | register:write |
| POST | `/knowledge/:id/tags/:tagId/remove` | register:write |
| GET | `/knowledge/new` | register:write |

### landing

| | Path | Requires |
|---|---|---|
| GET | `/` | PUBLIC |
| POST | `/enquiry` | PUBLIC |
| GET | `/llms.txt` | PUBLIC |
| GET | `/robots.txt` | PUBLIC |
| GET | `/sitemap.xml` | PUBLIC |

### notes

| | Path | Requires |
|---|---|---|
| POST | `/entries/:id/correct` | register:write |

### quotes

| | Path | Requires |
|---|---|---|
| GET | `/quotes/` | register:read |
| POST | `/quotes/` | quote:write |
| GET | `/quotes/:id` | register:read |
| POST | `/quotes/:id` | quote:write |
| GET | `/quotes/:id/edit` | quote:write |
| GET | `/quotes/:id/email` | mail:send |
| POST | `/quotes/:id/email` | mail:send |
| POST | `/quotes/:id/invoice` | quote:write |
| POST | `/quotes/:id/issue` | quote:write |
| POST | `/quotes/:id/items` | quote:write |
| POST | `/quotes/:id/items/:itemId/remove` | quote:write |
| GET | `/quotes/:id/print` | register:read |
| POST | `/quotes/:id/stages` | quote:write |
| POST | `/quotes/:id/stages/generate` | quote:write |
| POST | `/quotes/:id/status` | quote:write |
| POST | `/quotes/:id/to-fees` | register:write |
| GET | `/quotes/catalogue` | quote:write |
| POST | `/quotes/catalogue` | quote:write |
| POST | `/quotes/catalogue/:itemId` | quote:write |
| POST | `/quotes/catalogue/:itemId/toggle` | quote:write |
| GET | `/quotes/new` | quote:write |

### search

| | Path | Requires |
|---|---|---|
| GET | `/search/` | register:read |

### tasks

| | Path | Requires |
|---|---|---|
| GET | `/tasks/` | register:read |
| POST | `/tasks/` | register:write |
| GET | `/tasks/:id` | register:read |
| POST | `/tasks/:id` | register:write |
| GET | `/tasks/:id/edit` | register:write |
| GET | `/tasks/:id/note` | register:write |
| POST | `/tasks/:id/note` | register:write |
| POST | `/tasks/:id/status` | register:write |

### workflows

| | Path | Requires |
|---|---|---|
| GET | `/admin/automations/` | admin:settings |
| POST | `/admin/automations/` | admin:settings |
| POST | `/admin/automations/:id/delete` | admin:settings |
| POST | `/admin/automations/:id/toggle` | admin:settings |
| POST | `/admin/automations/run` | admin:settings |
| GET | `/workflows/` | register:read |
| POST | `/workflows/:id/approve` | register:write |
| POST | `/workflows/:id/dismiss` | register:write |
| GET | `/workflows/rules` | admin:settings |

