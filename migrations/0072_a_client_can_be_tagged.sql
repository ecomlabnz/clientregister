-- Tags on clients, which matters have had since migration 0007.
--
-- **Asked 8 September 2026:** *"we need tags for clients and cases — if not yet
-- implemented. For cases they exist I believe but not for clients — why?"*
--
-- No reason. `tags` and `case_tags` were built together in 0007 and the client
-- half was simply never written. The tag list itself is shared, so a tag
-- invented on a matter is the same tag on a client — which is what the practice
-- would expect, and the reason this is one new table rather than a second list
-- of names.
--
-- ## Why not one `entity_tags` table for both
--
-- It is the better shape, and it is not this change. The register already
-- carries that pattern twice — `documents` and `entries` both hang off an
-- `(entity_type, entity_id)` pair — so tags on two tables is the odd one out,
-- and a third parallel table one day would be worse still.
--
-- Against that: `case_tags` works, carries 192 live links, and folding its
-- consolidation into a feature the practice asked for turns a small addition
-- into a change to something that is not broken. `docs/spec/rebuilding.md`,
-- written this morning, argues exactly this for the file tables: consolidations
-- are done deliberately, one at a time, each with its own migration and
-- rehearsal — not smuggled in alongside something else.
--
-- So: `client_tags` now, and the consolidation recorded in `docs/pipeline.md`
-- beside the two file tables, which is the same job.

CREATE TABLE client_tags (
  client_id  TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  tag_id     TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (client_id, tag_id)
);

-- Read the other way as often as it is written: "everybody tagged Vietnamese"
-- is the question a tag exists to answer, and without this it is a scan.
CREATE INDEX idx_client_tags_tag ON client_tags (tag_id);
