-- Conversations, so a channel is somewhere you talk rather than only a place
-- messages arrive from.
--
-- A thread is one counterpart on one channel: a Telegram chat, a WhatsApp
-- number, an email address. Inbound messages already land in ingest_messages;
-- this gives them a thread to belong to, and gives the practice somewhere to
-- reply from.
--
-- The invariant worth naming: every outbound message has a person behind it.
-- `created_by` is NOT NULL and restricted, so a reply cannot exist without a
-- user account attached to it, and deleting the account does not orphan what
-- they sent. Nothing in this application sends on a channel by itself.

CREATE TABLE channel_threads (
  id             TEXT PRIMARY KEY,
  channel        TEXT NOT NULL CHECK (channel IN ('telegram','whatsapp','email')),
  -- The counterpart's address on that channel: a chat id, a phone number, an
  -- email address. Together with the channel it identifies the conversation.
  peer_id        TEXT NOT NULL,
  peer_label     TEXT,
  -- A conversation may be about somebody in the register, and may not be yet.
  client_id      TEXT REFERENCES clients(id) ON DELETE SET NULL,
  case_id        TEXT REFERENCES cases(id) ON DELETE SET NULL,
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  last_message_at TEXT,
  created_at     TEXT NOT NULL,
  UNIQUE (channel, peer_id)
);

CREATE INDEX idx_channel_threads_recent ON channel_threads (status, last_message_at DESC);
CREATE INDEX idx_channel_threads_client ON channel_threads (client_id);

ALTER TABLE ingest_messages ADD COLUMN thread_id TEXT REFERENCES channel_threads(id) ON DELETE SET NULL;
CREATE INDEX idx_ingest_thread ON ingest_messages (thread_id, received_at);

CREATE TABLE channel_replies (
  id          TEXT PRIMARY KEY,
  thread_id   TEXT NOT NULL REFERENCES channel_threads(id) ON DELETE CASCADE,
  channel     TEXT NOT NULL CHECK (channel IN ('telegram','whatsapp','email')),
  body        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed')),
  provider_id TEXT,
  error       TEXT,
  created_at  TEXT NOT NULL,
  -- Every message the practice sends has a person against it. Not nullable,
  -- and RESTRICT rather than SET NULL: a sent message keeps its author.
  created_by  TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  sent_at     TEXT
);

CREATE INDEX idx_channel_replies_thread ON channel_replies (thread_id, created_at);
