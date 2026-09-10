/**
 * Who the register already knows how to write to.
 *
 * **Why there is no address book here.** A separate table of remembered
 * addresses was started and then abandoned, because the practice asked the
 * question that ended it: *"is this not a case that 99% of emails from the
 * system are to be sent to those who are already in the register? if so - why
 * create separate email register? should we not be able to find the email that
 * is already in the system and the name of the person holding it?"*
 *
 * They were right, and the register's own sent mail proved it: every genuine
 * recipient the practice has ever written to already exists as a client record,
 * including the agency it reaches an intermediary through — an *organisation*
 * client, not an applicant. The only addresses that matched nothing were the
 * practice's own test addresses.
 *
 * A second store would have been one fact with two owners: rename somebody in
 * the address book and their client record still says the old thing. So this
 * file stores nothing and remembers nothing. It reads what the register already
 * holds, every time the compose screen is drawn.
 *
 * The consequence, and it is deliberate: when a message goes to an address that
 * is on no client record, the answer is to put it on the record of the person
 * who holds it — see `unrecognisedRecipients` below — not to remember it
 * somewhere else.
 */

import { all, allByIds } from '../core/db';

export interface Recipient {
  /** The name to show beside the address: a client's, or a quotation party's. */
  name: string;
  /** The address itself, exactly as the record holds it, trimmed. */
  address: string;
}

/**
 * How many people the picker will offer.
 *
 * Five hundred, the same cap the client and matter pickers on the inbox reply
 * form already use, and for the same reason: this is a page-weight limit, not a
 * query limit. One `<option>` is about fifty bytes, so five hundred of them add
 * roughly 25KB to a screen that has to open on a phone — and the register is
 * built for the slow page to be the fast one.
 *
 * It costs nothing in correctness here, because the `LIMIT` is applied *after*
 * the ordering below. The people connected to this quotation and this matter
 * are the first rows out of the query, so they can never be the ones the cap
 * cuts off; what gets cut is the far end of the alphabet of everybody else, and
 * a person can still type that address by hand.
 */
export const RECIPIENT_CAP = 500;

interface Row {
  tier: number;
  pos: number;
  /** 1 for a client record, 0 for a quotation party's snapshot of one. */
  living: number;
  name: string;
  address: string;
}

/**
 * Everybody the register can offer for one quotation's email, best first.
 *
 * **One query, not one per person.** The same rule `modules/tasks` writes down
 * for its entity column: a `SELECT` per row costs a subrequest per row, and
 * Cloudflare allows a thousand per request, so the loop version works until it
 * very suddenly does not. Five sources are read as five branches of one
 * compound statement, so drawing this list costs exactly one query however many
 * people are in the register.
 *
 * **The order is the whole feature.** The address somebody wants is nearly
 * always one of the first three, so:
 *
 *  - tier 0 — this quotation's own client;
 *  - tier 1 — the people named on this quotation, in the order the quotation
 *    names them;
 *  - tier 2 — the parties on the matter this quotation belongs to;
 *  - tier 3 — everybody else in the register, alphabetically.
 *
 * Individuals and organisations both, at every tier. The organisation case is
 * the important one: an agency is how the practice reaches an intermediary, and
 * a picker that offered only individuals would miss the address it sends to
 * most often.
 *
 * **De-duplicated on the lower-cased address**, keeping the earliest tier — so
 * an address that is both "this quotation's client" and "somebody in the
 * register" appears once, at the top. Where the same address is held by a
 * client record and by a quotation party, the client record's name wins: a
 * quotation party is a snapshot taken when the quote was drawn, and the client
 * record is the living one. Within a tier the query does that by sorting
 * `living` first; across tiers the loop below does it, by keeping the earlier
 * row's position and taking the client record's name.
 */
