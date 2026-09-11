ALTER TABLE billing_events
  ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0);

CREATE INDEX billing_events_pending_idx
  ON billing_events(received_at)
  WHERE processed_at IS NULL;
