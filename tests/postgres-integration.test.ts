import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { ExplanationService, failExplanation, processExplanation } from "../server/explanations";
import { getConfig } from "../server/config";

test("one remaining credit accepts only one of ten concurrent jobs", async (t) => {
  if (!process.env.DATABASE_URL) return t.skip("DATABASE_URL is not configured");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 12 });
  const previousDigest = process.env.OLLAMA_MODEL_DIGEST;
  process.env.OLLAMA_MODEL_DIGEST = `integration-${randomUUID()}`;
  t.after(() => { if (previousDigest === undefined) delete process.env.OLLAMA_MODEL_DIGEST; else process.env.OLLAMA_MODEL_DIGEST = previousDigest; });
  const userId = randomUUID();
  await pool.query(`INSERT INTO users(id,email,google_sub) VALUES($1,$2,$3)`, [userId, `${userId}@example.test`, `test-${userId}`]);
  t.after(async () => { await pool.query(`DELETE FROM users WHERE id=$1`, [userId]); await pool.end(); });
  await pool.query(
    `INSERT INTO usage_buckets(id,user_id,period_key,allowance) VALUES($1,$2,'trial',1)`,
    [randomUUID(), userId],
  );
  const config = getConfig({
    APP_ORIGIN: "http://localhost:5173",
    JWT_SECRET: randomBytes(32).toString("hex"),
  });
  const service = new ExplanationService(pool, config);
  const input = { repositoryId: "sample", commit: "sample", path: "src/App.tsx", page: 0, level: "beginner" } as const;
  const keys = Array.from({ length: 10 }, () => randomUUID());
  const results = await Promise.allSettled(keys.map((key) => service.submit(userId, key, input)));
  const accepted = results.filter((result) => result.status === "fulfilled");
  assert.equal(accepted.length, 1);
  const acceptedIndex = results.findIndex((result) => result.status === "fulfilled");
  const acceptedResult = results[acceptedIndex] as PromiseFulfilledResult<Awaited<ReturnType<typeof service.submit>>>;
  const first = await service.submit(userId, keys[acceptedIndex], input);
  assert.equal(first.created, false);
  const usage = await service.usage(userId);
  assert.deepEqual({ reserved: usage.reserved, consumed: usage.consumed, remaining: usage.remaining }, { reserved: 1, consumed: 0, remaining: 0 });

  const output = JSON.stringify({
    claims: [{ text: "Imports a task hook.", kind: "observation", startLine: 1, endLine: 1 }],
    limitations: ["Only this file section was supplied."],
  });
  const records = [
    JSON.stringify({ message: { content: output.slice(0, 19) }, done: false }),
    JSON.stringify({ message: { content: output.slice(19) }, done: false }),
    JSON.stringify({ message: { content: "" }, done: true }),
  ].join("\n") + "\n";
  const bytes = new TextEncoder().encode(records);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.slice(0, 17));
      controller.enqueue(bytes.slice(17, 61));
      controller.enqueue(bytes.slice(61));
      controller.close();
    },
  }));
  try {
    await processExplanation(pool, config, acceptedResult.value.job.id);
  } finally { globalThis.fetch = originalFetch; }
  const settled = await service.usage(userId);
  assert.deepEqual({ reserved: settled.reserved, consumed: settled.consumed }, { reserved: 0, consumed: 1 });
  assert.equal((await service.get(userId, acceptedResult.value.job.id)).status, "completed");
});

test("terminal worker failure releases a reserved credit", async (t) => {
  if (!process.env.DATABASE_URL) return t.skip("DATABASE_URL is not configured");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const previousDigest = process.env.OLLAMA_MODEL_DIGEST;
  process.env.OLLAMA_MODEL_DIGEST = `integration-${randomUUID()}`;
  t.after(() => { if (previousDigest === undefined) delete process.env.OLLAMA_MODEL_DIGEST; else process.env.OLLAMA_MODEL_DIGEST = previousDigest; });
  const userId = randomUUID();
  await pool.query(`INSERT INTO users(id,email,google_sub) VALUES($1,$2,$3)`, [userId, `${userId}@example.test`, `test-${userId}`]);
  t.after(async () => { await pool.query(`DELETE FROM users WHERE id=$1`, [userId]); await pool.end(); });
  const config = getConfig({ APP_ORIGIN: "http://localhost:5173", JWT_SECRET: randomBytes(32).toString("hex") });
  const service = new ExplanationService(pool, config);
  const submitted = await service.submit(userId, randomUUID(), { repositoryId: "sample", commit: "sample", path: "server/data.ts", page: 0, level: "technical" });
  await failExplanation(pool, submitted.job.id, "OLLAMA_REQUEST_FAILED");
  const usage = await service.usage(userId);
  assert.deepEqual({ reserved: usage.reserved, consumed: usage.consumed, remaining: usage.remaining }, { reserved: 0, consumed: 0, remaining: 3 });
  assert.equal((await service.get(userId, submitted.job.id)).status, "failed");
});
