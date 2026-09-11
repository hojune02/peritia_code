CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password TEXT,
  google_sub TEXT UNIQUE
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL
    REFERENCES users(id)
    ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE oauth (
  state TEXT PRIMARY KEY,
  browser TEXT NOT NULL,
  nonce TEXT NOT NULL,
  verifier TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX sessions_expires_at_idx
  ON sessions(expires_at);

CREATE INDEX oauth_expires_at_idx
  ON oauth(expires_at);