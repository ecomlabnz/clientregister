/**
 * Clients the practice has finished with.
 *
 * A person whose matters are all closed and whose documents have all expired is
 * almost certainly gone — and until somebody says so, their expired visa,
 * passport and certificates go on raising alerts for ever. The practice put it
 * plainly on 3 September: *"some of the visa expiries we cannot handle — as the
 * clients move on."*
 *
 * The register already had the answer and had never used it: an **archived**
 * client raises no expiry alert anywhere, and appears on no calendar. Nine
 * separate queries check for it. Nothing is deleted — the file, the matters,
 * the notes and the history all stay, and changing the status back brings
 * everything with it.
 *
 * What was missing was a way to *find* them and a way to do it in one pass
 * rather than forty-eight times by hand.
 *
 * ## The test, and why it is drawn where it is
 *
 * Three things together, and all three are needed:
 *
 *   1. **No live matter.** Not merely no open case — nothing at any working
 *      status. A matter still being prepared means the person is here.
 *   2. **At least one expired document.** Otherwise a client taken on this
 *      morning, with nothing on file yet, would be proposed for archiving on
 *      their first day.
 *   3. **Nothing still in date.** A passport good until 2029 says somebody
 *      expects to use it. One live document is enough to keep a person out of
 *      this list.
 *
 * It is a *proposal*. The register never archives anybody on its own: it says
 * who looks finished with and a person decides. Being wrong costs one click,
 * because archiving reverses — but being wrong silently would not.
 */

import type { Env } from '../types';
import { all } from './db';
import { OPEN_CASE_STATUSES } from '../domain';

export interface DormantClient {
  id: string;
  ref: string;
  full_name: string;
  status: string;
  /** How many of their dated documents have run out. */
  expired: number;
  /** The most recent expiry, which is roughly when they stopped needing us. */
  last_expiry: string;
  /** Matters on the file, all of them finished. */
  matters: number;
}

/**
 * Every dated document a client holds, as one list.
 *
 * Written once here rather than three times in the query below, because the
 * three arms have to agree about what "dated" means — and the visa lives on the
 * client row while the other two live in their own tables.
 */
const DOCUMENTS = `
  SELECT c.id AS client_id, c.current_visa_expiry AS expires FROM clients c
   WHERE c.current_visa_expiry IS NOT NULL
  UNION ALL
  SELECT p.client_id, p.expires_on FROM client_passports p
   WHERE p.status = 'held' AND p.expires_on IS NOT NULL
  UNION ALL
  SELECT cc.client_id, cc.expires_on FROM client_certificates cc
   WHERE cc.expires_on IS NOT NULL`;

export async function dormantClients(env: Env, today: string, limit = 500): Promise<DormantClient[]> {
  const openIn = OPEN_CASE_STATUSES.map(() => '?').join(',');
  return all<DormantClient>(
    env.DB,
    `SELECT c.id, c.ref, c.full_name, c.status,
            (SELECT COUNT(*) FROM (${DOCUMENTS}) d
              WHERE d.client_id = c.id AND d.expires < ?) AS expired,
            (SELECT MAX(d.expires) FROM (${DOCUMENTS}) d
              WHERE d.client_id = c.id AND d.expires < ?) AS last_expiry,
            (SELECT COUNT(*) FROM cases k WHERE k.client_id = c.id) AS matters
       FROM clients c
      WHERE c.status <> 'archived'
        -- Nothing live: no matter at any working status.
        AND NOT EXISTS (SELECT 1 FROM cases k
                         WHERE k.client_id = c.id AND k.closed_at IS NULL
                           AND k.status IN (${openIn}))
        -- Something has expired...
        AND EXISTS (SELECT 1 FROM (${DOCUMENTS}) d
                     WHERE d.client_id = c.id AND d.expires < ?)
        -- ...and nothing is still in date. One live document is enough to keep
        -- a person out of this list.
        AND NOT EXISTS (SELECT 1 FROM (${DOCUMENTS}) d
                         WHERE d.client_id = c.id AND d.expires >= ?)
      ORDER BY last_expiry, c.ref
      LIMIT ?`,
    today, today, ...OPEN_CASE_STATUSES, today, today, limit);
}

/**
 * Of these ids, which may actually be archived.
 *
 * Re-read at the moment of writing rather than trusted from the form: between
 * proposing and applying, somebody may have opened a new matter for one of
 * them, and the person pressing the button cannot see that.
 */
export async function stillDormant(env: Env, today: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const proposed = await dormantClients(env, today, 1000);
  const allowed = new Set(proposed.map((r) => r.id));
  return new Set(ids.filter((id) => allowed.has(id)));
}
