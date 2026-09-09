import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export type User = {
  id: string;
  email: string;
  password: string | null;
  google_sub: string | null;
};
export class Store {
  db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:")
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password TEXT, google_sub TEXT UNIQUE);
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS oauth (state TEXT PRIMARY KEY, browser TEXT NOT NULL, nonce TEXT NOT NULL, verifier TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS session_expiry ON sessions(expires);`);
  }
  byEmail(email: string) {
    return this.db.prepare("SELECT * FROM users WHERE email=?").get(email) as
      User | undefined;
  }
  byGoogle(sub: string) {
    return this.db
      .prepare("SELECT * FROM users WHERE google_sub=?")
      .get(sub) as User | undefined;
  }
  createUser(
    email: string,
    password: string | null,
    sub: string | null = null,
  ) {
    const user: User = { id: randomUUID(), email, password, google_sub: sub };
    this.db
      .prepare("INSERT INTO users VALUES (?,?,?,?)")
      .run(user.id, email, password, sub);
    return user;
  }
  session(id: string, userId: string, expires: number) {
    this.db
      .prepare("INSERT INTO sessions VALUES (?,?,?)")
      .run(id, userId, expires);
  }
  sessionUser(id: string, userId: string, now: number) {
    return this.db
      .prepare(
        "SELECT u.* FROM users u JOIN sessions s ON u.id=s.user_id WHERE s.id=? AND u.id=? AND s.expires>?",
      )
      .get(id, userId, now) as User | undefined;
  }
  revoke(id: string) {
    this.db.prepare("DELETE FROM sessions WHERE id=?").run(id);
  }
  saveOAuth(state: string, browser: string, nonce: string, verifier: string) {
    this.prune();
    this.db
      .prepare("INSERT INTO oauth VALUES (?,?,?,?,?)")
      .run(state, browser, nonce, verifier, Date.now() + 600000);
  }
  takeOAuth(state: string, browser: string) {
    return this.db
      .prepare(
        "DELETE FROM oauth WHERE state=? AND browser=? AND expires>? RETURNING nonce,verifier",
      )
      .get(state, browser, Date.now()) as
      { nonce: string; verifier: string } | undefined;
  }
  prune() {
    this.db.prepare("DELETE FROM sessions WHERE expires<=?").run(Date.now());
    this.db.prepare("DELETE FROM oauth WHERE expires<=?").run(Date.now());
  }
  close() {
    this.db.close();
  }
}
