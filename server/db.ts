import { Pool, type PoolClient } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

export const db = new Pool({
  connectionString: databaseUrl,
  max: 5,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
});

db.on("error", (error) => {
  console.error("Unexpected PostgreSQL pool error:", error);
});

export async function transaction<T>(
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await db.connect();

  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}