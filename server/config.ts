export type Config = {
  origin: string;
  secret: string;
  database: string;
  production: boolean;
  googleClientId: string;
  googleClientSecret: string;
  aiProvider: "ollama" | "gemini";
  aiModelRevision: string;
  geminiApiKey: string;
  geminiBillingTier: "free" | "paid";
  ollamaUrl: string;
  model: string;
  billingEnabled: boolean;
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
  const aiProvider = env.AI_PROVIDER === "gemini" ? "gemini" : "ollama";
  if (env.AI_PROVIDER && !["gemini", "ollama"].includes(env.AI_PROVIDER))
    throw new Error("AI_PROVIDER must be gemini or ollama.");
  const model = aiProvider === "gemini"
    ? env.GEMINI_MODEL || "gemini-3.5-flash-lite"
    : env.OLLAMA_MODEL || "qwen2.5-coder:7b";
  if (aiProvider === "gemini" && !/^gemini-[a-z0-9.-]+$/.test(model))
    throw new Error("GEMINI_MODEL must be a Gemini model name.");
  if (aiProvider === "ollama" && (!/^[a-zA-Z0-9_.:-]+$/.test(model) || /cloud/i.test(model)))
    throw new Error("Use a locally installed Ollama model, not a cloud model.");
  const geminiApiKey = env.GEMINI_API_KEY || "";
  if (aiProvider === "gemini" && !geminiApiKey)
    throw new Error("GEMINI_API_KEY is required when AI_PROVIDER=gemini.");
  const geminiBillingTier = env.GEMINI_BILLING_TIER || "free";
  if (!["free", "paid"].includes(geminiBillingTier))
    throw new Error("GEMINI_BILLING_TIER must be free or paid.");
  for (const [name, value] of [
    ["GEMINI_INPUT_USD_PER_MILLION", env.GEMINI_INPUT_USD_PER_MILLION ?? "0.30"],
    ["GEMINI_OUTPUT_USD_PER_MILLION", env.GEMINI_OUTPUT_USD_PER_MILLION ?? "2.50"],
  ] as const) {
    if (!Number.isFinite(Number(value)) || Number(value) < 0)
      throw new Error(`${name} must be a non-negative number.`);
  }
  const aiModelRevision = env.AI_MODEL_REVISION || model;
  if (aiModelRevision.length > 200)
    throw new Error("AI_MODEL_REVISION is too long.");
  if (!!env.GOOGLE_CLIENT_ID !== !!env.GOOGLE_CLIENT_SECRET)
    throw new Error("Set both Google client credentials or neither.");
  const billingEnabled = env.BILLING_ENABLED === "true";
  if (billingEnabled) {
    for (const name of [
      "LEMONSQUEEZY_API_KEY",
      "LEMONSQUEEZY_STORE_ID",
      "LEMONSQUEEZY_PRO_VARIANT_ID",
      "LEMONSQUEEZY_TOPUP_VARIANT_ID",
      "LEMONSQUEEZY_WEBHOOK_SECRET",
    ] as const) {
      if (!env[name]) throw new Error(`${name} is required when billing is enabled.`);
    }
    for (const name of ["LEMONSQUEEZY_STORE_ID", "LEMONSQUEEZY_PRO_VARIANT_ID", "LEMONSQUEEZY_TOPUP_VARIANT_ID"] as const) {
      if (!/^[1-9][0-9]*$/.test(env[name] || "")) throw new Error(`${name} must be a numeric Lemon Squeezy ID.`);
    }
    for (const [name, value] of [
      ["PAID_MONTHLY_ALLOWANCE", env.PAID_MONTHLY_ALLOWANCE ?? "100"],
      ["TOPUP_ALLOWANCE", env.TOPUP_ALLOWANCE ?? "50"],
    ] as const) {
      if (!Number.isSafeInteger(Number(value)) || Number(value) <= 0)
        throw new Error(`${name} must be a positive integer.`);
    }
  }
  return {
    origin,
    secret,
    production,
    database: env.DATABASE_PATH || "./data/peritia.sqlite",
    googleClientId: env.GOOGLE_CLIENT_ID || "",
    googleClientSecret: env.GOOGLE_CLIENT_SECRET || "",
    aiProvider,
    aiModelRevision,
    geminiApiKey,
    geminiBillingTier: geminiBillingTier as "free" | "paid",
    ollamaUrl,
    model,
    billingEnabled,
  };
}
