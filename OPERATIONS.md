# Production launch runbook

The durable explanation path uses PostgreSQL as the source of truth, a BullMQ queue in Redis, a public API process, and a private Ollama worker. The legacy `/api/explain` endpoint remains temporarily for compatibility; the browser uses `/api/explanations`.

## Local verification

```bash
docker compose -f compose.dev.yaml up -d
DATABASE_URL=postgresql://peritia:peritia_local_only@127.0.0.1:5433/peritia npm run db:migrate
npm test
DATABASE_URL=postgresql://peritia:peritia_local_only@127.0.0.1:5433/peritia npm run test:integration
npm run build
```

Set `DATABASE_URL`, `REDIS_URL`, `OLLAMA_MODEL_DIGEST`, and the AI limits in `.env`. Run the API and worker separately:

```bash
npm run start:api
npm run start:worker
```

Only Google accounts receive the three-credit trial because their email identity is provider-verified. Password accounts can sign in and subscribe, but do not receive trial credits until an email-verification flow is added.

## Lemon Squeezy test mode

Create one monthly subscription variant and a webhook for:

- `order_created`
- `subscription_created`, `subscription_updated`, `subscription_cancelled`, and `subscription_expired`
- `subscription_payment_success` and `subscription_payment_recovered`

Point it to `https://YOUR_DOMAIN/api/billing/webhook`, then set the `LEMONSQUEEZY_*` variables from `.env.example`. Use a temporary HTTPS tunnel only for local test-mode delivery. Verify duplicate delivery, a bad signature, cancellation grace time, expiry, failed/recovered renewal, and out-of-order updates. Checkout redirects never grant credits; only a verified paid order/invoice event does.

Before live mode, change `LEMONSQUEEZY_TEST_MODE=false`, use live IDs/secrets, and repeat the complete suite. Do not enable plan changes or prorations; this implementation deliberately supports one server-mapped variant.

## Staging and load test

Provision the API, PostgreSQL, and Redis in compatible regions. Put the GPU worker and Ollama on a private network; port 11434 must not be public. Pin the tested Ollama container/model digest. Check `nvidia-smi`, pull and warm the model, and record first-token time, completion time, GPU memory, and quality for the fixtures in `tests/fixtures/accuracy`.

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

Manually stop/restart the worker, Redis, and Ollama; reconnect SSE clients; replay webhook payloads; reuse idempotency keys; and request another user's job UUID. Expected behavior is recovery or a visible terminal failure, never duplicate consumption or cross-user access.

## Release and rollback

1. Back up PostgreSQL and test restoration.
2. Run `npm test`, `npm run test:integration`, and `npm run build`.
3. Run migrations once as a release job; do not race migrations in API replicas.
4. Deploy API, then worker. Check `/api/health/live` and `/api/health/ready`.
5. Generate one uncached staging explanation, reconnect mid-stream, sign in with Google, and complete a test checkout.
6. Monitor failed jobs, oldest outbox/queue age, worker heartbeat age, billing events with `processed_at IS NULL`, quota totals, and Redis/PostgreSQL capacity.

Rollback application containers without rolling back a successfully applied schema migration. The migrations are additive. Stop accepting checkout traffic if billing reconciliation is unhealthy.

## GitHub App migration

Register a GitHub App with read-only repository metadata and contents permissions, install it on a test account, and set `GITHUB_APP_ID`, `GITHUB_INSTALLATION_ID`, and `GITHUB_APP_PRIVATE_KEY`. The centralized client generates a short-lived App JWT and caches one-hour installation tokens. Test removed/suspended installations and token refresh.

This global installation credential covers repositories available to that installation. Arbitrary public repositories still use `GITHUB_TOKEN` or unauthenticated access when App credentials are absent. Do not revoke the PAT until the App-backed access pattern covers the repositories the product promises; caching remains necessary in either case.

## Launch gates

Do not accept live subscriptions until authentication/logout, backup restoration, source-secret exclusions, rate limits, atomic quota tests, webhook lifecycle tests, SSE reconnection, cancellation/support links, pricing copy, and monitoring alerts have all passed in staging. Begin with an invited beta and review failures daily.
