# Peritia — durable local-AI explanations

A React/TypeScript + Express service that turns a public GitHub repository into an interactive guide. Explanation jobs, quotas, cache access, and billing state are durable in PostgreSQL; Redis/BullMQ connects a public API to a separately deployed Ollama worker.

Production setup, billing checks, GPU benchmarking, load testing, and GitHub App migration are documented in [OPERATIONS.md](./OPERATIONS.md).

## Start here

Install Node.js **24 LTS** (Node 22.13+ is also supported). From this folder:

```bash
npm ci
npm run setup
docker compose -f compose.dev.yaml up -d
npm run db:migrate
npm run dev
```

In another terminal, run `npm run start:worker` after Redis and Ollama are available. Set the local `DATABASE_URL` and `REDIS_URL` values from `.env.example` first.

Open **http://localhost:5173**. Keep the terminal running. Vite serves the interface on 5173 and proxies API requests to Express on 3001. The setup command creates a local environment file with a random JWT secret; it never overwrites an existing one. If upgrading an existing installation, compare your settings with `.env.example` and add the new variables.

Click **Sign in → Create an account**. Use an email address and a password of at least 12 characters. Google and AI configuration are independent: password login works before either is configured.

## Free AI setup

There is **no paid AI API, API key, subscription, or cloud fallback** in this application. The model runs on your own hardware. Electricity, hardware, bandwidth, domain names, and hosted servers can still cost money; this is not unlimited free cloud inference.

1. Install Ollama from https://ollama.com/download.
2. Disable its cloud features. In Ollama's `~/.ollama/server.json`, merge `"disable_ollama_cloud": true` into the JSON object, then restart Ollama. Alternatively, set `OLLAMA_NO_CLOUD=1` in the environment of the **Ollama server process**, not just Peritia.
3. Download the local model:

```bash
ollama pull qwen2.5-coder:7b
```

4. Keep Ollama running. If the desktop app/service is not already running, use `ollama serve` in another terminal. Verify it with `ollama list`.
5. Sign in to Peritia, open **File explorer**, select a readable file, and explicitly request an explanation. You can browse or close the tab while the worker continues; reopening reconnects to the durable job. Expand **Inspect evidence** to compare each claim with exact source lines.

The default model download is about 4.7 GB; it also needs memory for the model and a 16K context. Available RAM and CPU/GPU speed determine whether it runs comfortably. CPU-only runs may time out; the app reports this instead of inventing a result. Model installation is a separate step and is not bundled into this ZIP. GPU setup depends on your hardware; the Docker example below uses CPU by default.

### How accuracy is handled

- Express fetches the selected file itself at the guide's immutable Git commit. Client-supplied code or prompts are not accepted as context.
- The model receives a numbered **80-line section**, not an assertion that it has read the whole repository. Select the next section for longer files. Dense/minified sections that exceed the input budget are refused without silent truncation.
- Structured output includes claims, observation/inference labels, source line ranges, exact excerpts, and limitations. Every quoted excerpt and range is checked against the selected source before rendering. Invalid output is rejected as a whole.
- Repository comments and strings are treated as untrusted data. The model has no tools and Peritia never executes repository code.
- **A valid citation does not prove the explanation is true.** A model can misinterpret correctly quoted code or follow a malicious comment despite the prompt. Inspect its claims; no accuracy percentage or guarantee is claimed.
- Completed output is cached durably by immutable source, line range, detail level, prompt version, generation options, and model digest. Each new unlock reserves one atomic quota credit, including a shared cache hit; previously unlocked output remains accessible without another credit.

The curated technology glossary and static file facts remain available when AI is unavailable. See **TESTING.md** for a real-model C/Python/React evaluation and a human accuracy rubric.

## Google / Gmail sign-in

“Gmail login” means **Sign in with Google** using a Gmail or other Google account. Peritia requests only `openid email`; it does not access mail, contacts, or your Google password.

1. Open https://console.cloud.google.com/ and create/select a project.
2. Configure the Google Auth Platform branding/consent screen and audience. If the project is in testing, add your Gmail address as a test user where required.
3. Create an OAuth client of type **Web application**.
4. Add this exact authorized redirect URI for development:

