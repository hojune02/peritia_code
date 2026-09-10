import express, { type ErrorRequestHandler } from "express";
import { analyzeRepository, readSource } from "./github";
import { RepoError } from "../lib/repository";
import { createAuth, limiter, sameOrigin, verifyGoogleToken } from "./auth";
import { createExplainer } from "./ai";
import type { Config } from "./config";
import type { AuthStore } from "./auth-store";
import type { ExplanationService } from "./explanations";
import type { BillingService } from "./billing";
import type { RepositoryLibrary } from "./repositories";

export type RepositoryEndpoints = Pick<RepositoryLibrary, "save" | "list" | "open" | "remove" | "setReviewed">;

export function createApp(
  config: Config,
  store: AuthStore,
  dependencies: {
    explain?: ReturnType<typeof createExplainer>;
    googleVerify?: typeof verifyGoogleToken;
    explanations?: ExplanationService;
    billing?: BillingService;
    repositories?: RepositoryEndpoints;
    ready?: () => Promise<void>;
  } = {},
) {
  const app = express();
  app.disable("x-powered-by");
  // Leave trust proxy disabled: arbitrary forwarded headers must not bypass throttles.
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    if (config.production)
      res.setHeader("Strict-Transport-Security", "max-age=31536000");
    next();
  });
  if (config.billingEnabled && dependencies.billing) {
    app.post(
      "/api/billing/webhook",
      express.raw({ type: "application/json", limit: "256kb" }),
      dependencies.billing.webhook,
    );
  }
  app.use(express.json({ limit: "4kb" }));
  app.use("/api", sameOrigin(config));
  const auth = createAuth(config, store, dependencies.googleVerify);
  app.use("/api/auth", auth.router);
  if (dependencies.repositories) {
    const repositories = dependencies.repositories;
    app.get("/api/repositories", auth.required, async (_req, res) => {
      res.json({ repositories: await repositories.list(res.locals.user.id) });
    });
    app.get("/api/repositories/:repositoryId", auth.required, async (req, res) => {
      res.json(await repositories.open(res.locals.user.id, req.params.repositoryId));
    });
    app.delete(
      "/api/repositories/:repositoryId",
      auth.required,
      limiter(100, 60 * 60 * 1000, (_req, res) => res.locals.user.id),
      async (req, res) => {
        res.json(await repositories.remove(res.locals.user.id, req.params.repositoryId));
      },
    );
    app.put(
      "/api/repositories/files/reviewed",
      auth.required,
      limiter(500, 60 * 60 * 1000, (_req, res) => res.locals.user.id),
      async (req, res) => {
        res.json(await repositories.setReviewed(res.locals.user.id, req.body || {}));
      },
    );
  }
  const explain = dependencies.explain || createExplainer(config);
  // The synchronous endpoint is a development/test compatibility path. A
  // production API must never run model inference in its request process.
  if ((!config.production && config.aiProvider === "ollama") || dependencies.explain) {
    app.post(
      "/api/explain",
      auth.required,
      limiter(30, 60 * 60 * 1000, (_req, res) => res.locals.user.id),
      async (req, res) => {
        res.json(await explain(req.body || {}));
      },
    );
  }
  if (dependencies.explanations) {
    const jobs = dependencies.explanations;
    app.post(
      "/api/explanations",
      auth.required,
      limiter(30, 60 * 60 * 1000, (_req, res) => res.locals.user.id),
      async (req, res) => {
        const result = await jobs.submit(
          res.locals.user.id,
          req.get("Idempotency-Key") || "",
          req.body || {},
        );
        res.status(result.job.status === "completed" ? 200 : 202).json({
          jobId: result.job.id,
          status: result.job.status,
          result: result.job.result,
        });
      },
    );
    app.get("/api/explanations/:id", auth.required, async (req, res) => {
      res.json(await jobs.get(res.locals.user.id, String(req.params.id)));
    });
    app.get("/api/explanations/:id/events", auth.required, async (req, res) => {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();
      let closed = false;
      let polling = false;
      let previous = "";
      const send = async () => {
        if (closed || polling) return;
        polling = true;
        try {
          const job = await jobs.get(res.locals.user.id, String(req.params.id));
          const snapshot = JSON.stringify({ status: job.status, text: job.partialText, attempt: job.attempt, result: job.result, errorCode: job.errorCode });
          if (snapshot !== previous) {
            const event = job.status === "completed" ? "complete" : job.status === "failed" ? "failed" : "snapshot";
            if (!res.write(`event: ${event}\ndata: ${snapshot}\n\n`)) {
              closed = true;
              clearInterval(timer);
              clearInterval(heartbeat);
              res.end();
              return;
            }
            previous = snapshot;
          }
          if (job.status === "completed" || job.status === "failed") {
            clearInterval(timer);
            clearInterval(heartbeat);
            res.end();
          }
        } catch (error) {
          clearInterval(timer);
          clearInterval(heartbeat);
          res.end();
        } finally { polling = false; }
      };
      const timer = setInterval(() => void send(), 250);
      const heartbeat = setInterval(() => { if (!closed) res.write(": heartbeat\n\n"); }, 15_000);
      req.once("close", () => { closed = true; clearInterval(timer); clearInterval(heartbeat); });
      void send();
    });
    app.get("/api/usage", auth.required, async (_req, res) => {
      res.json(await jobs.usage(res.locals.user.id));
    });
  }
  if (config.billingEnabled && dependencies.billing) {
    app.post(
      "/api/billing/checkout",
      auth.required,
      limiter(10, 60 * 60 * 1000, (_req, res) => res.locals.user.id),
      async (req, res) => {
        const kind = req.body?.kind;
        if (kind !== "subscription" && kind !== "topup")
          throw new RepoError("Choose a subscription or ticket refill.");
        res.json(await dependencies.billing!.checkout(res.locals.user, kind));
      },
    );
    app.get("/api/billing/portal", auth.required, async (_req, res) => {
      res.json(await dependencies.billing!.portal(res.locals.user.id));
    });
  }
  let inFlight = 0;
  app.get("/api/health", (_req, res) =>
    res.json({
      status: "ok",
      analysis: "static-evidence",
      ai: config.aiProvider,
      model: config.model,
      billing: config.billingEnabled ? "enabled" : "disabled",
      framework: "express",
    }),
  );
  app.get("/api/health/live", (_req, res) => res.json({ status: "ok" }));
  app.get("/api/health/ready", async (_req, res) => {
    try {
      if (dependencies.ready) await dependencies.ready();
      else if (dependencies.explanations) await dependencies.explanations.ready();
      res.json({ status: "ready" });
    } catch {
      res.status(503).json({ status: "unavailable" });
    }
  });
  app.post("/api/analyze", auth.optional, limiter(
    30,
    60 * 60 * 1_000,
    (req) => req.ip || "unknown",
  ), async (req, res, next) => {
    if (inFlight >= 4) {
      res
        .status(503)
        .json({ error: "The analyzer is busy. Please try again in a moment." });
      return;
    }
    inFlight++;
    try {
      const guide = await analyzeRepository(req.body?.repo);
      if (res.locals.user && dependencies.repositories)
        await dependencies.repositories.save(res.locals.user.id, guide);
      res.json(guide);
    } catch (error) {
      next(error);
    } finally {
      inFlight--;
    }
  });
  app.post("/api/source",   limiter(
    120,
    60 * 60 * 1_000,
    (req) => req.ip || "unknown",
  ), async (req, res) => {
    res.json(
      await readSource(req.body?.repo, req.body?.commit, req.body?.path),
    );
  });
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "API endpoint not found." });
  });

  const onError: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof RepoError) {
      res.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
      return;
    }
    if (error?.type === "entity.too.large") {
      res.status(413).json({ error: "Request is too large." });
      return;
    }
    if (error instanceof SyntaxError) {
      res.status(400).json({ error: "Send a valid JSON request." });
      return;
    }
    res
      .status(500)
      .json({ error: "The request could not be completed. Please try again." });
  };
  app.use(onError);
  return app;
}
