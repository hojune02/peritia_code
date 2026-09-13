CREATE TABLE workflow_indexes (
  id UUID PRIMARY KEY,
  repository_id TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  analyzer_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  files_total INTEGER NOT NULL DEFAULT 0 CHECK (files_total >= 0),
  files_processed INTEGER NOT NULL DEFAULT 0 CHECK (files_processed >= 0),
  result_json JSONB,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  heartbeat_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,

  UNIQUE (repository_id, commit_sha, analyzer_version),
  FOREIGN KEY (repository_id, commit_sha)
    REFERENCES repo_snapshots(repository_id, commit_sha)
    ON DELETE CASCADE
);

CREATE INDEX workflow_indexes_status_idx
  ON workflow_indexes(status, created_at);

-- Git blob SHA is stable across paths, branches, repositories, and commits.
-- Keeping only extracted symbols/calls here makes subsequent indexes incremental
-- without retaining another copy of source text.
CREATE TABLE workflow_file_indexes (
  blob_sha TEXT NOT NULL,
  language TEXT NOT NULL,
  analyzer_version TEXT NOT NULL,
  result_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (blob_sha, language, analyzer_version),
  CHECK (blob_sha ~ '^[0-9a-f]{40}$')
);

CREATE TABLE workflow_job_outbox (
  id BIGSERIAL PRIMARY KEY,
  workflow_index_id UUID NOT NULL REFERENCES workflow_indexes(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dispatched_at TIMESTAMPTZ
);

CREATE INDEX workflow_job_outbox_pending_idx
  ON workflow_job_outbox(created_at)
  WHERE dispatched_at IS NULL;
