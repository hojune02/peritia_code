import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import type { Pool } from "pg";
import { RepoError } from "../lib/repository";

export function verifyWebhook(rawBody: Buffer, signature: string | undefined, secret: string) {
  if (!secret || !signature || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const received = Buffer.from(signature, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

type BillingOptions = {
  apiKey: string;
  storeId: string;
  variantId: string;
  webhookSecret: string;
  testMode: boolean;
  appUrl: string;
  paidAllowance: number;
};

export class BillingService {
  constructor(private pool: Pool, private options: BillingOptions) {}

  async checkout(user: { id: string; email: string }) {
    if (!this.options.apiKey || !this.options.storeId || !this.options.variantId)
      throw new RepoError("Billing is not configured.", 503);
    const active = await this.pool.query(
      `SELECT 1 FROM billing_subscriptions
       WHERE user_id=$1 AND (status IN ('active','on_trial','paused') OR (status='cancelled' AND paid_through > NOW()))
       LIMIT 1`,
      [user.id],
    );
    if (active.rows[0]) throw new RepoError("You already have an active subscription.", 409);
    const payload = {
      data: {
        type: "checkouts",
        attributes: {
          test_mode: this.options.testMode,
          product_options: { redirect_url: `${this.options.appUrl}/?billing=success`, enabled_variants: [Number(this.options.variantId)] },
          checkout_data: { email: user.email, custom: { user_id: user.id } },
        },
        relationships: {
          store: { data: { type: "stores", id: this.options.storeId } },
          variant: { data: { type: "variants", id: this.options.variantId } },
        },
      },
    };
    const response = await fetch("https://api.lemonsqueezy.com/v1/checkouts", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.options.apiKey}`, Accept: "application/vnd.api+json", "Content-Type": "application/vnd.api+json" },
      body: JSON.stringify(payload),
    });
    const body: any = await response.json().catch(() => null);
    const url = body?.data?.attributes?.url;
    if (!response.ok || typeof url !== "string" || !url.startsWith("https://"))
      throw new RepoError("Checkout could not be created.", 502);
    return { url };
  }

  webhook: RequestHandler = async (req, res, next) => {
    try {
      const raw = req.body;
      if (!Buffer.isBuffer(raw) || !verifyWebhook(raw, req.get("X-Signature"), this.options.webhookSecret)) {
        res.status(401).json({ error: "Invalid webhook signature." });
        return;
      }
      const payload = JSON.parse(raw.toString("utf8"));
      const attributes = payload?.data?.attributes;
      const meta = payload?.meta;
      if (String(attributes?.store_id) !== this.options.storeId || Boolean(attributes?.test_mode) !== this.options.testMode)
        throw new RepoError("Webhook environment does not match.", 400);
      const hash = createHash("sha256").update(raw).digest("hex");
      const inserted = await this.pool.query(
        `INSERT INTO billing_events(payload_hash,event_name,resource_id,payload)
         VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING payload_hash`,
        [hash, String(meta?.event_name || "unknown"), String(payload?.data?.id || ""), payload],
      );
      res.status(200).json({ accepted: true, duplicate: !inserted.rows[0] });
      if (inserted.rows[0]) void this.process(hash).catch((error) => console.error("Billing event processing failed:", error));
    } catch (error) { next(error); }
  };

  async process(hash: string) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query(`SELECT * FROM billing_events WHERE payload_hash=$1 AND processed_at IS NULL FOR UPDATE`, [hash]);
      const event = found.rows[0];
      if (!event) { await client.query("COMMIT"); return; }
      const payload = event.payload;
      const name = event.event_name;
      const a = payload.data.attributes || {};
      const stateEvent = name.startsWith("subscription_") && !name.startsWith("subscription_payment_");
      const subscriptionId = String(a.subscription_id || (stateEvent ? payload.data.id : ""));
      let userId = payload.meta?.custom_data?.user_id;
      let knownSubscription: any;
      if (!userId && subscriptionId) {
        const known = await client.query(`SELECT * FROM billing_subscriptions WHERE provider_subscription_id=$1`, [subscriptionId]);
        knownSubscription = known.rows[0];
        userId = knownSubscription?.user_id;
      }
      if (!userId) throw new Error("BILLING_USER_NOT_FOUND");
      if (!knownSubscription && subscriptionId) {
        const known = await client.query(`SELECT * FROM billing_subscriptions WHERE provider_subscription_id=$1`, [subscriptionId]);
        knownSubscription = known.rows[0];
      }
      const variantId = a.variant_id ?? a.first_order_item?.variant_id ?? knownSubscription?.variant_id;
      if (String(variantId) !== this.options.variantId) throw new Error("BILLING_VARIANT_MISMATCH");

      if (stateEvent) {
        const updated = new Date(a.updated_at || a.created_at);
        if (!Number.isFinite(updated.valueOf())) throw new Error("BILLING_TIMESTAMP_INVALID");
        await client.query(
          `INSERT INTO billing_subscriptions
            (user_id,provider_subscription_id,provider_customer_id,variant_id,status,test_mode,portal_url,paid_through,provider_updated_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT(user_id) DO UPDATE SET
             provider_subscription_id=EXCLUDED.provider_subscription_id,
             provider_customer_id=EXCLUDED.provider_customer_id,
             variant_id=EXCLUDED.variant_id,status=EXCLUDED.status,
             portal_url=EXCLUDED.portal_url,paid_through=EXCLUDED.paid_through,
             provider_updated_at=EXCLUDED.provider_updated_at
           WHERE billing_subscriptions.provider_updated_at <= EXCLUDED.provider_updated_at`,
          [userId, subscriptionId, String(a.customer_id || ""), String(a.variant_id), String(a.status), Boolean(a.test_mode), a.urls?.customer_portal || null, a.ends_at || a.renews_at || null, updated],
        );
      }

      if (["subscription_payment_success", "subscription_payment_recovered", "order_created"].includes(name)) {
        if (a.status && a.status !== "paid") throw new Error("BILLING_PAYMENT_NOT_PAID");
        const starts = new Date(a.created_at || payload.meta?.test_mode_created_at);
        const knownEnd = knownSubscription?.paid_through ? new Date(knownSubscription.paid_through) : null;
        const ends = knownEnd && knownEnd > starts ? knownEnd : new Date(starts.valueOf() + 31 * 86400_000);
        const paymentId = String(a.order_id || a.invoice_id || payload.data.id);
        const entitlement = subscriptionId || `order-${payload.data.id}`;
        const periodKey = `paid:${entitlement}:${starts.toISOString()}:${paymentId}`;
        await client.query(
          `INSERT INTO usage_buckets(id,user_id,period_key,allowance,starts_at,expires_at)
           VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,period_key) DO NOTHING`,
          [randomUUID(), userId, periodKey, this.options.paidAllowance, starts, ends],
        );
      }
      await client.query(`UPDATE billing_events SET processed_at=NOW(),error_code=NULL WHERE payload_hash=$1`, [hash]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      await this.pool.query(`UPDATE billing_events SET error_code=$2,attempts=attempts+1 WHERE payload_hash=$1`, [hash, error instanceof Error ? error.message : "BILLING_PROCESSING_FAILED"]);
      throw error;
    } finally { client.release(); }
  }

  async portal(userId: string) {
    const found = await this.pool.query(`SELECT provider_subscription_id FROM billing_subscriptions WHERE user_id=$1`, [userId]);
    const id = found.rows[0]?.provider_subscription_id;
    if (!id || !this.options.apiKey) return { url: null };
    const response = await fetch(`https://api.lemonsqueezy.com/v1/subscriptions/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${this.options.apiKey}`, Accept: "application/vnd.api+json" },
    });
    const body: any = await response.json().catch(() => null);
    const url = body?.data?.attributes?.urls?.customer_portal;
    if (!response.ok || typeof url !== "string" || !url.startsWith("https://"))
      throw new RepoError("The subscription portal is unavailable.", 502);
    await this.pool.query(`UPDATE billing_subscriptions SET portal_url=$2 WHERE user_id=$1`, [userId, url]);
    return { url };
  }

  startProcessor() {
    let active = false;
    const run = async () => {
      if (active) return;
      active = true;
      try {
        const pending = await this.pool.query(
          `SELECT payload_hash FROM billing_events
           WHERE processed_at IS NULL AND attempts < 10
           ORDER BY received_at LIMIT 20`,
        );
        for (const row of pending.rows) await this.process(row.payload_hash).catch(() => undefined);
      } finally { active = false; }
    };
    const timer = setInterval(() => void run(), 5_000);
    timer.unref();
    void run();
    return () => clearInterval(timer);
  }
}

export function billingOptions(env = process.env): BillingOptions {
  return {
    apiKey: env.LEMONSQUEEZY_API_KEY || "",
    storeId: env.LEMONSQUEEZY_STORE_ID || "",
    variantId: env.LEMONSQUEEZY_VARIANT_ID || "",
    webhookSecret: env.LEMONSQUEEZY_WEBHOOK_SECRET || "",
    testMode: env.LEMONSQUEEZY_TEST_MODE !== "false",
    appUrl: env.APP_URL || env.APP_ORIGIN || "http://localhost:5173",
    paidAllowance: Number(env.PAID_MONTHLY_ALLOWANCE || 100),
  };
}
