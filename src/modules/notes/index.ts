/**
 * Correcting a file note.
 *
 * One route, in one place, because clients, cases and inquiries all hang their
 * history off the same table and a correction should mean the same thing on
 * each. The rule it enforces lives in `core/timeline.ts` and, more to the
 * point, in the database: migration 0052 refuses a late or repeated correction
 * whatever asks for it.
 *
 * What the practice can do here is narrow on purpose. A note stays append-only;
 * this is five minutes to fix the date you just mistyped, not an edit button.
 */

import type { Hono } from 'hono';
import type { AppContext } from '../../types';
import type { AppModule } from '../../core/module';
import { requirePermission } from '../../core/auth';
import { auditFrom } from '../../core/audit';
import { one } from '../../core/db';
import { FormReader } from '../../core/validate';
import { correctEntry } from '../../core/timeline';
import { ENTRY_KINDS } from '../../domain';
import { instantForDate } from '../../ui/format';
import { redirectWith } from '../../ui/layout';

/** Where to send somebody back to, from the note's own entity. */
function backTo(entityType: string, entityId: string): string {
  switch (entityType) {
    case 'case': return `/cases/${entityId}`;
    case 'client': return `/clients/${entityId}`;
    case 'inquiry': return `/inquiries/${entityId}`;
    case 'quote': return `/quotes/${entityId}`;
    default: return '/';
  }
}

export const notesModule: AppModule = {
  name: 'notes',
  title: 'File notes',
  basePaths: ['/entries'],
  register(r: Hono<AppContext>) {
    r.post('/entries/:id/correct', requirePermission('register:write'), async (c) => {
      const id = c.req.param('id')!;
      const user = c.get('user')!;
      const entry = await one<{ entity_type: string; entity_id: string }>(
        c.env.DB, 'SELECT entity_type, entity_id FROM entries WHERE id = ?', id,
      );
      if (!entry) return c.notFound();
      const back = backTo(entry.entity_type, entry.entity_id);

      const f = new FormReader(await c.req.formData());
      const body = f.text('body', { required: true, label: 'Note', max: 20000 });
      const kind = f.enum('kind', ENTRY_KINDS, { fallback: 'note' })!;
      const occurredOn = f.date('occurred_at');
      if (!f.valid) return redirectWith(c, back, Object.values(f.errors)[0]!, 'err');

      const result = await correctEntry(c.env, {
        id, body, kind,
        occurredAt: occurredOn ? instantForDate(occurredOn) : new Date().toISOString(),
        byUserId: user.id,
      });
      if ('error' in result) return redirectWith(c, back, result.error, 'err');

      // The audit log is append-only without exception, so the note as it stood
      // before the correction stays answerable even though the note itself now
      // reads differently.
      await auditFrom(c, {
        action: 'entry.corrected',
        entityType: entry.entity_type as never,
        entityId: entry.entity_id,
        meta: { entry: id, was: result.was },
      });
      return redirectWith(c, back, 'Note corrected.');
    });
  },
};
