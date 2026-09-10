import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { SignJWT, decodeJwt, generateKeyPair } from "jose";
import { createApp, type RepositoryEndpoints } from "../server/app";
import { Store } from "../server/store";
import { getConfig } from "../server/config";
import {
  hashPassword,
  verifyPassword,
  createGoogleTokenVerifier,
  type verifyGoogleToken,
} from "../server/auth";
import { createExplainer, validateExplanation } from "../server/ai";
import type { Explanation } from "../lib/explanation";
import { demoGuide } from "../lib/demo";
import { chunkExplanationFile, makeCacheKey } from "../server/explanations";
import { verifyWebhook, type BillingService } from "../server/billing";
import { estimateGeminiCost, GeminiGenerationError, generateWithGemini } from "../server/gemini";
import { createHmac } from "node:crypto";

const config = getConfig({
  APP_ORIGIN: "http://localhost:5173",
  JWT_SECRET: randomBytes(32).toString("hex"),
});
const origin = config.origin;
const password = "correct horse battery staple";
const output = {
  claims: [
    {
      text: "Exports an add function.",
      kind: "observation",
      startLine: 1,
      endLine: 1,
      quote: "export const add = (a, b) => a + b;",
    },
  ],
  limitations: ["Callers were not provided."],
};
const source = output.claims[0].quote + "\n// end";
const input = {
  repo: "someone/repo",
  commit: "a".repeat(40),
  path: "add.js",
  page: 0,
  level: "beginner",
};
const nativeFetch = globalThis.fetch;

test("durable cache keys cover every generation input", () => {
  const input = {
    repositoryId: "1", commit: "a".repeat(40), path: "a.ts",
    startLine: 1, endLine: 80, contentHash: "b".repeat(64),
    contextHash: "c".repeat(64), level: "beginner",
    modelDigest: "sha256:model", promptVersion: "v1",
    options: { temperature: 0, num_ctx: 8192 },
  };
  const original = makeCacheKey(input);
  assert.equal(original.length, 64);
  assert.notEqual(original, makeCacheKey({ ...input, level: "technical" }));
  assert.notEqual(original, makeCacheKey({ ...input, modelDigest: "sha256:new" }));
});

test("whole-file explanation chunks cover every line without gaps", () => {
  const lines = Array.from({ length: 181 }, (_, index) => `line ${index + 1}`);
  assert.deepEqual(chunkExplanationFile(lines), [
    { first: 1, last: 80 },
    { first: 81, last: 160 },
    { first: 161, last: 181 },
  ]);

  const denseLines = ["a".repeat(7_000), "b".repeat(6_000), "tail"];
  assert.deepEqual(chunkExplanationFile(denseLines), [
    { first: 1, last: 1 },
    { first: 2, last: 3 },
  ]);
  assert.throws(
    () => chunkExplanationFile(["x".repeat(12_001)]),
    /line that is too large/,
  );
});

test("billing webhook verification rejects malformed and altered signatures", () => {
  const body = Buffer.from('{"event":"subscription_created"}');
  const secret = "test-webhook-secret";
  const signature = createHmac("sha256", secret).update(body).digest("hex");
  assert.equal(verifyWebhook(body, signature, secret), true);
  assert.equal(verifyWebhook(Buffer.from(body + "x"), signature, secret), false);
  assert.equal(verifyWebhook(body, "not-hex", secret), false);
});