```text
http://localhost:5173/api/auth/google/callback
```

5. Put the client values in your local environment file:

```dotenv
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
```

6. Restart `npm run dev`. Open **Sign in → Continue with Google**.

For a hosted deployment, add `https://YOUR_DOMAIN/api/auth/google/callback` to the same client's authorized redirect URIs and set `APP_ORIGIN=https://YOUR_DOMAIN` on the app. Paths, scheme, host, and port must match exactly. Use separate Google clients for development and production if desired.

The backend uses authorization code exchange with PKCE, browser-bound expiring state, nonce validation, and Google's signed ID-token verification (issuer, audience, expiration). Google's stable subject identifies the account. An existing password account is **not automatically merged** by email; use its original login method. Account linking is not implemented.

## JWT and account storage

Passwords use salted scrypt hashes. Users, sessions, OAuth transactions, explanation jobs, quotas, and billing state live in PostgreSQL. Redis carries durable job IDs to the worker but is not the billing source of truth.

JWTs expire after eight hours and travel in an HttpOnly, SameSite=Lax cookie; production also uses Secure and the `__Host-` prefix. No tokens are put in localStorage or exposed in JSON responses. Each authenticated request checks a server-side session record, so logout revokes that token immediately. After expiry, sign in again; there is no refresh-token flow.

Mutation requests require JSON and the exact configured Origin. Credential attempts are IP-limited; the process permits at most four simultaneous password hashes. With the supplied reverse proxy, the IP limit is shared across visitors because arbitrary forwarded headers are not trusted. This is a conservative small-deployment limit, not a horizontally scalable abuse-prevention system.

Email verification, forgotten-password recovery, account deletion UI, MFA, and account linking are outside this MVP. Treat password-account emails as unverified identifiers. Use Google if you need provider-verified email identity. Do not use these accounts as evidence of ownership of an email inbox.

## Configuration

| Variable                                | Purpose                                                                                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| APP_ORIGIN                              | Exact browser origin. `http://localhost:5173` for development; HTTPS origin for production. No trailing slash.                  |
| JWT_SECRET                              | Random secret of at least 32 bytes. `npm run setup` generates one. Keep stable across restarts; changing it signs everyone out. |
| DATABASE_URL                            | PostgreSQL connection used by the API, worker, migrations, and durable caches.                                                  |
| REDIS_URL                               | Redis connection used by the explanation outbox dispatcher and worker.                                                         |
| GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET | Both set to enable Google, both empty to disable it. Server only.                                                               |
| OLLAMA_URL                              | Defaults to `http://127.0.0.1:11434`. Local hosts or private Docker hostname `ollama` only.                                     |
| OLLAMA_MODEL                            | Defaults to `qwen2.5-coder:7b`; must be installed locally. Cloud model names are rejected.                                      |
| PORT                                    | Express port, default 3001. Development script uses 3001 to match the Vite proxy.                                               |
| NODE_ENV                                | `production` requires HTTPS. Leave unset for local compiled-app testing.                                                        |
| DOMAIN                                  | Used by the production Docker Compose setup, e.g. `peritia.example.com`.                                                        |

Never prefix secrets with `VITE_`, commit environment files, or put credentials in frontend code. GitHub requests remain unauthenticated; adding a `GITHUB_TOKEN` alone has no effect.

## Build and run the compiled app locally

Stop the development server. Change `APP_ORIGIN` to `http://localhost:3001`, leave `NODE_ENV` unset, then run:

```bash
npm test
npm run build
npm start
```

Open http://localhost:3001. For Google testing here, also authorize `http://localhost:3001/api/auth/google/callback`. Switch `APP_ORIGIN` back to port 5173 before resuming Vite development. `npm start` loads the local environment file but does not build automatically.

## Deploy with persistent accounts and local inference

The supplied Compose topology runs separate API and worker processes with durable PostgreSQL/Redis and a private Ollama service. For a paid beta, place the API/data services and GPU worker in compatible regions with private connectivity; see `OPERATIONS.md`.

