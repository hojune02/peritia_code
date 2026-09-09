CREATE TABLE worker_health (
  worker_name TEXT PRIMARY KEY,
  heartbeat_at TIMESTAMPTZ NOT NULL,
  model TEXT NOT NULL
);
