# Production launch runbook

The zero-cost beta runs on one Oracle Always Free ARM VM. PostgreSQL is the source of truth, Redis/BullMQ carries durable job IDs, and the worker streams Gemini 2.5 Flash-Lite results. The legacy local `/api/explain` endpoint remains for development compatibility; production browsers use `/api/explanations`.

## Local verification

```bash
docker compose -f compose.dev.yaml up -d
DATABASE_URL=postgresql://peritia:peritia_local_only@127.0.0.1:5433/peritia npm run db:migrate
npm test
DATABASE_URL=postgresql://peritia:peritia_local_only@127.0.0.1:5433/peritia npm run test:integration
npm run build
```

Set `DATABASE_URL`, `REDIS_URL`, the provider variables, and AI limits in `.env`. Local development can use Ollama; production Compose supplies `AI_PROVIDER=gemini`.

```bash
npm run start:api
npm run start:worker
```

Only Google accounts receive the three-credit trial because their email identity is provider-verified. With `BILLING_ENABLED=false`, only the trial bucket is eligible and all billing HTTP routes and background processing are disabled. Password accounts can sign in but receive no explanation credit until email verification exists.

## Oracle Always Free beta

1. Create one Always Free `VM.Standard.A1.Flex` instance in the chosen US home region with 2 OCPUs, 12 GB RAM, Ubuntu, and a 50 GB boot volume.
2. Restrict SSH to your IP. Allow public TCP 80/443. Never expose 3001, 5432, or 6379.
3. Install Docker Engine and its Compose plugin, add the deploy user to the Docker group, then clone the repository with a read-only deploy key.
4. Point a hostname to the VM. Caddy obtains HTTPS automatically.
5. Copy `.env.example` to `.env`, set restrictive permissions, and configure:

```dotenv
DOMAIN=peritia.example.com
JWT_SECRET=REPLACE_WITH_AT_LEAST_32_RANDOM_BYTES
POSTGRES_PASSWORD=REPLACE_WITH_A_DIFFERENT_RANDOM_SECRET
GEMINI_API_KEY=REPLACE_WITH_SERVER_SIDE_KEY
GEMINI_MODEL=gemini-3.5-flash-lite
GEMINI_BILLING_TIER=free
GEMINI_INPUT_USD_PER_MILLION=0.30
GEMINI_OUTPUT_USD_PER_MILLION=2.50
AI_MODEL_REVISION=gemini-3.5-flash-lite-whole-file-v1
AI_PROMPT_VERSION=explanation-v3
AI_MAX_OUTPUT_TOKENS=16384
BILLING_ENABLED=false
```

6. Create the Google OAuth web client and authorize `https://YOUR_DOMAIN/api/auth/google/callback`; the trial intentionally depends on Google-verified identity.
7. Run `docker compose up -d --build`, then check `/api/health/live`, `/api/health/ready`, and one uncached explanation.

The Gemini key stays in API/worker container environments and is never shipped to the browser. Restrict it to the Gemini API in Google Cloud. Free-tier prompts may be used by Google to improve its products, so this beta accepts public repositories only and the UI states that selected public source is sent to the configured provider.

## Usage and cost review

Gemini's final streaming response supplies token usage. Migration `006_ai_generation_usage.sql` stores one row per provider attempt, including failed attempts, model version, latency, token counts, and cost estimates. Run:

```bash
docker compose exec api npm run ai:costs
```

`estimated_list_cost_usd` models the configured paid price. `estimated_billed_cost_usd` remains zero while `GEMINI_BILLING_TIER=free`. Before switching tiers, update the two per-million-token price variables from Google's pricing page and change `GEMINI_BILLING_TIER=paid`.

## Billing remains off

Do not configure live Lemon Squeezy credentials during the free beta. Leave `BILLING_ENABLED=false`; the UI hides upgrade controls and the server does not mount billing endpoints. The existing billing implementation remains dormant for a later tested launch.

## Future Lemon Squeezy test mode

Create one monthly subscription variant and a webhook for:

- `order_created`
- `subscription_created`, `subscription_updated`, `subscription_cancelled`, and `subscription_expired`
- `subscription_payment_success` and `subscription_payment_recovered`

Point it to `https://YOUR_DOMAIN/api/billing/webhook`, then set the `LEMONSQUEEZY_*` variables from `.env.example`. Use a temporary HTTPS tunnel only for local test-mode delivery. Verify duplicate delivery, a bad signature, cancellation grace time, expiry, failed/recovered renewal, and out-of-order updates. Checkout redirects never grant credits; only a verified paid order/invoice event does.

Before live mode, change `LEMONSQUEEZY_TEST_MODE=false`, use live IDs/secrets, and repeat the complete suite. Do not enable plan changes or prorations; this implementation deliberately supports one server-mapped variant.

## Staging and load test

Run the API, worker, PostgreSQL, and Redis on the same beta VM. Record first-token time, completion time, provider token use, cost, and quality for the fixtures in `tests/fixtures/accuracy`.

Create ten staging accounts, then grant isolated staging credits without adding a public bypass:

```bash
npm run staging:grant -- user1@example.com user2@example.com
```

Supply ten distinct source requests and run `load/k6-ten-users.js`. Keep a separate cached run so cache hits cannot disguise queue latency:

```bash
k6 run \
  -e BASE_URL=https://staging.example.com \
  -e TEST_USERS='[{"email":"...","password":"..."}]' \
  -e TEST_INPUTS='[{"repositoryId":"owner/repo","commit":"40_HEX","path":"src/a.ts","page":0,"level":"beginner"}]' \
  load/k6-ten-users.js
```

Manually stop/restart the worker and Redis; reconnect SSE clients; reuse idempotency keys; and request another user's job UUID. Expected behavior is recovery or a visible terminal failure, never duplicate consumption or cross-user access.

## Release and rollback

1. Back up PostgreSQL and test restoration.
2. Run `npm test`, `npm run test:integration`, and `npm run build`.
3. Run migrations once as a release job; do not race migrations in API replicas.
4. Deploy API, then worker. Check `/api/health/live` and `/api/health/ready`.
5. Generate one uncached explanation, reconnect mid-stream, and confirm a Google user cannot exceed three successful unlocks.
6. Monitor failed jobs, oldest outbox/queue age, worker heartbeat age, AI cost rows, quota totals, and Redis/PostgreSQL capacity.

Rollback application containers without rolling back a successfully applied schema migration. The migrations are additive. Stop accepting checkout traffic if billing reconciliation is unhealthy.

## GitHub App migration

Register a GitHub App with read-only repository metadata and contents permissions, install it on a test account, and set `GITHUB_APP_ID`, `GITHUB_INSTALLATION_ID`, and `GITHUB_APP_PRIVATE_KEY`. The centralized client generates a short-lived App JWT and caches one-hour installation tokens. Test removed/suspended installations and token refresh.

This global installation credential covers repositories available to that installation. Arbitrary public repositories still use `GITHUB_TOKEN` or unauthenticated access when App credentials are absent. Do not revoke the PAT until the App-backed access pattern covers the repositories the product promises; caching remains necessary in either case.

## Launch gates

Do not accept live subscriptions until authentication/logout, backup restoration, source-secret exclusions, rate limits, atomic quota tests, webhook lifecycle tests, SSE reconnection, cancellation/support links, pricing copy, and monitoring alerts have all passed in staging. Begin with an invited beta and review failures daily.
