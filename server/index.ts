import express from "express";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createApp } from "./app";
import { getConfig } from "./config";
import { PostgresStore } from "./postgres-store"
import { db } from "./db";
import { ExplanationService } from "./explanations";
import { BillingService, billingOptions } from "./billing";
import { createQueue, startOutboxDispatcher } from "./queue";
import { RepositoryLibrary } from "./repositories";

const config = getConfig();
const store = new PostgresStore();
const explanations = new ExplanationService(db, config);
const repositories = new RepositoryLibrary(db);
const billing = config.billingEnabled
  ? new BillingService(db, billingOptions())
  : undefined;
const stopBillingProcessor = billing?.startProcessor() || (() => undefined);
const queueResources = createQueue();
const stopDispatcher = startOutboxDispatcher(db, queueResources.queue);
const ready = async () => {
  await Promise.all([
    db.query("SELECT 1"),
    queueResources.connection.ping(),
    db.query(
      `SELECT 1 FROM worker_health
       WHERE worker_name='explanations' AND heartbeat_at > NOW() - INTERVAL '30 seconds'`,
    ).then((result) => { if (!result.rows[0]) throw new Error("WORKER_NOT_READY"); }),
  ]);
};
const app = createApp(config, store, { explanations, billing, repositories, ready });

// One origin for both the React frontend and Express API.
if (process.env.NODE_ENV !== "development") {
  const client = resolve(process.cwd(), "dist/client");
  if (!existsSync(resolve(client, "index.html"))) {
    throw new Error(
      "Frontend build missing. Run npm run build before npm start.",
    );
  }
  app.use(express.static(client));
  app.get("/{*path}", (_req, res) => {
    res.sendFile(resolve(client, "index.html"));
  });
}

const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Invalid PORT.");
const server = app.listen(port, "0.0.0.0", () => {
  console.log(`Peritia listening on http://localhost:${port}`);
});
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    server.close(() => {
      stopDispatcher();
      stopBillingProcessor();
      void Promise.all([
        queueResources.queue.close(),
        queueResources.connection.quit(),
        store.close(),
      ]).finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10000).unref();
  });
}
