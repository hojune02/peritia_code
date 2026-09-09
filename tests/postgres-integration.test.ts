import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { ExplanationService, failExplanation, processExplanation } from "../server/explanations";
import { getConfig } from "../server/config";
import { RepositoryLibrary } from "../server/repositories";
import type { Guide } from "../lib/repository";

test("one remaining credit accepts only one of ten concurrent jobs", async (t) => {
  if (!process.env.DATABASE_URL) return t.skip("DATABASE_URL is not configured");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 12 });
  const modelRevision = `integration-${randomUUID()}`;
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
    AI_PROVIDER: "gemini",
    GEMINI_API_KEY: "integration-test-key",
    GEMINI_MODEL: "gemini-3.5-flash-lite",
    GEMINI_BILLING_TIER: "free",
    AI_MODEL_REVISION: modelRevision,
  });
  const service = new ExplanationService(pool, config);
  const input = { repositoryId: "sample", commit: "sample", path: "src/App.tsx", scope: "file", level: "beginner" } as const;
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

  const output = "Line 1: Imports a task hook.\n\nLines 2–4: Defines the component's initial setup.";
  const records = [
    { candidates: [{ content: { parts: [{ text: output.slice(0, 19) }] } }] },
    {
      candidates: [{ content: { parts: [{ text: output.slice(19) }] }, finishReason: "STOP" }],
      modelVersion: "gemini-3.5-flash-lite-001",
      usageMetadata: { promptTokenCount: 2000, candidatesTokenCount: 400, totalTokenCount: 2400 },
    },
  ].map((record) => `data: ${JSON.stringify(record)}\n\n`).join("");
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
  const completed = await service.get(userId, acceptedResult.value.job.id);
  assert.equal(completed.status, "completed");
  assert.match(completed.result?.rawText ?? "", /^## Lines 1–\d+/);
  assert.match(completed.result?.rawText ?? "", new RegExp(output.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(completed.result?.startLine, 1);
  assert.equal(completed.result?.endLine, completed.result?.totalLines);
  const metric = await pool.query(`SELECT * FROM ai_generation_usage WHERE job_id=$1`, [acceptedResult.value.job.id]);
  assert.equal(metric.rows.length, 1);
  assert.equal(metric.rows[0].provider, "gemini");
  assert.equal(metric.rows[0].model_version, "gemini-3.5-flash-lite-001");
  assert(Number(metric.rows[0].input_tokens) >= 2000);
  assert(Number(metric.rows[0].output_tokens) >= 400);
  assert(Number(metric.rows[0].estimated_list_cost_usd) >= 0.00036);
  assert.equal(Number(metric.rows[0].estimated_billed_cost_usd), 0);

  await pool.query(
    `INSERT INTO usage_buckets(id,user_id,period_key,allowance) VALUES($1,$2,'paid:test',100)`,
    [randomUUID(), userId],
  );
  await assert.rejects(
    service.submit(userId, randomUUID(), {
      repositoryId: "sample", commit: "sample", path: "server/data.ts", page: 0, level: "technical",
    }),
    (error: any) => error?.code === "QUOTA_EXHAUSTED",
  );
});

test("terminal worker failure releases a reserved credit", async (t) => {
  if (!process.env.DATABASE_URL) return t.skip("DATABASE_URL is not configured");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const userId = randomUUID();
  await pool.query(`INSERT INTO users(id,email,google_sub) VALUES($1,$2,$3)`, [userId, `${userId}@example.test`, `test-${userId}`]);
  t.after(async () => { await pool.query(`DELETE FROM users WHERE id=$1`, [userId]); await pool.end(); });
  const config = getConfig({
    APP_ORIGIN: "http://localhost:5173",
    JWT_SECRET: randomBytes(32).toString("hex"),
    AI_MODEL_REVISION: `integration-${randomUUID()}`,
  });
  const service = new ExplanationService(pool, config);
  const submitted = await service.submit(userId, randomUUID(), { repositoryId: "sample", commit: "sample", path: "server/data.ts", page: 0, level: "technical" });
  await failExplanation(pool, submitted.job.id, "OLLAMA_REQUEST_FAILED");
  const usage = await service.usage(userId);
  assert.deepEqual({ reserved: usage.reserved, consumed: usage.consumed, remaining: usage.remaining }, { reserved: 0, consumed: 0, remaining: 3 });
  assert.equal((await service.get(userId, submitted.job.id)).status, "failed");
});

test("saved repositories and reviewed files are isolated by user", async (t) => {
  if (!process.env.DATABASE_URL) return t.skip("DATABASE_URL is not configured");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  const firstUser = randomUUID();
  const secondUser = randomUUID();
  const firstRepository = `test-${randomUUID()}`;
  const secondRepository = `test-${randomUUID()}`;
  const firstCommit = "a".repeat(40);
  const secondCommit = "b".repeat(40);
  const previousCacheMode = process.env.GITHUB_CACHE_MODE;
  process.env.GITHUB_CACHE_MODE = "postgres";
  t.after(async () => {
    if (previousCacheMode === undefined) delete process.env.GITHUB_CACHE_MODE;
    else process.env.GITHUB_CACHE_MODE = previousCacheMode;
    await pool.query(`DELETE FROM users WHERE id IN ($1,$2)`, [firstUser, secondUser]);
    await pool.query(`DELETE FROM repo_snapshots WHERE repository_id IN ($1,$2)`, [firstRepository, secondRepository]);
    await pool.end();
  });
  await pool.query(
    `INSERT INTO users(id,email,password) VALUES($1,$2,'hash'),($3,$4,'hash')`,
    [firstUser, `${firstUser}@example.test`, secondUser, `${secondUser}@example.test`],
  );
  const tree = { tree: [{ path: "src/main.ts", type: "blob", sha: "c".repeat(40), size: 20 }] };
  await pool.query(
    `INSERT INTO repo_snapshots
       (repository_id,owner,name,commit_sha,default_branch,tree_json,metadata_json)
     VALUES
       ($1,'alice','one',$2,'main',$3,$4),
       ($5,'bob','two',$6,'main',$3,$7)`,
    [
      firstRepository, firstCommit, tree, { description: "First", stargazers_count: 3 },
      secondRepository, secondCommit, { description: "Second", stargazers_count: 7 },
    ],
  );
  const library = new RepositoryLibrary(pool);
  const guide = (owner: string, name: string, commit: string) => ({ owner, name, commit } as Guide);
  await library.save(firstUser, guide("alice", "one", firstCommit));
  await library.save(secondUser, guide("bob", "two", secondCommit));
  assert.deepEqual((await library.list(firstUser)).map((item) => item.name), ["one"]);
  assert.deepEqual((await library.list(secondUser)).map((item) => item.name), ["two"]);
  await assert.rejects(library.open(secondUser, firstRepository), (error: any) => error?.status === 404);

  await library.setReviewed(firstUser, {
    repo: "https://github.com/alice/one",
    commit: firstCommit,
    path: "src/main.ts",
    reviewed: true,
  });
  const restored = await library.open(firstUser, firstRepository);
  assert.equal(restored.guide.name, "one");
  assert.deepEqual(restored.reviewedPaths, ["src/main.ts"]);
  assert.deepEqual((await library.open(secondUser, secondRepository)).reviewedPaths, []);
});
