-- Certificates are records, not fields.
--
-- Until now a police certificate was three columns on the client row, and a new
-- one overwrote the old. That is wrong for exactly the reason it matters: a
-- matter lodged in March relied on the certificate held in March, and if the
-- client produces a fresh one in September the March fact is gone. "Which
-- certificate did we lodge with?" is a question a practice has to be able to
-- answer, sometimes years later.
--
-- So each certificate is its own row, with its own dates, and a client may have
-- as many as they have had. The columns on `clients` stay, holding the *current*
-- one — the alerts page, the intake extraction and every list already read them,
-- and denormalising the latest expiry keeps those queries simple. They are
-- refreshed from this table whenever it changes; this table is the record and
-- they are a cache of it.

CREATE TABLE client_certificates (
  id          TEXT PRIMARY KEY,
  client_id   TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('police','medical','chest_xray')),
  -- What sort of one. A medical is a General Medical or a Limited Medical, and
  -- which one was done decides what INZ will accept it for. A police
  -- certificate has a country instead — you need one from everywhere you have
  -- lived twelve months or more, so a client commonly holds several at once.
  subtype     TEXT,
  country     TEXT,
  reference   TEXT,
  issued_on   TEXT,
  expires_on  TEXT,
  notes       TEXT,
  created_at  TEXT NOT NULL,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_client_certificates_client ON client_certificates (client_id, kind, issued_on DESC);
CREATE INDEX idx_client_certificates_expiry ON client_certificates (expires_on);

-- What kind of medical it was, cached on the client like the dates are.
ALTER TABLE clients ADD COLUMN medical_certificate_type TEXT;

-- Carry across what is already held, so nothing is lost and the history starts
-- with what the practice knows rather than empty.
INSERT INTO client_certificates (id, client_id, kind, country, issued_on, expires_on, created_at)
  SELECT 'crt_pol_' || id, id, 'police', police_certificate_country,
         police_certificate_date, police_certificate_expiry, datetime('now')
    FROM clients
   WHERE police_certificate_date IS NOT NULL OR police_certificate_expiry IS NOT NULL
      OR police_certificate_country IS NOT NULL;

INSERT INTO client_certificates (id, client_id, kind, issued_on, expires_on, created_at)
  SELECT 'crt_med_' || id, id, 'medical', medical_certificate_date, medical_certificate_expiry, datetime('now')
    FROM clients
   WHERE medical_certificate_date IS NOT NULL OR medical_certificate_expiry IS NOT NULL;

INSERT INTO client_certificates (id, client_id, kind, expires_on, created_at)
  SELECT 'crt_xr_' || id, id, 'chest_xray', chest_xray_expiry, datetime('now')
    FROM clients
   WHERE chest_xray_expiry IS NOT NULL;
