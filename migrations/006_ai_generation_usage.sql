CREATE TABLE ai_generation_usage (
  id UUID PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES explanation_jobs(id) ON DELETE CASCADE,
  attempt INTEGER NOT NULL CHECK (attempt > 0),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  model_version TEXT,
  billing_tier TEXT NOT NULL CHECK (billing_tier IN ('free', 'paid', 'local')),
  input_tokens INTEGER CHECK (input_tokens >= 0),
  output_tokens INTEGER CHECK (output_tokens >= 0),
  thought_tokens INTEGER CHECK (thought_tokens >= 0),
  total_tokens INTEGER CHECK (total_tokens >= 0),
  latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
  estimated_list_cost_usd NUMERIC(14, 8),
  estimated_billed_cost_usd NUMERIC(14, 8),
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id, attempt)
);

CREATE INDEX ai_generation_usage_created_idx
  ON ai_generation_usage(created_at DESC);
