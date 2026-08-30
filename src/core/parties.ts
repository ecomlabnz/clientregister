/**
 * The parties to a case.
 *
 * A matter rarely involves one person. An AEWV has an applicant and an
 * employer; a partnership application has an applicant and a supporting
 * partner; a family has a principal applicant and secondary applicants. Each
 * is a client in their own right, with their own documents and expiry dates,
 * playing a role on this particular case.
 *
 * The role belongs to the link rather than to the client, so a company can be
 * the client of its own accreditation case and the employer on somebody else's
 * work visa at the same time.
 */

import type { Env } from '../types';
import type { PartyRole } from '../domain';
import { all, nowIso, one, run } from './db';
import { newId } from './ids';

export interface CaseParty {
  id: string;
  case_id: string;
  client_id: string;
  role: PartyRole;
  notes: string | null;
  created_at: string;
  /** Joined for display. */
  client_name?: string;
  client_ref?: string;
  client_kind?: string;
}

/** Order parties the way a file reads: applicant first, then the rest. */
const ROLE_ORDER: PartyRole[] = [
  'principal_applicant', 'secondary_applicant', 'dependent_child',
  'supporting_partner', 'sponsor', 'employer', 'agent', 'lawyer', 'adviser', 'other',
];

function byRole(a: { role: PartyRole }, b: { role: PartyRole }): number {
  return ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role);
}

export async function partiesForCase(env: Env, caseId: string): Promise<CaseParty[]> {
  const rows = await all<CaseParty>(
    env.DB,
    `SELECT p.*, cl.full_name AS client_name, cl.ref AS client_ref, cl.kind AS client_kind
       FROM case_parties p JOIN clients cl ON cl.id = p.client_id
      WHERE p.case_id = ?`,
    caseId,
  );
  return rows.sort(byRole);
}

export interface ClientCaseRole {
  case_id: string;
  case_ref: string;
  case_title: string;
  case_status: string;
  role: PartyRole;
}

/** Every case a client is involved in, and in what capacity. */
export async function casesForClient(env: Env, clientId: string): Promise<ClientCaseRole[]> {
  return all<ClientCaseRole>(
    env.DB,
    `SELECT k.id AS case_id, k.ref AS case_ref, k.title AS case_title, k.status AS case_status, p.role
       FROM case_parties p JOIN cases k ON k.id = p.case_id
      WHERE p.client_id = ?
      ORDER BY k.updated_at DESC`,
    clientId,
  );
}

export interface RelatedClient {
  id: string;
  ref: string;
  full_name: string;
  role: PartyRole;
  via_case_ref: string;
  via_case_id: string;
}

/**
 * Other people and organisations on the same cases — which is how a family
 * group shows itself without a separate concept of a household. Two clients
 * are related here because they appear on a matter together, which is a fact
 * the register already knows rather than one someone has to maintain.
 */
export async function relatedClients(env: Env, clientId: string): Promise<RelatedClient[]> {
  return all<RelatedClient>(
    env.DB,
    `SELECT DISTINCT other.client_id AS id, cl.ref, cl.full_name, other.role,
            k.ref AS via_case_ref, k.id AS via_case_id
       FROM case_parties mine
       JOIN case_parties other ON other.case_id = mine.case_id AND other.client_id != mine.client_id
       JOIN clients cl ON cl.id = other.client_id
       JOIN cases k ON k.id = mine.case_id
      WHERE mine.client_id = ?
      ORDER BY cl.full_name`,
    clientId,
  );
}

export async function addParty(
  env: Env,
  input: { caseId: string; clientId: string; role: PartyRole; notes?: string | null; createdBy: string | null },
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const existing = await one<{ id: string; role: string }>(
    env.DB, 'SELECT id, role FROM case_parties WHERE case_id = ? AND client_id = ?',
    input.caseId, input.clientId,
  );
  if (existing) return { ok: false, reason: 'That client is already a party to this case.' };

  // A matter has one principal applicant. Everything about an application is
  // measured from that person, and two makes the file ambiguous about the one
  // thing it has to be certain about. The database refuses it either way — this
  // says so in words, and names who already holds the role.
  if (input.role === 'principal_applicant') {
    const held = await one<{ full_name: string }>(
      env.DB,
      `SELECT cl.full_name FROM case_parties p JOIN clients cl ON cl.id = p.client_id
        WHERE p.case_id = ? AND p.role = 'principal_applicant'`,
      input.caseId,
    );
    if (held) {
      return { ok: false,
        reason: `${held.full_name} is already the principal applicant on this matter. `
          + 'A matter has one — add this person in another role, or change theirs first.' };
    }
  }

  const id = newId('prt');
  await run(
    env.DB,
    `INSERT INTO case_parties (id, case_id, client_id, role, notes, created_at, created_by)
     VALUES (?,?,?,?,?,?,?)`,
    id, input.caseId, input.clientId, input.role, input.notes ?? null, nowIso(), input.createdBy,
  );
  return { ok: true, id };
}

export async function removeParty(env: Env, caseId: string, partyId: string): Promise<CaseParty | null> {
  const party = await one<CaseParty>(
    env.DB, 'SELECT * FROM case_parties WHERE id = ? AND case_id = ?', partyId, caseId,
  );
  if (!party) return null;
  await run(env.DB, 'DELETE FROM case_parties WHERE id = ?', partyId);
  return party;
}
