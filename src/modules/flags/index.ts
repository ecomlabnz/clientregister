/**
 * Raising and taking down a warning.
 *
 * One place, because a warning means the same thing on a client and on a
 * matter, and the two pages that show them should not each own half the rule.
 * What a flag *is* lives in `core/flags.ts`.
 */

import type { Hono } from 'hono';
import type { AppContext } from '../../types';
import type { AppModule } from '../../core/module';
import { requirePermission } from '../../core/auth';
import { auditFrom } from '../../core/audit';
import { one } from '../../core/db';
import { FormReader } from '../../core/validate';
import { clearFlag, deleteFlag, editFlag, flagKinds, raiseAgain, raiseFlag, type Flag } from '../../core/flags';
import { isTerm } from '../../core/vocabulary';
import { redirectWith } from '../../ui/layout';

const backTo = (entityType: string, entityId: string): string =>
  entityType === 'case' ? `/cases/${entityId}` : `/clients/${entityId}`;

export const flagsModule: AppModule = {
  name: 'flags',
  title: 'Warnings',
  register(r: Hono<AppContext>) {
    r.post('/flags', requirePermission('register:write'), async (c) => {
      const user = c.get('user')!;
      const f = new FormReader(await c.req.formData());
      const entityType = f.enum('entity_type', ['client', 'case'] as const, { fallback: 'client' })!;
      const entityId = f.text('entity_id', { required: true, label: 'Record', max: 60 });
      const kind = f.text('kind', { required: true, label: 'Kind', max: 40 });
      const body = f.text('body', { required: true, label: 'Warning', max: 500 });
      const life = f.optional('life', { max: 20 });
      const back = backTo(entityType, entityId);
      if (!f.valid) return redirectWith(c, back, Object.values(f.errors)[0]!, 'err');

      // The kind is vocabulary, so what is offered can change between the page
      // being drawn and the form coming back. An unknown one is refused rather
      // than stored: a warning filed under a heading nobody recognises is a
      // warning nobody finds.
      if (!isTerm(await flagKinds(c.env), kind)) {
        return redirectWith(c, back, 'Choose what kind of warning this is.', 'err');
      }

      const id = await raiseFlag(c.env, {
        entityType, entityId, kind, body, life: life ?? null, byUserId: user.id,
      });
      await auditFrom(c, {
        action: 'flag.raised', entityType: entityType as never, entityId,
        meta: { flag: id, kind, life: life ?? 'standing' },
      });
      return redirectWith(c, back, 'Warning raised. It shows at the top of this record.');
    });

    r.post('/flags/:id/edit', requirePermission('register:write'), async (c) => {
      const id = c.req.param('id')!;
      const flag = await one<Flag>(c.env.DB, 'SELECT * FROM flags WHERE id = ?', id);
      if (!flag) return c.notFound();
      const back = backTo(flag.entity_type, flag.entity_id);

      const f = new FormReader(await c.req.formData());
      const kind = f.text('kind', { required: true, label: 'Kind', max: 40 });
      const body = f.text('body', { required: true, label: 'Warning', max: 500 });
      const life = f.optional('life', { max: 20 });
      if (!f.valid) return redirectWith(c, back, Object.values(f.errors)[0]!, 'err');
      if (!isTerm(await flagKinds(c.env), kind)) {
        return redirectWith(c, back, 'Choose what kind of warning this is.', 'err');
      }

      await editFlag(c.env, { id, kind, body, life: life ?? null });
      await auditFrom(c, {
        action: 'flag.edited', entityType: flag.entity_type as never, entityId: flag.entity_id,
        // What it said before, because the audit log is the append-only half and
        // an edit that leaves no trace of the old wording is a rewrite.
        meta: { flag: id, kind, was: flag.body, was_kind: flag.kind },
      });
      return redirectWith(c, back, 'Warning updated.');
    });

    r.post('/flags/:id/delete', requirePermission('register:write'), async (c) => {
      const id = c.req.param('id')!;
      const flag = await one<Flag>(c.env.DB, 'SELECT * FROM flags WHERE id = ?', id);
      if (!flag) return c.notFound();
      const back = backTo(flag.entity_type, flag.entity_id);

      await deleteFlag(c.env, id);
      await auditFrom(c, {
        action: 'flag.deleted', entityType: flag.entity_type as never, entityId: flag.entity_id,
        meta: { flag: id, kind: flag.kind, said: flag.body },
      });
      return redirectWith(c, back, 'Warning deleted. What it said is in the audit log.');
    });

    r.post('/flags/:id/clear', requirePermission('register:write'), async (c) => {
      const id = c.req.param('id')!;
      const user = c.get('user')!;
      const flag = await one<Flag>(c.env.DB, 'SELECT * FROM flags WHERE id = ?', id);
      if (!flag) return c.notFound();
      const back = backTo(flag.entity_type, flag.entity_id);

      const f = new FormReader(await c.req.formData());
      await clearFlag(c.env, { id, note: f.optional('note', { max: 300 }) ?? null, byUserId: user.id });
      await auditFrom(c, {
        action: 'flag.cleared', entityType: flag.entity_type as never, entityId: flag.entity_id,
        meta: { flag: id, kind: flag.kind },
      });
      return redirectWith(c, back, 'Warning taken down. It stays on the record as history.');
    });

    r.post('/flags/:id/raise-again', requirePermission('register:write'), async (c) => {
      const id = c.req.param('id')!;
      const flag = await one<Flag>(c.env.DB, 'SELECT * FROM flags WHERE id = ?', id);
      if (!flag) return c.notFound();
      await raiseAgain(c.env, id);
      await auditFrom(c, {
        action: 'flag.raised_again', entityType: flag.entity_type as never,
        entityId: flag.entity_id, meta: { flag: id, kind: flag.kind },
      });
      return redirectWith(c, backTo(flag.entity_type, flag.entity_id),
        'Warning back up. It stands until it is taken down again.');
    });
  },
};