1. Upload this `peritia/` folder to your machine. Keep secrets outside Git and use a restrictive file permission for the environment file.
2. Run the local setup once, or copy `.env.example` to `.env` and generate a random JWT secret using the command documented there.
3. Set `DOMAIN`, `POSTGRES_PASSWORD`, and the required secrets in `.env`. Compose derives `APP_ORIGIN=https://DOMAIN` and runs migrations once before API/worker startup.
4. Point the domain's DNS to the machine. Allow inbound TCP ports **80 and 443** for Caddy HTTPS. Do not expose 3001 or 11434 to the public internet.
5. Start Ollama and download the model:

```bash
docker compose up -d ollama
docker compose exec ollama ollama pull qwen2.5-coder:7b
docker compose up -d --build
docker compose logs --tail=60 api worker proxy
```

6. Visit `https://YOUR_DOMAIN/api/health`, then the main page. Caddy handles HTTPS. Add the production Google callback URL described above.
7. Test sign-in and AI using **TESTING.md**. Model inference stays on the private Compose network; Ollama cloud features are disabled. No inference port is published.

The Compose images use updateable Node 24, Caddy 2, and Ollama tags. Pin image digests after validating your deployment if you need exact image reproducibility; npm packages already have a lockfile. Docker execution and live HTTPS deployment were not tested in the authoring environment.

Keep the `postgres`, `redis`, and `models` named volumes: **do not run `docker compose down -v`** unless you intend to delete application data. Use PostgreSQL-native backups and test restoration before launch.

## Files to explore

| File                                     | Responsibility                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------- |
| app/page.tsx, app/globals.css            | Original interactive repository guide                                     |
| components/account.tsx, app/features.css | Login dialog and account UI                                               |
| components/ai-explanation.tsx            | Section selection, generation state, citations, stale-response protection |
| server/auth.ts, server/store.ts          | Passwords, JWTs, Google OAuth, persistence                                |
| server/ai.ts                             | Local model request, prompt, context limits, evidence checks, cache       |
| server/config.ts, server/app.ts          | Configuration validation and API routes                                   |
| server/github.ts, lib/repository.ts      | Public GitHub ingestion and static analysis                               |
| tests/features.test.ts                   | HTTP/auth and AI contract tests                                           |
| TESTING.md                               | Manual tests, API commands, and model accuracy review                     |
| compose.yaml, Dockerfile, Caddyfile      | Single-machine HTTPS deployment                                           |

## Verified and remaining checks

The core suite covers real HTTP authentication plus mocked provider/model boundaries. `npm run test:integration` adds a real PostgreSQL concurrency check for quota reservation. Live Google, Ollama, Lemon Squeezy, GPU, and public deployment checks require external credentials and infrastructure and must pass the staging runbook before launch.

No live Google account login, real Ollama generation, browser interaction, Docker build, or public deployment has been verified here. Those require your Google OAuth credentials, installed model/hardware, and deployment environment. Run the documented manual checks before inviting users.

## Other MVP limits

Public repos only; up to 2,500 visible files, 16 initial source reads, and 64 KB per source. Binaries, common secret filenames, and known dependency/build directories are excluded; this is not a full secret scanner. GitHub rate limits can temporarily block imports. Import/symbol extraction is text-based; folder roles are inferred, not verified runtime architecture. Review progress stays in the page session. The original source snapshot beside this folder is historical and unchanged.

## Official references

- Google OAuth setup and token validation: https://developers.google.com/identity/openid-connect/openid-connect
- Ollama API and structured outputs: https://docs.ollama.com/api/chat and https://docs.ollama.com/capabilities/structured-outputs
- Ollama local-only mode: https://docs.ollama.com/faq
- Default model: https://ollama.com/library/qwen2.5-coder:7b
- Ollama Docker setup: https://docs.ollama.com/docker
- Caddy HTTPS: https://caddyserver.com/docs/quick-starts/https

Third-party UI code and its existing notices remain under components and vendor. The model has its own license; it is not redistributed in this ZIP. This handoff does not add a new license to your application source.
