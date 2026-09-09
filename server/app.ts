import express, { type ErrorRequestHandler } from "express";
import { analyzeRepository, readSource } from "./github";
import { RepoError } from "../lib/repository";
import { createAuth, limiter, sameOrigin, verifyGoogleToken } from "./auth";
import { createExplainer } from "./ai";
import type { Config } from "./config";
import type { AuthStore } from "./auth-store";

export function createApp(
  config: Config,
  store: AuthStore,
  dependencies: {
    explain?: ReturnType<typeof createExplainer>;
    googleVerify?: typeof verifyGoogleToken;
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
  app.use(express.json({ limit: "4kb" }));
  app.use("/api", sameOrigin(config));
  const auth = createAuth(config, store, dependencies.googleVerify);
  app.use("/api/auth", auth.router);
  const explain = dependencies.explain || createExplainer(config);
  app.post(
    "/api/explain",
    auth.required,
    limiter(30, 60 * 60 * 1000, (_req, res) => res.locals.user.id),
    async (req, res) => {
      res.json(await explain(req.body || {}));
    },
  );
  let inFlight = 0;
  app.get("/api/health", (_req, res) =>
    res.json({
      status: "ok",
      analysis: "static-evidence",
      ai: "local-ollama",
      framework: "express",
    }),
  );
  app.post("/api/analyze", async (req, res, next) => {
    if (inFlight >= 4) {
      res
        .status(503)
        .json({ error: "The analyzer is busy. Please try again in a moment." });
      return;
    }
    inFlight++;
    try {
      res.json(await analyzeRepository(req.body?.repo));
    } catch (error) {
      next(error);
    } finally {
      inFlight--;
    }
  });
  app.post("/api/source", async (req, res) => {
    res.json(
      await readSource(req.body?.repo, req.body?.commit, req.body?.path),
    );
  });
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "API endpoint not found." });
  });
  const onError: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof RepoError) {
      res.status(error.status).json({ error: error.message });
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
