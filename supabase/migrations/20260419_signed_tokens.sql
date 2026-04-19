-- Signed tokens pentru link-urile de confirm / reschedule / cancel din email-urile
-- de reminder, plus rate limiting per IP pentru save-booking.
--
-- Coloanele token sunt nullable: se populează abia la prima trimitere de reminder
-- (send-reminders regenerează tokens la fiecare trimitere). Zero impact pe flow-ul
-- existent; rollback = DROP COLUMN.

-- 1) Token hashes + metadata pe programari
ALTER TABLE programari
  ADD COLUMN IF NOT EXISTS confirm_token_hash       TEXT,
  ADD COLUMN IF NOT EXISTS reschedule_token_hash    TEXT,
  ADD COLUMN IF NOT EXISTS cancel_token_hash        TEXT,
  ADD COLUMN IF NOT EXISTS tokens_expire_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirm_token_used_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancel_token_used_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmed_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmed_via            TEXT
    CHECK (confirmed_via IS NULL OR confirmed_via IN ('email_link','whatsapp','sms','manual','voice_bot'));

-- 2) Indexuri parțiale pentru lookup rapid după hash (doar rânduri cu token activ)
CREATE INDEX IF NOT EXISTS idx_programari_confirm_token_hash
  ON programari (confirm_token_hash)
  WHERE confirm_token_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_programari_reschedule_token_hash
  ON programari (reschedule_token_hash)
  WHERE reschedule_token_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_programari_cancel_token_hash
  ON programari (cancel_token_hash)
  WHERE cancel_token_hash IS NOT NULL;

-- 3) Rate limiting per IP pentru save-booking (5 programări noi / oră)
CREATE TABLE IF NOT EXISTS rate_limit_booking (
  ip_hash       TEXT        PRIMARY KEY,
  count         INTEGER     NOT NULL DEFAULT 1,
  window_start  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_window
  ON rate_limit_booking (window_start);

ALTER TABLE rate_limit_booking ENABLE ROW LEVEL SECURITY;
-- Fără politici publice — accesat doar de service_role via RPC-ul de mai jos.

-- 4) UPSERT atomic cu fereastră glisantă de 1h. Resetează count-ul când fereastra
--    expiră. Returnează count-ul NOU (inclusiv incrementul curent).
CREATE OR REPLACE FUNCTION increment_rate_limit(p_ip_hash TEXT)
RETURNS TABLE(count INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_count INTEGER;
BEGIN
  INSERT INTO rate_limit_booking (ip_hash, count, window_start)
  VALUES (p_ip_hash, 1, NOW())
  ON CONFLICT (ip_hash) DO UPDATE SET
    count = CASE
      WHEN rate_limit_booking.window_start < NOW() - INTERVAL '1 hour' THEN 1
      ELSE rate_limit_booking.count + 1
    END,
    window_start = CASE
      WHEN rate_limit_booking.window_start < NOW() - INTERVAL '1 hour' THEN NOW()
      ELSE rate_limit_booking.window_start
    END
  RETURNING rate_limit_booking.count INTO new_count;

  RETURN QUERY SELECT new_count;
END;
$$;

REVOKE ALL       ON FUNCTION increment_rate_limit(TEXT) FROM PUBLIC;
GRANT  EXECUTE   ON FUNCTION increment_rate_limit(TEXT) TO   service_role;
