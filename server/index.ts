import express from "express";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createApp } from "./app";
import { getConfig } from "./config";
import { Store } from "./store";

const config = getConfig();
const store = new Store(config.database);
const app = createApp(config, store);

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
      store.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  });
}
