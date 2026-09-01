-- A record that leaves the register says so, in the register's own hand.
--
-- On 1 September 2026 a client file was removed at the practice's instruction
-- with a DELETE run straight against production. There is no route that deletes
-- a client, so there was no other way to do it — and a statement run by hand
-- writes nothing to the audit log. The file left and nothing anywhere said so.
-- It was found by counting: the reference sequence had a gap the audit log could
-- not explain.
--
-- The audit row should never have depended on which route, load or hand-run
-- statement made the change. The database writes it now, so nothing can remove a
-- client or a matter quietly — not the application, not a bulk load, not a
-- person at a console. This is the third time an audit row has been found
-- missing because a handler owned it; it is the last.
--
-- Deleting a client cascades to its matters, so a client removal writes one row
-- for the client and one for each matter that went with it. That is the point:
-- every reference is accounted for.

CREATE TRIGGER clients_deleted_are_audited
AFTER DELETE ON clients
BEGIN
  INSERT INTO audit_log (id, at, actor_id, actor_label, action, entity_type, entity_id, meta_json)
  VALUES (
    'aud_del_' || OLD.id,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    OLD.created_by,
    'database',
    'client.deleted',
    'client',
    OLD.id,
    json_object('ref', OLD.ref, 'full_name', OLD.full_name, 'kind', OLD.kind,
                'status', OLD.status, 'created_at', OLD.created_at,
                'note', 'Written by the database when the record was removed. The reference is retired and must never be reissued.')
  );
END;

CREATE TRIGGER cases_deleted_are_audited
AFTER DELETE ON cases
BEGIN
  INSERT INTO audit_log (id, at, actor_id, actor_label, action, entity_type, entity_id, meta_json)
  VALUES (
    'aud_del_' || OLD.id,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    OLD.created_by,
    'database',
    'case.deleted',
    'case',
    OLD.id,
    json_object('ref', OLD.ref, 'title', OLD.title, 'client', OLD.client_id,
                'case_type', OLD.case_type, 'status', OLD.status,
                'outcome', OLD.outcome, 'created_at', OLD.created_at,
                'note', 'Written by the database when the record was removed. The reference is retired and must never be reissued.')
  );
END;
