CREATE TABLE explanation_jobs (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key UUID NOT NULL,
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  cache_key TEXT NOT NULL CHECK (cache_key ~ '^[0-9a-f]{64}$'),
  request_json JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  partial_text TEXT NOT NULL DEFAULT '',
  result_json JSONB,
  error_code TEXT,
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  heartbeat_at TIMESTAMPTZ,
  UNIQUE (user_id, idempotency_key)
);

CREATE INDEX explanation_jobs_owner_created_idx
  ON explanation_jobs(user_id, created_at DESC);

CREATE TABLE ai_cache (
  cache_key TEXT PRIMARY KEY CHECK (cache_key ~ '^[0-9a-f]{64}$'),
  result_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE user_explanations (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cache_key TEXT NOT NULL REFERENCES ai_cache(cache_key) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES explanation_jobs(id) ON DELETE CASCADE,
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, cache_key)
);

CREATE TABLE job_outbox (
  job_id UUID PRIMARY KEY REFERENCES explanation_jobs(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dispatched_at TIMESTAMPTZ
);

CREATE INDEX job_outbox_pending_idx
  ON job_outbox(created_at) WHERE dispatched_at IS NULL;

CREATE TABLE usage_buckets (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_key TEXT NOT NULL,
  allowance INTEGER NOT NULL CHECK (allowance >= 0),
  reserved INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  consumed INTEGER NOT NULL DEFAULT 0 CHECK (consumed >= 0),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  UNIQUE (user_id, period_key),
  CHECK (reserved + consumed <= allowance)
);

CREATE INDEX usage_buckets_available_idx
  ON usage_buckets(user_id, starts_at, expires_at);

CREATE TABLE usage_reservations (
  id UUID PRIMARY KEY,
  job_id UUID NOT NULL UNIQUE REFERENCES explanation_jobs(id) ON DELETE CASCADE,
  bucket_id UUID NOT NULL REFERENCES usage_buckets(id),
  status TEXT NOT NULL CHECK (status IN ('reserved', 'settled', 'released')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at TIMESTAMPTZ
);

CREATE TABLE billing_subscriptions (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  provider_subscription_id TEXT NOT NULL UNIQUE,
  provider_customer_id TEXT,
  variant_id TEXT NOT NULL,
  status TEXT NOT NULL,
  test_mode BOOLEAN NOT NULL,
  portal_url TEXT,
  paid_through TIMESTAMPTZ,
  provider_updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE billing_events (
  payload_hash TEXT PRIMARY KEY CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  event_name TEXT NOT NULL,
  resource_id TEXT,
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  error_code TEXT
);

CREATE TABLE github_installations (
  installation_id BIGINT PRIMARY KEY,
  github_account_id BIGINT NOT NULL,
  account_login TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE user_github_installations (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  installation_id BIGINT NOT NULL REFERENCES github_installations(installation_id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, installation_id)
);