test("Gemini streaming preserves partial output and reports provider usage", async () => {
  const geminiConfig = getConfig({
    APP_ORIGIN: origin,
    JWT_SECRET: config.secret,
    AI_PROVIDER: "gemini",
    GEMINI_API_KEY: "test-api-key",
    GEMINI_MODEL: "gemini-3.5-flash-lite",
    AI_MODEL_REVISION: "test-revision",
  });
  const events = [
    { candidates: [{ content: { parts: [{ text: "Lines 1–2: Imports " }] } }] },
    {
      candidates: [{ content: { parts: [{ text: "the module." }] }, finishReason: "STOP" }],
      modelVersion: "gemini-3.5-flash-lite-001",
      usageMetadata: { promptTokenCount: 2000, candidatesTokenCount: 400, thoughtsTokenCount: 25, totalTokenCount: 2425 },
    },
  ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  const partial: string[] = [];
  const generated = await generateWithGemini(
    geminiConfig,
    { system: "system", user: "user" },
    async (text) => { partial.push(text); },
    async (_url, init) => {
      assert.equal(new Headers(init?.headers).get("x-goog-api-key"), "test-api-key");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.generationConfig.responseJsonSchema, undefined);
      assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, "minimal");
      return new Response(events, { headers: { "Content-Type": "text/event-stream" } });
    },
  );
  assert.equal(generated.text, "Lines 1–2: Imports the module.");
  assert.equal(generated.modelVersion, "gemini-3.5-flash-lite-001");
  assert.equal(generated.complete, true);
  assert.deepEqual(generated.usage, { inputTokens: 2000, outputTokens: 400, thoughtTokens: 25, totalTokens: 2425 });
  assert.deepEqual(partial, ["Lines 1–2: Imports ", "Lines 1–2: Imports the module."]);
  assert.equal(estimateGeminiCost(generated.usage, {
    GEMINI_INPUT_USD_PER_MILLION: "0.10",
    GEMINI_OUTPUT_USD_PER_MILLION: "0.40",
  }), 0.00037);
});

test("Gemini returns received text when a stream ends before normal completion", async () => {
  const geminiConfig = getConfig({
    APP_ORIGIN: origin,
    JWT_SECRET: config.secret,
    AI_PROVIDER: "gemini",
    GEMINI_API_KEY: "test-api-key",
    GEMINI_MODEL: "gemini-3.5-flash-lite",
  });
  const event = `data: ${JSON.stringify({
    candidates: [{ content: { parts: [{ text: "Lines 1–4: Partial explanation" }] }, finishReason: "MAX_TOKENS" }],
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150 },
  })}\n\n`;
  const generated = await generateWithGemini(
    geminiConfig,
    { system: "system", user: "user" },
    async () => undefined,
    async () => new Response(event),
  );
  assert.equal(generated.text, "Lines 1–4: Partial explanation");
  assert.equal(generated.complete, false);
  assert.equal(generated.completionReason, "MAX_TOKENS");
});

test("Gemini failures retain provider-reported token usage for cost accounting", async () => {
  const geminiConfig = getConfig({
    APP_ORIGIN: origin,
    JWT_SECRET: config.secret,
    AI_PROVIDER: "gemini",
    GEMINI_API_KEY: "test-api-key",
  });
  const event = `data: ${JSON.stringify({
    candidates: [{ finishReason: "MAX_TOKENS" }],
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150 },
  })}\n\n`;
  await assert.rejects(
    generateWithGemini(
      geminiConfig,
      { system: "system", user: "user" },
      async () => undefined,
      async () => new Response(event),
    ),
    (error: unknown) => error instanceof GeminiGenerationError
      && error.message === "GEMINI_FINISH_MAX_TOKENS"
      && error.usage?.totalTokens === 150,
  );
});
async function fixture(
  t: TestContext,
  options: {
    googleVerify?: typeof verifyGoogleToken;
    production?: boolean;
    repositories?: RepositoryEndpoints;
    billing?: BillingService;
  } = {},
) {
  const store = new Store(":memory:");
  let explanations = 0;
  const settings = {
    ...config,
    production: options.production ?? false,
    billingEnabled: Boolean(options.billing),
    googleClientId: "test-client",
    googleClientSecret: "test-secret",
  };
  const app = createApp(settings, store, {
    googleVerify: options.googleVerify,
    explain: async () => {
      explanations++;
      return { ...output, status: "generated" } as Explanation;
    },
    repositories: options.repositories,
    billing: options.billing,
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
  });
  const post = (
    path: string,
    body: unknown,
    token = "",
    requestOrigin = origin,
  ) =>
    nativeFetch(url + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: requestOrigin,
        Cookie: token,
      },
      body: JSON.stringify(body),
    });
  const get = (path: string, token = "") =>
    nativeFetch(url + path, { headers: { Cookie: token }, redirect: "manual" });
  const put = (path: string, body: unknown, token = "") =>
    nativeFetch(url + path, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Origin: origin, Cookie: token },
      body: JSON.stringify(body),
    });
  const del = (path: string, token = "") =>
    nativeFetch(url + path, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Origin: origin, Cookie: token },
      body: "{}",
    });
  const register = async (email = "person@example.com") => {
    const response = await post("/api/auth/register", { email, password });
    assert.equal(response.status, 201);
    return response.headers.get("set-cookie")!.split(";")[0];
  };
  return { store, post, put, del, get, register, count: () => explanations };
}

