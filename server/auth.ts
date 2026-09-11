import { randomBytes, createHash, scrypt, timingSafeEqual } from "node:crypto";
import {
  SignJWT,
  jwtVerify,
  createRemoteJWKSet,
  type JWTVerifyGetKey,
} from "jose";
import {
  Router,
  type Request,
  type Response,
  type RequestHandler,
} from "express";
import type { Config } from "./config";
import { AuthStore, User } from "./auth-store";
import { RepoError } from "../lib/repository";

const lifetime = 8 * 60 * 60;
const random = () => randomBytes(32).toString("base64url");
const digest = (s: string) =>
  createHash("sha256").update(s).digest("base64url");
export function emailInput(value: unknown) {
  if (
    typeof value !== "string" ||
    value.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
  )
    throw new RepoError("Enter a valid email address.");
  return value.trim().toLowerCase();
}
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(
      password,
      salt,
      64,
      { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (err, key) => (err ? reject(err) : resolve(key)),
    ),
  );
}
export async function hashPassword(password: unknown) {
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    Buffer.byteLength(password) > 256
  )
    throw new RepoError(
      "Use a password of at least 12 characters and at most 256 bytes.",
    );
  const salt = random();
  return `scrypt$${salt}$${(await derive(password, salt)).toString("hex")}`;
}
export async function verifyPassword(password: unknown, stored: string) {
  if (typeof password !== "string" || Buffer.byteLength(password) > 256)
    return false;
  const [version, salt, hash] = stored.split("$");
  if (version !== "scrypt" || !salt || !/^[a-f0-9]{128}$/.test(hash || ""))
    return false;
  return timingSafeEqual(
    await derive(password, salt),
    Buffer.from(hash, "hex"),
  );
}
export function cookie(req: Request, name: string) {
  const value = req.headers.cookie
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(name + "="))
    ?.slice(name.length + 1);
  return value || "";
}
// Bounded in-memory, per-process rate limiter for the initial single-instance deployment.
export function limiter(
  max: number,
  windowMs: number,
  key: (req: Request, res: Response) => string,
): RequestHandler {
  const entries = new Map<string, { count: number; until: number }>();
  return (req, res, next) => {
    const now = Date.now();
    for (const [k, v] of entries) if (v.until <= now) entries.delete(k);
    const k = key(req, res);
    let entry = entries.get(k);
    if (!entry) {
      if (entries.size >= 10000) {
        res.status(503).json({ error: "Please try again later." });
        return;
      }
      entry = { count: 0, until: now + windowMs };
      entries.set(k, entry);
    }
    if (++entry.count > max) {
      res.setHeader("Retry-After", Math.ceil((entry.until - now) / 1000));
      res
        .status(429)
        .json({ error: "Too many requests. Please wait and retry." });
      return;
    }
    next();
  };
}
export function sameOrigin(config: Config): RequestHandler {
  return (req, res, next) => {
    if (
      req.method !== "GET" &&
      req.method !== "HEAD" &&
      (req.get("origin") !== config.origin || !req.is("application/json"))
    ) {
      res
        .status(403)
        .json({ error: "Use this application's origin and send JSON." });
      return;
    }
    next();
  };
}
const googleKeys = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
  { timeoutDuration: 10000 },
);
export function createGoogleTokenVerifier(keys: JWTVerifyGetKey = googleKeys) {
  return async (token: string, audience: string) =>
    (
      await jwtVerify(token, keys, {
        algorithms: ["RS256"],
        issuer: ["https://accounts.google.com", "accounts.google.com"],
        audience,
        requiredClaims: ["exp", "iat", "sub"],
      })
    ).payload;
}
export const verifyGoogleToken = createGoogleTokenVerifier();
export function createAuth(
  config: Config,
  store: AuthStore,
  googleVerify = verifyGoogleToken,
) {
  const router = Router();
  const key = new TextEncoder().encode(config.secret);
  const name = config.production ? "__Host-peritia_session" : "peritia_session";
  const options = {
    httpOnly: true,
    secure: config.production,
    sameSite: "lax" as const,
    path: "/",
  };
  const publicUser = (u: User) => ({
    id: u.id,
    email: u.email,
    provider: u.google_sub ? "google" : "password",
  });
  const dummy = hashPassword(random()); // Same KDF work for unknown accounts.
 async function issue(user: User, res: Response) {
  await store.prune();

  const sid = random();

  const token = await new SignJWT({ sid })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(config.origin)
    .setAudience("peritia")
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${lifetime}s`)
    .sign(key);

  await store.session(
    sid,
    user.id,
    Date.now() + lifetime * 1_000,
  );

  res.cookie(name, token, {
    ...options,
    maxAge: lifetime * 1_000,
  });

  return publicUser(user);
}
  async function session(req: Request) {
    try {
      const { payload } = await jwtVerify(cookie(req, name), key, {
        algorithms: ["HS256"],
        issuer: config.origin,
        audience: "peritia",
        requiredClaims: ["exp", "iat", "sub", "sid"],
      });
      if (typeof payload.sid !== "string" || !payload.sub) return null;
const user = await store.sessionUser(
  payload.sid,
  payload.sub,
  Date.now(),
);
      return user ? { user, sid: payload.sid } : null;
    } catch {
      return null;
    }
  }
  const required: RequestHandler = async (req, res, next) => {
    const current = await session(req);
    if (!current) {
      res.status(401).json({ error: "Sign in to request an AI explanation." });
      return;
    }
    res.locals.user = publicUser(current.user);
    next();
  };
  const optional: RequestHandler = async (req, res, next) => {
    const current = await session(req);
    if (current) res.locals.user = publicUser(current.user);
    next();
  };
  router.get("/session", async (req, res) => {
    const current = await session(req);
    res.json({
      user: current ? publicUser(current.user) : null,
      googleEnabled: !!config.googleClientId,
      model: config.model,
    });
  });
  const rate = limiter(12, 15 * 60 * 1000, (req) => req.ip || "unknown");
  let hashing = 0;
  router.post(["/register", "/login"], rate, async (req, res) => {
    if (hashing >= 4)
      throw new RepoError("Sign-in is busy. Please retry shortly.", 503);
    hashing++;
    try {
      const email = emailInput(req.body?.email);
      if (req.path === "/register") {
        const password = await hashPassword(req.body?.password);
if (await store.byEmail(email)) {
  throw new RepoError(
    "Unable to create this account. Try signing in with your original method.",
    409,
  );
}

let user: User;

try {
  user = await store.createUser(email, password);
} catch (error) {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  ) {
    throw new RepoError(
      "Unable to create this account. Try signing in with your original method.",
      409,
    );
  }

  throw error;
}

res.status(201).json({
  user: await issue(user, res),
});
      } else {
        const user = await store.byEmail(email);
        const valid = await verifyPassword(
          req.body?.password,
          user?.password || (await dummy),
        );
        if (!valid || !user?.password)
          throw new RepoError(
            "Email or password is incorrect. Google accounts must use Google sign-in.",
            401,
          );
        res.json({ user: await issue(user, res) });
      }
    } finally {
      hashing--;
    }
  });
  router.post("/logout", async (req, res) => {
    const current = await session(req);
    if (current) {
      await store.revoke(current.sid);
    }
    res.clearCookie(name, options);
    res.json({ ok: true });
  });
  router.get("/google", rate, async (req, res) => {
    if (!config.googleClientId)
      throw new RepoError("Google sign-in has not been configured.", 503);
    const state = random(),
      browser = random(),
      nonce = random(),
      verifier = random();
    await store.saveOAuth(digest(state), digest(browser), nonce, verifier);
    res.cookie("peritia_oauth", browser, { ...options, maxAge: 600000 });
    const params = new URLSearchParams({
      client_id: config.googleClientId,
      redirect_uri: config.origin + "/api/auth/google/callback",
      response_type: "code",
      scope: "openid email",
      state,
      nonce,
      code_challenge: digest(verifier),
      code_challenge_method: "S256",
      prompt: "select_account",
    });
    res.redirect("https://accounts.google.com/o/oauth2/v2/auth?" + params);
  });
  router.get("/google/callback", rate, async (req, res) => {
    res.clearCookie("peritia_oauth", options);
    try {
      if (
        !config.googleClientId ||
        typeof req.query.state !== "string" ||
        typeof req.query.code !== "string"
      )
        throw new Error("Invalid callback");
      const transaction = await store.takeOAuth(
        digest(req.query.state),
        digest(cookie(req, "peritia_oauth")),
      );
      if (!transaction) throw new Error("Invalid or expired OAuth state");
      const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        body: new URLSearchParams({
          code: req.query.code,
          client_id: config.googleClientId,
          client_secret: config.googleClientSecret,
          redirect_uri: config.origin + "/api/auth/google/callback",
          grant_type: "authorization_code",
          code_verifier: transaction.verifier,
        }),
      });
      if (!response.ok) throw new Error("Google exchange failed");
      const tokens = await response.json();
      if (typeof tokens.id_token !== "string")
        throw new Error("Missing ID token");
      const identity = await googleVerify(
        tokens.id_token,
        config.googleClientId,
      );
      if (
        identity.nonce !== transaction.nonce ||
        identity.email_verified !== true ||
        typeof identity.sub !== "string"
      )
        throw new Error("Invalid identity");
      let user = await store.byGoogle(identity.sub);
      if (!user) {
        const email = emailInput(identity.email);
        // Never merge an unverified password identity into a Google identity by email alone.
        if (await store.byEmail(email)) {
          res.redirect(config.origin + "/?auth_error=existing_account");
          return;
        }
        user = await store.createUser(email, null, identity.sub);
      }
      await issue(user, res);
      res.redirect(config.origin + "/");
    } catch {
      res.redirect(config.origin + "/?auth_error=google_failed");
    }
  });
  return { router, required, optional };
}
