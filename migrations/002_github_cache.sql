CREATE TABLE repo_snapshots (
  repository_id TEXT NOT NULL,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  default_branch TEXT NOT NULL,
  tree_json JSONB NOT NULL,
  metadata_json JSONB NOT NULL,
  tree_truncated BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (repository_id, commit_sha),

  CONSTRAINT repo_snapshots_commit_sha_format
    CHECK (commit_sha ~ '^[0-9a-f]{40}$')
);

CREATE UNIQUE INDEX repo_snapshots_coordinates_idx
  ON repo_snapshots (
    LOWER(owner),
    LOWER(name),
    commit_sha
  );

CREATE INDEX repo_snapshots_last_accessed_idx
  ON repo_snapshots(last_accessed_at);

CREATE TABLE source_files (
  repository_id TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  path TEXT NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (
    repository_id,
    commit_sha,
    path
  ),

  CONSTRAINT source_files_snapshot_fk
    FOREIGN KEY (repository_id, commit_sha)
    REFERENCES repo_snapshots(
      repository_id,
      commit_sha
    )
    ON DELETE CASCADE,

  CONSTRAINT source_files_hash_format
    CHECK (content_hash ~ '^[0-9a-f]{64}$'),

  CONSTRAINT source_files_content_size
    CHECK (
      OCTET_LENGTH(content) <= 262144
    )
);

CREATE INDEX source_files_last_accessed_idx
  ON source_files(last_accessed_at);