CREATE TABLE user_repositories (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  repository_id TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  file_count INTEGER NOT NULL CHECK (file_count >= 0 AND file_count <= 2500),
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (user_id, repository_id),

  CONSTRAINT user_repositories_snapshot_fk
    FOREIGN KEY (repository_id, commit_sha)
    REFERENCES repo_snapshots(repository_id, commit_sha)
    ON DELETE CASCADE
);

CREATE INDEX user_repositories_recent_idx
  ON user_repositories(user_id, last_opened_at DESC);

CREATE TABLE user_reviewed_files (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  repository_id TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  path TEXT NOT NULL,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (user_id, repository_id, commit_sha, path),

  CONSTRAINT user_reviewed_files_repository_fk
    FOREIGN KEY (user_id, repository_id)
    REFERENCES user_repositories(user_id, repository_id)
    ON DELETE CASCADE,

  CONSTRAINT user_reviewed_files_snapshot_fk
    FOREIGN KEY (repository_id, commit_sha)
    REFERENCES repo_snapshots(repository_id, commit_sha)
    ON DELETE CASCADE
);