test("passwords are salted, hashed, and checked; bounds prevent oversized KDF input", async () => {
  const a = await hashPassword(password),
    b = await hashPassword(password);
  assert.notEqual(a, b);
  assert(!a.includes(password));
  assert(await verifyPassword(password, a));
  assert.equal(await verifyPassword("incorrect", a), false);
  await assert.rejects(hashPassword("short"));
  await assert.rejects(hashPassword("a".repeat(257)));
});
test("accounts and sessions survive reopening SQLite; expired and revoked sessions fail", () => {
  const directory = mkdtempSync(join(tmpdir(), "peritia-test-"));
  try {
    const path = join(directory, "test.sqlite");
    const first = new Store(path);
    const user = first.createUser("user@example.com", "hash");
    first.session("sid", user.id, Date.now() + 60000);
    first.close();
    const second = new Store(path);
    assert.equal(second.byEmail(user.email)?.id, user.id);
    assert(second.sessionUser("sid", user.id, Date.now()));
    assert.equal(
      second.sessionUser("sid", user.id, Date.now() + 70000),
      undefined,
    );
    second.revoke("sid");
    assert.equal(second.sessionUser("sid", user.id, Date.now()), undefined);
    second.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test("credential HTTP flow: register, reload session, logout/replay, login and wrong password", async (t) => {
  const f = await fixture(t);
  const token = await f.register(" Person@Example.com ");
  const session = await (await f.get("/api/auth/session", token)).json();
  assert.equal(session.user.email, "person@example.com");
  assert.equal(session.user.password, undefined);
  assert.equal((await f.post("/api/explain", input, token)).status, 200);
  assert.equal(f.count(), 1);
  assert.equal((await f.post("/api/auth/logout", {}, token)).status, 200);
  assert.equal((await f.post("/api/explain", input, token)).status, 401);
  assert.equal(
    (
      await f.post("/api/auth/login", {
        email: session.user.email,
        password: "wrong",
      })
    ).status,
    401,
  );
  assert.equal(
    (await f.post("/api/auth/login", { email: session.user.email, password }))
      .status,
    200,
  );
  assert.equal(
    (
      await f.post("/api/auth/register", {
        email: session.user.email,
        password,
      })
    ).status,
    409,
  );
});
test("repository library endpoints use the authenticated account identity", async (t) => {
  const listed: string[] = [];
  const opened: string[] = [];
  const reviewed: string[] = [];
  const removed: string[] = [];
  const repositories: RepositoryEndpoints = {
    save: async () => undefined,
    list: async (userId) => {
      listed.push(userId);
      return [];
    },
    open: async (userId) => {
      opened.push(userId);
      return { guide: demoGuide, reviewedPaths: [] };
    },
    remove: async (userId) => {
      removed.push(userId);
      return { ok: true };
    },
    setReviewed: async (userId) => {
      reviewed.push(userId);
      return { ok: true };
    },
  };
  const f = await fixture(t, { repositories });
  const firstCookie = await f.register("first@example.com");
  const secondCookie = await f.register("second@example.com");
  const first = await (await f.get("/api/auth/session", firstCookie)).json();
  const second = await (await f.get("/api/auth/session", secondCookie)).json();
  assert.equal((await f.get("/api/repositories")).status, 401);
  assert.equal((await f.get("/api/repositories", firstCookie)).status, 200);
  assert.equal((await f.get("/api/repositories", secondCookie)).status, 200);
  assert.equal((await f.get("/api/repositories/123", firstCookie)).status, 200);
  assert.equal((await f.del("/api/repositories/123")).status, 401);
  assert.equal((await f.del("/api/repositories/123", firstCookie)).status, 200);
  assert.equal((await f.put("/api/repositories/files/reviewed", {
    repo: "https://github.com/example/repo",
    commit: "a".repeat(40),
    path: "src/main.ts",
    reviewed: true,
  }, secondCookie)).status, 200);
  assert.deepEqual(listed, [first.user.id, second.user.id]);
  assert.deepEqual(opened, [first.user.id]);
  assert.deepEqual(removed, [first.user.id]);
  assert.deepEqual(reviewed, [second.user.id]);
});
test("billing checkout requires authentication, validates purchase type, and uses account identity", async (t) => {
  const purchases: Array<{ userId: string; kind: string }> = [];
  const cancellations: string[] = [];
  const billing = {
    webhook: (_req: any, res: any) => res.json({ accepted: true }),
    checkout: async (user: { id: string }, kind: string) => {
      purchases.push({ userId: user.id, kind });
      return { url: "https://example.lemonsqueezy.com/checkout" };
    },
    portal: async () => ({ url: "https://example.lemonsqueezy.com/billing" }),
    cancel: async (userId: string) => {
      cancellations.push(userId);
      return { status: "cancelled", endsAt: "2030-01-01T00:00:00.000Z" };
    },
  } as unknown as BillingService;
  const f = await fixture(t, { billing });
  const cookie = await f.register("billing@example.com");
  const session = await (await f.get("/api/auth/session", cookie)).json();
  assert.equal((await f.post("/api/billing/checkout", { kind: "subscription" })).status, 401);
  assert.equal((await f.post("/api/billing/cancel", {})).status, 401);
  assert.equal((await f.post("/api/billing/checkout", { kind: "credits" }, cookie)).status, 400);
  const response = await f.post("/api/billing/checkout", { kind: "topup" }, cookie);
  assert.equal(response.status, 200);
  assert.deepEqual(purchases, [{ userId: session.user.id, kind: "topup" }]);
  assert.equal((await f.post("/api/billing/cancel", {}, cookie)).status, 200);
  assert.deepEqual(cancellations, [session.user.id]);
});
test("JWT: unsigned, tampered, expired, wrong-audience, wrong-issuer tokens are rejected", async (t) => {
  const f = await fixture(t);
  const cookie = await f.register();
  const raw = cookie.split("=")[1];
  const payload = decodeJwt(raw);
  const secret = new TextEncoder().encode(config.secret);
  const bad = [
    raw.slice(0, -8) + "AAAAAAAA",
    `${raw.split(".")[0]}.${raw.split(".")[1]}.`,
  ];
  for (const changes of [
    { exp: 1 },
    { aud: "another-app" },
    { iss: "https://evil.example" },
  ]) {
    bad.push(
      await new SignJWT({ ...payload, ...changes })
        .setProtectedHeader({ alg: "HS256" })
        .sign(secret),
    );
  }
  for (const token of bad)
    assert.equal(
      (await f.post("/api/explain", input, "peritia_session=" + token)).status,
      401,
    );
  assert.equal(f.count(), 0);
});
test("production cookie is HttpOnly, Secure, SameSite=Lax with __Host prefix", async (t) => {
  const f = await fixture(t, { production: true });
  const response = await f.post("/api/auth/register", {
    email: "secure@example.com",
    password,
  });
  const cookie = response.headers.get("set-cookie")!;
  for (const expected of [
    "__Host-peritia_session=",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Path=/",
  ])
    assert(cookie.includes(expected));
  assert(!cookie.includes("Domain="));
  assert.equal(response.headers.get("cache-control"), "no-store");
});
test("missing authentication, foreign Origin, missing Origin, and oversized JSON are blocked", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.post("/api/explain", input)).status, 401);
  for (const value of ["https://evil.example", ""])
    assert.equal(
      (
        await f.post(
          "/api/auth/register",
          { email: "x@example.com", password },
          "",
          value,
        )
      ).status,
      403,
    );
  assert.equal(
    (await f.post("/api/auth/register", { payload: "x".repeat(5000) })).status,
    413,
  );
  assert.equal(f.count(), 0);
});
test("credential rate limit and per-account AI rate limit are enforced", async (t) => {
  const f = await fixture(t);
  const token = await f.register();
  for (let i = 0; i < 30; i++)
    assert.equal((await f.post("/api/explain", input, token)).status, 200);
  const limited = await f.post("/api/explain", input, token);
  assert.equal(limited.status, 429);
  assert(limited.headers.has("retry-after"));
  for (let i = 0; i < 11; i++)
    await f.post("/api/auth/login", { email: "bad" });
  assert.equal((await f.post("/api/auth/login", { email: "bad" })).status, 429);
});
test("Google state is browser-bound, expires, and is consumed once", () => {
  const store = new Store(":memory:");
  store.saveOAuth("state", "browser", "nonce", "verifier");
  assert.equal(store.takeOAuth("state", "attacker"), undefined);
  assert.equal(store.takeOAuth("state", "browser")?.nonce, "nonce");
  assert.equal(store.takeOAuth("state", "browser"), undefined);
  store.saveOAuth("expired", "browser", "nonce", "verifier");
  store.db.exec("UPDATE oauth SET expires=0");
  assert.equal(store.takeOAuth("expired", "browser"), undefined);
  store.close();
});
test("Google ID verifier checks RSA signature, issuer, audience and required expiration", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const verifier = createGoogleTokenVerifier(async () => publicKey);
  const payload = {
    sub: "google-user",
    iss: "https://accounts.google.com",
    aud: "test-client",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 60,
  };
  const sign = (value: typeof payload | Omit<typeof payload, "exp">) =>
    new SignJWT(value).setProtectedHeader({ alg: "RS256" }).sign(privateKey);
  const token = await sign(payload);
  assert.equal((await verifier(token, "test-client")).sub, payload.sub);
  await assert.rejects(verifier(token, "wrong-client"));
  await assert.rejects(
    verifier(
      await sign({ ...payload, iss: "https://evil.example" }),
      "test-client",
    ),
  );
  await assert.rejects(
    verifier(await sign({ ...payload, exp: 1 }), "test-client"),
  );
  const { exp: _exp, ...noExpiry } = payload;
  await assert.rejects(verifier(await sign(noExpiry), "test-client"));
  const other = await generateKeyPair("RS256");
  await assert.rejects(
    verifier(
      await new SignJWT(payload)
        .setProtectedHeader({ alg: "RS256" })
        .sign(other.privateKey),
      "test-client",
    ),
  );
});
test("Google callback checks nonce and verified email, creates JWT, and rejects replay", async (t) => {
  let nonce = "",
    verified = true;
  const f = await fixture(t, {
    googleVerify: async (_token, audience) => {
      assert.equal(audience, "test-client");
      return {
        sub: "google-user",
        email: "gmailuser@gmail.com",
        email_verified: verified,
        nonce,
      };
    },
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://oauth2.googleapis.com/token");
    assert(String(options?.body).includes("code_verifier="));
    return Response.json({ id_token: "mock-google-id-token" });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const begin = async () => {
    const response = await f.get("/api/auth/google");
    const location = new URL(response.headers.get("location")!);
    assert.equal(location.searchParams.get("scope"), "openid email");
    assert.equal(location.searchParams.get("code_challenge_method"), "S256");
    nonce = location.searchParams.get("nonce")!;
    return {
      state: location.searchParams.get("state")!,
      browser: response.headers.get("set-cookie")!.split(";")[0],
    };
  };
  const flow = await begin();
  const callback = "/api/auth/google/callback?code=code&state=" + flow.state;
  assert(
    (await f.get(callback)).headers.get("location")!.includes("google_failed"),
  );
  const success = await f.get(callback, flow.browser);
  assert.equal(success.headers.get("location"), origin + "/");
  assert(
    success.headers
      .getSetCookie()
      .some((x) => x.startsWith("peritia_session=")),
  );
  assert(
    (await f.get(callback, flow.browser)).headers
      .get("location")!
      .includes("google_failed"),
  );
  const bad = await begin();
  nonce = "wrong";
  assert(
    (
      await f.get(
        "/api/auth/google/callback?code=x&state=" + bad.state,
        bad.browser,
      )
    ).headers
      .get("location")!
      .includes("google_failed"),
  );
  const unverified = await begin();
  verified = false;
  assert(
    (
      await f.get(
        "/api/auth/google/callback?code=x&state=" + unverified.state,
        unverified.browser,
      )
    ).headers
      .get("location")!
      .includes("google_failed"),
  );
});
test("Google does not silently link a password account by email", async (t) => {
  let nonce = "";
  const f = await fixture(t, {
    googleVerify: async () => ({
      nonce,
      sub: "new-google-user",
      email: "person@example.com",
      email_verified: true,
    }),
  });
  await f.register();
  const start = await f.get("/api/auth/google"),
    location = new URL(start.headers.get("location")!);
  nonce = location.searchParams.get("nonce")!;
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ id_token: "mock" });
  t.after(() => {
    globalThis.fetch = original;
  });
  const response = await f.get(
    "/api/auth/google/callback?code=code&state=" +
      location.searchParams.get("state"),
    start.headers.get("set-cookie")!.split(";")[0],
  );
  assert(response.headers.get("location")!.includes("existing_account"));
  assert.equal(f.store.byGoogle("new-google-user"), undefined);
});
test("AI evidence validation reconstructs quotes and rejects out-of-range or malformed claims", () => {
  const valid = validateExplanation(output, source.split("\n"), 1, 2);

  assert.equal(valid.claims.length, 1);

  const modelInventedQuote = validateExplanation(
    {
      ...output,
      claims: [
        {
          ...output.claims[0],
          quote: "This text was invented by the model.",
        },
      ],
    },
    source.split("\n"),
    1,
    2,
  );

  // The invented quotation must be discarded and reconstructed
  // from the real source.
  assert.equal(modelInventedQuote.claims[0].quote, output.claims[0].quote);

  for (const edit of [
    { startLine: 0 },
    { endLine: 9 },
    { kind: "certain" },
    { text: "" },
  ]) {
    assert.throws(() =>
      validateExplanation(
        {
          ...output,
          claims: [
            {
              ...output.claims[0],
              ...edit,
            },
          ],
        },
        source.split("\n"),
        1,
        2,
      ),
    );
  }

  assert.throws(() =>
    validateExplanation(
      {
        claims: [],
        limitations: [],
      },
      [source],
      1,
      1,
    ),
  );
});
test("AI uses server-fetched immutable code, caches exact scope, and sends no paid provider request", async () => {
  let calls = 0;
  const explain = createExplainer(
    config,
    async (repo, commit, path) => {
      assert.equal(repo, "someone/repo");
      assert.equal(commit, input.commit);
      return { path: String(path), content: source };
    },
    async (url, options) => {
      calls++;
      assert.equal(url, "http://127.0.0.1:11434/api/chat");
      const body = JSON.parse(String(options?.body));
      assert.equal(body.stream, false);
      assert.equal(body.options.temperature, 0);
      assert(body.format.properties.claims);
      assert(body.messages[1].content.includes(source.split("\n")[0]));
      assert(!body.messages[1].content.includes("client supplied malware"));
      return Response.json({ message: { content: JSON.stringify(output) } });
    },
  );
  const first = await explain({
    ...input,
    ...{ content: "client supplied malware" },
  });
  assert.equal(first.cached, false);
  assert.equal(first.sourceHash.length, 64);
  assert.equal((await explain(input)).cached, true);
  assert.equal(calls, 1);
  await explain({ ...input, level: "technical" });
  assert.equal(calls, 2);
  await assert.rejects(explain({ ...input, page: 9 }));
});
test("AI rejects provider failures but returns malformed model answers as unverified text", async () => {
  const reader = async () => ({
    path: "add.js",
    content: source,
  });

  const providerFailures = [
    async () => {
      throw new Error("offline");
    },
    async () =>
      new Response("missing model", {
        status: 404,
      }),
    async () => new Response("x".repeat(100001)),
  ];

  for (const provider of providerFailures) {
    await assert.rejects(createExplainer(config, reader, provider)(input));
  }

  const malformedJSON = createExplainer(config, reader, async () =>
    Response.json({
      message: {
        content: "The function returns the sum of a and b.",
      },
    }),
  );

  const rawResult = await malformedJSON(input);

  assert.equal(rawResult.status, "generated");
  assert.equal(rawResult.unverified, true);
  assert.equal(rawResult.rawText, "The function returns the sum of a and b.");
  assert.deepEqual(rawResult.claims, []);

  const invalidEvidence = createExplainer(config, reader, async () =>
    Response.json({
      message: {
        content: JSON.stringify({
          ...output,
          claims: [
            {
              ...output.claims[0],
              startLine: 0,
            },
          ],
        }),
      },
    }),
  );

  const invalidEvidenceResult = await invalidEvidence(input);

  assert.equal(invalidEvidenceResult.unverified, true);

  assert.match(invalidEvidenceResult.rawText ?? "", /startLine/);
});
test("AI section bounds are explicit and long/minified lines are rejected", async () => {
  const lines = Array.from({ length: 90 }, (_, i) => `// line ${i + 1}`);
  const explain = createExplainer(
    config,
    async () => ({ path: "test.js", content: lines.join("\n") }),
    async (_url, options) => {
      const prompt = JSON.parse(
        JSON.parse(String(options?.body)).messages[1].content,
      );
      assert.equal(prompt.section[0].line, 81);
      assert.equal(prompt.section.length, 10);
      return Response.json({
        message: {
          content: JSON.stringify({
            claims: [
              {
                ...output.claims[0],
                startLine: 81,
                endLine: 81,
                quote: "// line 81",
              },
            ],
            limitations: [],
          }),
        },
      });
    },
  );
  const result = await explain({ ...input, page: 1 });
  assert.equal(result.startLine, 81);
  assert.equal(result.endLine, 90);
  assert.equal(result.totalLines, 90);
  await assert.rejects(
    createExplainer(config, async () => ({
      path: "test.js",
      content: "x".repeat(12001),
    }))(input),
  );
});
test("local AI concurrency is bounded and recovers after the active request finishes", async () => {
  let release!: () => void, started!: () => void;
  const running = new Promise<void>((resolve) => {
    started = resolve;
  });
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const explain = createExplainer(
    config,
    async () => ({ path: "add.js", content: source }),
    async () => {
      started();
      await wait;
      return Response.json({ message: { content: JSON.stringify(output) } });
    },
  );
  const first = explain(input);
  await running;
  await assert.rejects(
    explain({ ...input, level: "technical" }),
    /working on another/,
  );
  release();
  await first;
  assert.equal(
    (await explain({ ...input, level: "technical" })).status,
    "generated",
  );
});
test("configuration refuses weak secrets, paid/cloud endpoints, and non-HTTPS production", () => {
  for (const change of [
    { JWT_SECRET: "weak" },
    { OLLAMA_URL: "https://api.openai.com" },
    { OLLAMA_MODEL: "model:cloud" },
    { AI_PROVIDER: "gemini" },
    { GEMINI_BILLING_TIER: "unknown" },
    { BILLING_ENABLED: "true" },
    {
      BILLING_ENABLED: "true",
      LEMONSQUEEZY_API_KEY: "key",
      LEMONSQUEEZY_STORE_ID: "store-not-a-number",
      LEMONSQUEEZY_PRO_VARIANT_ID: "100",
      LEMONSQUEEZY_TOPUP_VARIANT_ID: "200",
      LEMONSQUEEZY_WEBHOOK_SECRET: "secret",
    },
    { NODE_ENV: "production", APP_ORIGIN: "http://localhost:3001" },
  ])
    assert.throws(() =>
      getConfig({ APP_ORIGIN: origin, JWT_SECRET: config.secret, ...change }),
    );
  assert.equal(getConfig({
    APP_ORIGIN: origin,
    JWT_SECRET: config.secret,
    BILLING_ENABLED: "true",
    LEMONSQUEEZY_API_KEY: "key",
    LEMONSQUEEZY_STORE_ID: "42",
    LEMONSQUEEZY_PRO_VARIANT_ID: "100",
    LEMONSQUEEZY_TOPUP_VARIANT_ID: "200",
    LEMONSQUEEZY_WEBHOOK_SECRET: "secret",
  }).billingEnabled, true);
});
