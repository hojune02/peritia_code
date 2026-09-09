import { Worker } from "bullmq";
import IORedis from "ioredis";
import { getConfig } from "./config";
import { db } from "./db";
import { failExplanation, processExplanation } from "./explanations";

if (!process.env.REDIS_URL) throw new Error("REDIS_URL is required");
const config = getConfig();
const connection = new IORedis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
});
const worker = new Worker(
  "explanations",
  async (job) => processExplanation(db, config, job.data.jobId),
  { connection, concurrency: Number(process.env.AI_WORKER_CONCURRENCY ?? 1) },
);
const heartbeat = async () => {
  await db.query(
    `INSERT INTO worker_health(worker_name,heartbeat_at,model)
     VALUES('explanations',NOW(),$1)
     ON CONFLICT(worker_name) DO UPDATE SET heartbeat_at=NOW(),model=EXCLUDED.model`,
    [config.model],
  );
};
const heartbeatTimer = setInterval(() => void heartbeat().catch((error) => console.error("Worker heartbeat failed:", error)), 10_000);
heartbeatTimer.unref();
void heartbeat();

worker.on("failed", (job, error) => {
  if (job && job.attemptsMade >= (job.opts.attempts ?? 1))
    void failExplanation(db, job.data.jobId, error.message || "GENERATION_FAILED");
});

async function shutdown() {
  clearInterval(heartbeatTimer);
  await worker.close();
  await connection.quit();
  await db.end();
}
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
