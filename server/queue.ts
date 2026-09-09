import { Queue } from "bullmq";
import IORedis from "ioredis";
import type { Pool } from "pg";

export function createQueue(redisUrl = process.env.REDIS_URL) {
  if (!redisUrl) throw new Error("REDIS_URL is required");
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: 1 });
  const queue = new Queue("explanations", { connection });
  return { connection, queue };
}

export function startOutboxDispatcher(pool: Pool, queue: Queue) {
  let stopped = false;
  let active = false;
  const dispatch = async () => {
    if (stopped || active) return;
    active = true;
    try {
      const pending = await pool.query(
        `SELECT job_id FROM job_outbox WHERE dispatched_at IS NULL ORDER BY created_at LIMIT 25`,
      );
      for (const { job_id: jobId } of pending.rows) {
        await queue.add("explain", { jobId }, {
          jobId,
          attempts: 2,
          backoff: { type: "exponential", delay: 2_000 },
          removeOnComplete: 100,
          removeOnFail: 500,
        });
        await pool.query(
          `UPDATE job_outbox SET dispatched_at=NOW() WHERE job_id=$1 AND dispatched_at IS NULL`,
          [jobId],
        );
      }
    } catch (error) {
      console.error("Explanation outbox dispatch failed:", error);
    } finally {
      active = false;
    }
  };
  const timer = setInterval(() => void dispatch(), 1_000);
  timer.unref();
  void dispatch();
  return () => { stopped = true; clearInterval(timer); };
}
