import { randomUUID } from "node:crypto";
import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const emails = process.argv.slice(2);
if (!emails.length) throw new Error("Pass one or more existing staging account emails.");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  for (const email of emails) {
    const user = await pool.query("SELECT id FROM users WHERE email=$1", [email.toLowerCase()]);
    if (!user.rows[0]) throw new Error(`Account not found: ${email}`);
    await pool.query(
      `INSERT INTO usage_buckets(id,user_id,period_key,allowance,expires_at)
       VALUES($1,$2,$3,10,NOW()+INTERVAL '14 days') ON CONFLICT(user_id,period_key) DO NOTHING`,
      [randomUUID(), user.rows[0].id, `staging:${new Date().toISOString().slice(0, 10)}`],
    );
    console.log(`Granted staging credits to ${email}`);
  }
} finally { await pool.end(); }
