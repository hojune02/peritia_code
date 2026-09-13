import { Queue } from "bullmq";
import IORedis from "ioredis";
import type { Pool } from "pg";

export function createQueue(redisUrl = process.env.REDIS_URL) {
  if (!redisUrl) throw new Error("REDIS_URL is required");
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: 1 });
  const queue = new Queue("explanations", { connection });
  const workflowQueue = new Queue("workflows", { connection });
  return { connection, queue, workflowQueue };
}

export function startOutboxDispatcher(pool: Pool, queue: Queue, workflowQueue?: Queue) {
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
      if (workflowQueue) {
        const workflowPending = await pool.query(
          `SELECT id,workflow_index_id FROM workflow_job_outbox
           WHERE dispatched_at IS NULL ORDER BY created_at LIMIT 10`,
        );
        for (const { id, workflow_index_id: workflowIndexId } of workflowPending.rows) {
          await workflowQueue.add("index-workflows", { workflowIndexId }, {
            jobId: `${workflowIndexId}:${id}`,
            attempts: 3,
            backoff: { type: "exponential", delay: 5_000 },
            removeOnComplete: 100,
            removeOnFail: 500,
          });
          await pool.query(
            `UPDATE workflow_job_outbox SET dispatched_at=NOW()
             WHERE id=$1 AND dispatched_at IS NULL`,
            [id],
          );
        }
      }
    } catch (error) {
      console.error("Job outbox dispatch failed:", error);
    } finally {
      active = false;
    }
  };
  const timer = setInterval(() => void dispatch(), 250);
  timer.unref();
  void dispatch();
  return () => { stopped = true; clearInterval(timer); };
}
