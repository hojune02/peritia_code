import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
});

const migrationsDirectory = path.resolve("migrations");

async function main() {
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const files = (await fs.readdir(migrationsDirectory))
      .filter((filename) => filename.endsWith(".sql"))
      .sort();

    for (const filename of files) {
      const existing = await client.query(
        `
          SELECT filename
          FROM schema_migrations
          WHERE filename = $1
        `,
        [filename],
      );

      if (existing.rowCount !== 0) {
        console.log(`Already applied: ${filename}`);
        continue;
      }

      const sql = await fs.readFile(
        path.join(migrationsDirectory, filename),
        "utf8",
      );

      console.log(`Applying: ${filename}`);

      await client.query("BEGIN");

      try {
        await client.query(sql);

        await client.query(
          `
            INSERT INTO schema_migrations (filename)
            VALUES ($1)
          `,
          [filename],
        );

        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    console.log("PostgreSQL migrations completed.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Migration failed:", error);
  process.exitCode = 1;
});