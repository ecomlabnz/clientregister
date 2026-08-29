-- A person may hold more than one passport.
--
-- Until now a client had exactly three columns for one: number, country,
-- expiry. That is wrong often enough to matter in this practice. A dual
-- national holds two at once and neither supersedes the other. Someone who has
-- just renewed holds the new one and the old one carrying a valid visa — which
-- is the whole reason "Transfer to New Passport" is a case type. And a client
-- who travels on one passport and claims a partnership through another needs
-- both on the file.
--
-- So each passport is its own row. The columns on `clients` stay, holding the
-- one marked primary: the alerts page, the client list, the CSV export and the
-- intake extraction already read them, and denormalising the primary keeps
-- those queries simple. They are refreshed from this table on every change —
-- this table is the record, those columns are a cache of it. That is the same
-- arrangement as client_certificates, deliberately, so there is one pattern to
-- learn rather than two.

CREATE TABLE client_passports (
  id            TEXT PRIMARY KEY,
  client_id     TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  -- The issuing country, which for a dual national is the point of the row.
  country       TEXT,
  -- Sealed with FIELD_KEY, exactly as the single column was. A passport number
  -- is the one field in the register that is encrypted at rest, and adding
  -- more of them per client does not change that.
  number_sealed TEXT,
  issued_on     TEXT,
  expires_on    TEXT,
  -- Held is the default and the only one the alerts watch. A passport that has
  -- been replaced still matters as a record — a visa may be stuck in it — but
  -- its expiry is not something to chase anybody about.
  status        TEXT NOT NULL DEFAULT 'held'
                CHECK (status IN ('held','replaced','lost','cancelled')),
  is_primary    INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  notes         TEXT,
  created_at    TEXT NOT NULL,
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL
);

-- At most one primary per client, enforced by the database rather than by
-- every code path remembering to clear the old one first.
CREATE UNIQUE INDEX idx_client_passports_primary
  ON client_passports (client_id) WHERE is_primary = 1;
CREATE INDEX idx_client_passports_client ON client_passports (client_id, expires_on);
CREATE INDEX idx_client_passports_expiry ON client_passports (expires_on) WHERE status = 'held';

-- Carry across what is already held. The existing passport becomes the primary
-- one, sealed value and all: the ciphertext moves as it stands, so nothing is
-- re-encrypted and nothing needs the key to run this migration.
INSERT INTO client_passports
    (id, client_id, country, number_sealed, expires_on, status, is_primary, created_at)
  SELECT 'pas_' || id, id, passport_country, passport_sealed, passport_expiry,
         'held', 1, datetime('now')
    FROM clients
   WHERE passport_sealed IS NOT NULL
      OR passport_country IS NOT NULL
      OR passport_expiry IS NOT NULL;
