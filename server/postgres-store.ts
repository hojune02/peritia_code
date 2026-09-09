import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { db } from "./db";
import type {
  AuthStore,
  OAuthTransaction,
  User,
} from "./auth-store";

export class PostgresStore implements AuthStore {
  constructor(private readonly pool: Pool = db) {}

  async byEmail(email: string): Promise<User | undefined> {
    const result = await this.pool.query<User>(
      `
        SELECT
          id,
          email,
          password,
          google_sub
        FROM users
        WHERE email = $1
        LIMIT 1
      `,
      [email],
    );

    return result.rows[0];
  }

  async byGoogle(sub: string): Promise<User | undefined> {
    const result = await this.pool.query<User>(
      `
        SELECT
          id,
          email,
          password,
          google_sub
        FROM users
        WHERE google_sub = $1
        LIMIT 1
      `,
      [sub],
    );

    return result.rows[0];
  }

  async createUser(
    email: string,
    password: string | null,
    sub: string | null = null,
  ): Promise<User> {
    const user: User = {
      id: randomUUID(),
      email,
      password,
      google_sub: sub,
    };

    const result = await this.pool.query<User>(
      `
        INSERT INTO users (
          id,
          email,
          password,
          google_sub
        )
        VALUES ($1, $2, $3, $4)
        RETURNING
          id,
          email,
          password,
          google_sub
      `,
      [
        user.id,
        user.email,
        user.password,
        user.google_sub,
      ],
    );

    return result.rows[0];
  }

  async session(
    id: string,
    userId: string,
    expires: number,
  ): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO sessions (
          id,
          user_id,
          expires_at
        )
        VALUES ($1, $2, $3)
      `,
      [id, userId, new Date(expires)],
    );
  }

  async sessionUser(
    id: string,
    userId: string,
    now: number,
  ): Promise<User | undefined> {
    const result = await this.pool.query<User>(
      `
        SELECT
          users.id,
          users.email,
          users.password,
          users.google_sub
        FROM users
        INNER JOIN sessions
          ON sessions.user_id = users.id
        WHERE sessions.id = $1
          AND users.id = $2
          AND sessions.expires_at > $3
        LIMIT 1
      `,
      [id, userId, new Date(now)],
    );

    return result.rows[0];
  }

  async revoke(id: string): Promise<void> {
    await this.pool.query(
      `
        DELETE FROM sessions
        WHERE id = $1
      `,
      [id],
    );
  }

  async saveOAuth(
    state: string,
    browser: string,
    nonce: string,
    verifier: string,
  ): Promise<void> {
    await this.prune();

    await this.pool.query(
      `
        INSERT INTO oauth (
          state,
          browser,
          nonce,
          verifier,
          expires_at
        )
        VALUES ($1, $2, $3, $4, $5)
      `,
      [
        state,
        browser,
        nonce,
        verifier,
        new Date(Date.now() + 600_000),
      ],
    );
  }

  async takeOAuth(
    state: string,
    browser: string,
  ): Promise<OAuthTransaction | undefined> {
    const result = await this.pool.query<OAuthTransaction>(
      `
        DELETE FROM oauth
        WHERE state = $1
          AND browser = $2
          AND expires_at > $3
        RETURNING
          nonce,
          verifier
      `,
      [state, browser, new Date()],
    );

    return result.rows[0];
  }

  async prune(): Promise<void> {
    const now = new Date();

    await Promise.all([
      this.pool.query(
        `
          DELETE FROM sessions
          WHERE expires_at <= $1
        `,
        [now],
      ),
      this.pool.query(
        `
          DELETE FROM oauth
          WHERE expires_at <= $1
        `,
        [now],
      ),
    ]);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}