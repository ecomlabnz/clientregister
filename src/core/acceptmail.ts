/**
 * The two letters that go out when a client accepts.
 *
 * **Asked for on 9 September 2026**, from the practice's own test of the new
 * link: *"the client did not receive a confirmation email about the fact that
 * they have accepted the fee quotation and the link to that quotation"*, then
 * *"remember — two emails should go out: one to the client confirming
 * acceptance, and one to the lawyer confirming acceptance."*
 *
 * Both, and they are different letters because they answer different questions.
 * The client's says *what you have agreed to and where to find it again*. The
 * practice's says *this arrived, here is who and when, and here is what to do
 * next*. A single message copied to both would be one of those and not the
 * other.
 *
 * ## The link does not change
 *
 * The practice asked whether it should, *"IF the actual quotation changed — IF
 * that is a possibility at all"*. It is not, since migration 0079: once a
 * client has accepted, the quotation is frozen — the fee lines, the schedule,
 * the parties, the figures, the dates. So the address in the client's
 * confirmation goes on showing exactly the document they accepted, for as long
 * as they keep the email. That is the property that makes a confirmation worth
 * sending.
 *
 * ## Queued, never sent from here
 *
 * Both go through `queueEmail`, so they are recorded against the record, they
 * survive a provider being down, and they appear in the outbound list like
 * everything else. Acceptance itself is never held up by mail: if the queue
 * refuses the message the acceptance still stands, because a contract is formed
 * by the client's act and not by our bookkeeping.
 */

import type { Env } from '../types';
import { getSetting, one } from './db';
import { money, dateShort, printedAt } from '../ui/format';
import { practiceDetails } from './practice';
import { queueEmail } from '../mail/queue';

export interface AcceptedQuote {
  id: string;
  ref: string;
  clientName: string | null;
  clientEmail: string | null;
  withLetter: boolean;
  totalCents: number;
  currency: string;
  link: string;
}

/**
 * Both letters, queued.
 *
 * Answers what it managed rather than throwing: the caller has already recorded
 * an acceptance that cannot be undone, and an address the practice mistyped six
 * weeks ago must not turn that into an error page for the client.
 */
export async function queueAcceptanceEmails(
  env: Env,
  q: AcceptedQuote,
  accepted: { name: string; signedOn: string; at: string },
): Promise<{ toClient: boolean; toPractice: boolean }> {
  const practice = await practiceDetails(env);
  const total = money(q.totalCents, q.currency);
  const documents = q.withLetter
    ? 'the quotation and the Letter of Engagement'
    : 'the quotation';

  let toClient = false;
  if (q.clientEmail) {
    const text = [
      `Dear ${q.clientName ?? 'Sir or Madam'},`,
      '',
      `Thank you. We have received your acceptance of quotation ${q.ref}.`,
      '',
      `Accepted by: ${accepted.name}`,
      `Date given: ${dateShort(accepted.signedOn)}`,
      `Received: ${printedAt(accepted.at)}`,
      `Total: ${total}`,
      '',
      `You agreed to ${documents}. They remain available at the same address, and`,
      'will not change now that they have been accepted:',
      '',
      q.link,
      '',
      'Please keep this email. If anything in it looks wrong, reply to it straight away',
      'and we will put it right before any work begins.',
      '',
      'We will be in touch shortly about the next steps.',
      '',
      'Kind regards,',
      practice.legalName,
      practice.contactEmail,
      practice.contactPhone,
    ].filter((l, i, all) => l !== '' || (all[i - 1] ?? '') !== '').join('\n');

    try {
      await queueEmail(env, {
        to: q.clientEmail,
        subject: `Accepted: quotation ${q.ref}`,
        text,
        entityType: 'quote',
        entityId: q.id,
        createdBy: null,
      });
      toClient = true;
    } catch {
      // A bad address on the client record. The acceptance stands; the practice
      // is told below, and the file note records it either way.
    }
  }

  // Where the practice's own copy goes. Their outgoing address if they have not
  // set somewhere else, because that is the one mailbox they certainly read.
  const notify = (await getSetting(env, 'practice.acceptance_notify', ''))
    || practice.contactEmail;

  let toPractice = false;
  if (notify) {
    const text = [
      `${q.ref} has been accepted.`,
      '',
      `Client: ${q.clientName ?? 'not named'}`,
      `Accepted by: ${accepted.name}`,
      `Date given: ${dateShort(accepted.signedOn)}`,
      `Received: ${printedAt(accepted.at)}`,
      `Total: ${total}`,
      q.withLetter ? 'Sent with the letter of engagement.' : 'Sent without a letter of engagement.',
      '',
      'What this means:',
      '',
      `- ${q.ref} is now fixed. Its lines, schedule, parties and figures cannot be edited.`,
      '  If anything needs to change, issue a new quotation.',
      `- The client has been sent a confirmation${q.clientEmail ? '' : ' — except that no email address is on their record, so they have not'}.`,
      '- The acceptance is on the quotation\'s file notes and in the audit log.',
      '',
      'The quotation as the client sees it:',
      '',
      q.link,
    ].filter((l, i, all) => l !== '' || (all[i - 1] ?? '') !== '').join('\n');

    try {
      await queueEmail(env, {
        to: notify,
        subject: `${q.ref} accepted by ${accepted.name}`,
        text,
        entityType: 'quote',
        entityId: q.id,
        createdBy: null,
      });
      toPractice = true;
    } catch {
      // Nothing more to do: the acceptance is recorded and visible in the
      // register whether or not this letter got out.
    }
  }

  return { toClient, toPractice };
}

/** Everything the two letters need, read once. */
export async function acceptedQuoteFor(
  env: Env, quoteId: string, link: string,
): Promise<AcceptedQuote | null> {
  const row = await one<{
    id: string; ref: string; client_name: string | null; client_email: string | null;
    with_letter: number | null; amount_cents: number; gst_cents: number;
    disbursements_cents: number; currency: string;
  }>(
    env.DB,
    `SELECT q.id, q.ref, q.with_letter, q.amount_cents, q.gst_cents, q.disbursements_cents,
            q.currency, cl.full_name AS client_name, cl.email AS client_email
       FROM quotes q LEFT JOIN clients cl ON cl.id = q.client_id
      WHERE q.id = ?`, quoteId);
  if (!row) return null;
  return {
    id: row.id,
    ref: row.ref,
    clientName: row.client_name,
    clientEmail: row.client_email,
    withLetter: row.with_letter === 1,
    totalCents: row.amount_cents + row.gst_cents + row.disbursements_cents,
    currency: row.currency,
    link,
  };
}