export async function quoteRecipients(
  env: { DB: D1Database },
  quote: { id: string; client_id: string | null; case_id: string | null },
): Promise<Recipient[]> {
  const rows = await all<Row>(
    env.DB,
    `SELECT tier, pos, living, name, address FROM (
       -- 0: the client this quotation is for.
       SELECT 0 AS tier, 0 AS pos, 1 AS living,
              cl.full_name AS name, TRIM(cl.email) AS address
         FROM clients cl
        WHERE cl.id = ? AND TRIM(COALESCE(cl.email, '')) <> ''
       UNION ALL
       -- 1: the people this quotation names, as the register holds them now.
       SELECT 1, qp.position, 1, cl.full_name, TRIM(cl.email)
         FROM quote_parties qp JOIN clients cl ON cl.id = qp.client_id
        WHERE qp.quote_id = ? AND TRIM(COALESCE(cl.email, '')) <> ''
       UNION ALL
       -- 1: and as the quotation itself recorded them, for the ones who are
       -- not in the register yet (client_id is null until somebody is).
       SELECT 1, qp.position, 0, qp.full_name, TRIM(qp.email)
         FROM quote_parties qp
        WHERE qp.quote_id = ? AND TRIM(COALESCE(qp.email, '')) <> ''
       UNION ALL
       -- 2: everybody on the matter this quotation belongs to.
       SELECT 2, 0, 1, cl.full_name, TRIM(cl.email)
         FROM case_parties cp JOIN clients cl ON cl.id = cp.client_id
        WHERE cp.case_id = ? AND TRIM(COALESCE(cl.email, '')) <> ''
       UNION ALL
       -- 3: everybody else with an address on their record. Archived clients
       -- are left out — a file that has been put away is not somebody the
       -- practice is writing to — but the four tiers above ignore that, so the
       -- client of this very quotation is offered even if their file is closed.
       SELECT 3, 0, 1, cl.full_name, TRIM(cl.email)
         FROM clients cl
        WHERE TRIM(COALESCE(cl.email, '')) <> '' AND cl.status <> 'archived'
     )
     ORDER BY tier, pos, living DESC, name COLLATE NOCASE
     LIMIT ?`,
    quote.client_id ?? '', quote.id, quote.id, quote.case_id ?? '', RECIPIENT_CAP,
  );

  const byAddress = new Map<string, Recipient & { living: boolean }>();
  const order: string[] = [];
  for (const row of rows) {
    const key = row.address.toLowerCase();
    const kept = byAddress.get(key);
    if (!kept) {
      byAddress.set(key, { name: row.name, address: row.address, living: row.living === 1 });
      order.push(key);
      continue;
    }
    // The living record's name replaces the snapshot's, without moving the
    // address down the list: where it sits is about how close it is to this
    // quotation, which the snapshot answered correctly.
    if (!kept.living && row.living === 1) {
      kept.name = row.name;
      kept.living = true;
    }
  }
  return order.map((key) => {
    const { name, address } = byAddress.get(key)!;
    return { name, address };
  });
}

/**
 * Of these addresses, the ones on no client record.
 *
 * Asked in one query rather than by searching the picker list, because the
 * picker is capped and this must not be: an address that fell off the end of
 * five hundred is known to the register, and calling it unrecognised would send
 * somebody to create a duplicate client.
 *
 * A client record and nothing else counts as recognition, deliberately. A
 * quotation party is a name typed onto one contract; the answer to "the
 * register does not know this address" is to put it on the record of the person
 * who holds it, and a quotation party has no record to put it on.
 */
export async function unrecognisedRecipients(
  env: { DB: D1Database }, addresses: readonly string[],
): Promise<string[]> {
  const wanted = [...new Set(addresses.map((a) => a.trim().toLowerCase()).filter(Boolean))];
  if (wanted.length === 0) return [];
  const known = new Set(
    (await allByIds<{ address: string }>(
      env.DB, wanted,
      (placeholders) =>
        `SELECT LOWER(TRIM(email)) AS address FROM clients
          WHERE TRIM(COALESCE(email, '')) <> '' AND LOWER(TRIM(email)) IN (${placeholders})`,
    )).map((r) => r.address),
  );
  return wanted.filter((a) => !known.has(a));
}
