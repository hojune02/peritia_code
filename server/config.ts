export type Config = {
  origin: string;
  secret: string;
  database: string;
  production: boolean;
  googleClientId: string;
  googleClientSecret: string;
  ollamaUrl: string;
  model: string;
};
export function getConfig(env = process.env): Config {
  const production = env.NODE_ENV === "production";
  const origin = env.APP_ORIGIN || (production ? "" : "http://localhost:5173");
  const url = new URL(origin);
  if (
    url.origin !== origin ||
    (production && url.protocol !== "https:") ||
    !["http:", "https:"].includes(url.protocol)
  )
    throw new Error(
      "APP_ORIGIN must be an exact origin, with HTTPS in production (no trailing slash).",
    );
  const secret = env.JWT_SECRET || "";
  if (Buffer.byteLength(secret) < 32)
    throw new Error(
      "Set JWT_SECRET to a random secret of at least 32 bytes. See README.md.",
    );
  const ollamaUrl = env.OLLAMA_URL || "http://127.0.0.1:11434";
  const ollama = new URL(ollamaUrl);
  if (
    !["localhost", "127.0.0.1", "[::1]", "ollama"].includes(ollama.hostname) ||
    ollama.protocol !== "http:" ||
    ollama.username ||
    ollama.password ||
    ollama.pathname !== "/" ||
    ollama.search ||
    ollama.hash
  )
    throw new Error(
      "OLLAMA_URL must point to local Ollama or the private Docker service http://ollama:11434.",
    );
  const model = env.OLLAMA_MODEL || "qwen2.5-coder:7b";
  if (!/^[a-zA-Z0-9_.:-]+$/.test(model) || /cloud/i.test(model))
    throw new Error("Use a locally installed Ollama model, not a cloud model.");
  if (!!env.GOOGLE_CLIENT_ID !== !!env.GOOGLE_CLIENT_SECRET)
    throw new Error("Set both Google client credentials or neither.");
  return {
    origin,
    secret,
    production,
    database: env.DATABASE_PATH || "./data/peritia.sqlite",
    googleClientId: env.GOOGLE_CLIENT_ID || "",
    googleClientSecret: env.GOOGLE_CLIENT_SECRET || "",
    ollamaUrl,
    model,
  };
}
