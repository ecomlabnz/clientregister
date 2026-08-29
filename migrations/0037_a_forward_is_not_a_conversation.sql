-- 0037_a_forward_is_not_a_conversation.sql
--
-- A conversation is two people talking on one channel: what they sent, and what
-- the practice sent back. Its key is the counterpart — a chat id, a phone
-- number, an email address — because that is both who it is with and where a
-- reply goes.
--
-- A forwarded Telegram message has no counterpart. It arrives in the practice's
-- own chat with the bot, and it is *about* somebody who is not in that chat at
-- all. Keyed on the chat id, as it was, every forward landed in one thread named
-- after whoever did the forwarding — three unrelated people appearing as one
-- conversation with "TZ" — and a reply typed there would have gone back to the
-- forwarder rather than to the person it was about.
--
-- So a forward is an inbox message and, when it is work, an inquiry. It is not a
-- conversation. The capture no longer offers one a peer; this makes that a
-- guarantee about the data rather than a habit of one handler, and unpicks the
-- threads that were built on the old rule.

PRAGMA foreign_keys = ON;

-- 1. Take the forwards back out of the conversations they were put in.
UPDATE ingest_messages
   SET thread_id = NULL
 WHERE thread_id IS NOT NULL
   AND channel = 'telegram'
   AND json_extract(meta_json, '$.forwarded') = 1;

-- 2. A thread left holding nothing was never a conversation, only the shape of
--    one. A thread that carries a reply is kept whatever else happened in it:
--    the practice said something to somebody through it, and that stands.
DELETE FROM channel_threads
 WHERE channel = 'telegram'
   AND NOT EXISTS (SELECT 1 FROM ingest_messages m WHERE m.thread_id = channel_threads.id)
   AND NOT EXISTS (SELECT 1 FROM channel_replies r WHERE r.thread_id = channel_threads.id);

-- 3. And it cannot come back. Both halves, because the capture writes the row
--    first and attaches the thread in a second statement.
CREATE TRIGGER ingest_forward_gets_no_conversation_on_insert
BEFORE INSERT ON ingest_messages
WHEN NEW.thread_id IS NOT NULL
 AND json_extract(NEW.meta_json, '$.forwarded') = 1
BEGIN
  SELECT RAISE(ABORT, 'a forwarded message is about somebody, not a conversation with them');
END;

CREATE TRIGGER ingest_forward_gets_no_conversation_on_update
BEFORE UPDATE OF thread_id ON ingest_messages
WHEN NEW.thread_id IS NOT NULL
 AND json_extract(NEW.meta_json, '$.forwarded') = 1
BEGIN
  SELECT RAISE(ABORT, 'a forwarded message is about somebody, not a conversation with them');
END;
