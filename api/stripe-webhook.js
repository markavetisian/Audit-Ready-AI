// ─────────────────────────────────────────────────────────────
// api/stripe-webhook.js
// ACTION: KEPT AS-IS — NEVER MODIFIED
// ─────────────────────────────────────────────────────────────

import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const PRICE_TO_MODE = {
  // Monthly
  'price_1ThZIZFQiRRnlhwuYRI3MfNX': 'starter',
  'price_1ThZLSFQiRRnlhwueStdff4L': 'growth',
  'price_1ThZNGFQiRRnlhwuH23alwzB': 'enterprise',
  // Annual
  'price_1Tn4SdFQiRRnlhwuMooey0i2': 'starter',
  'price_1Tn4TsFQiRRnlhwuodI5siQL': 'growth',
  'price_1Tn4UZFQiRRnlhwuA5yXrU8O': 'enterprise',
  // Monitoring (retention floor)
  'price_1Tn4msFQiRRnlhwuHO0T0eeS': 'monitoring',
};

const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;

export const config = { api: { bodyParser: false } };

// Only ever key account state on a real app user id (github:/google:/slack:).
function isValidUserKey(uid) {
  return typeof uid === 'string' && /^(github:|google:|slack:)/.test(uid);
}

// Resolve the app userId for a Stripe event WITHOUT trusting a raw email.
// Order: subscription/invoice metadata → reverse index (written at checkout) →
// live Stripe customer.metadata.userId. Returns null if it can't be resolved.
async function resolveUserId(metaUserId, customerId) {
  if (isValidUserKey(metaUserId)) return metaUserId;
  if (customerId) {
    try {
      const mapped = await redis.get(`stripe:customer:${customerId}`);
      if (isValidUserKey(mapped)) return mapped;
    } catch {}
    if (STRIPE_SECRET) {
      try {
        const r = await fetch(`https://api.stripe.com/v1/customers/${customerId}`, {
          headers: { Authorization: `Bearer ${STRIPE_SECRET}` },
        });
        const cust = await r.json();
        if (isValidUserKey(cust?.metadata?.userId)) {
          // Backfill the reverse index for next time.
          await redis.set(`stripe:customer:${customerId}`, cust.metadata.userId).catch(() => {});
          return cust.metadata.userId;
        }
      } catch {}
    }
  }
  return null;
}

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(typeof c === 'string' ? Buffer.from(c) : c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function upgradeUserMode(userId, mode, subscriptionId) {
  if (!userId || !mode) return;
  try {
    const key = `admin:user:${userId}`;
    let userData = {};
    try { userData = (await redis.get(key)) || {}; } catch {}
    await redis.set(key, JSON.stringify({
      ...userData,
      mode,
      stripeSubscriptionId: subscriptionId,
      upgradedAt: Date.now(),
    }));
    console.log(`✅ Upgraded ${userId} to ${mode}`);
  } catch (err) {
    console.error('upgradeUserMode error:', err.message);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  // Fail closed: never process an unverified event. A missing secret or
  // signature means we cannot trust the payload, so we reject it outright.
  if (!webhookSecret) {
    console.error('Stripe webhook: STRIPE_WEBHOOK_SECRET not configured — rejecting event.');
    return res.status(500).json({ error: 'Webhook not configured' });
  }
  if (!sig) {
    return res.status(400).json({ error: 'Missing signature' });
  }
  try {
    const { createHmac, timingSafeEqual } = await import('crypto');
    const parts = sig.split(',');
    const ts = parts.find(p => p.startsWith('t='))?.slice(2);
    const v1 = parts.find(p => p.startsWith('v1='))?.slice(3);
    if (!ts || !v1) {
      console.error('Stripe webhook: invalid signature format. sig header:', sig?.slice(0, 60));
      return res.status(400).json({ error: 'Invalid signature format' });
    }
    // Reject events older than 5 minutes to prevent replay attacks.
    const tsNum = Number(ts);
    if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > 300) {
      console.error('Stripe webhook: timestamp outside tolerance.', ts);
      return res.status(400).json({ error: 'Timestamp outside tolerance' });
    }
    const payload = `${ts}.${rawBody.toString()}`;
    const expected = createHmac('sha256', webhookSecret).update(payload).digest('hex');
    const expBuf = Buffer.from(expected);
    const gotBuf = Buffer.from(v1);
    if (expBuf.length !== gotBuf.length || !timingSafeEqual(expBuf, gotBuf)) {
      console.error('Stripe webhook: signature mismatch. ts:', ts, 'len:', rawBody.length);
      return res.status(400).json({ error: 'Signature mismatch' });
    }
  } catch (err) {
    console.error('Stripe webhook: signature verification exception:', err.message);
    return res.status(400).json({ error: 'Signature verification failed' });
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString());
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  // Idempotency: Stripe redelivers events. Process each event id at most once so
  // duplicates/out-of-order deliveries can't double-apply or resurrect a plan.
  if (event.id) {
    try {
      const fresh = await redis.set(`webhook:evt:${event.id}`, '1', { nx: true, ex: 604800 });
      if (fresh === null) return res.status(200).json({ received: true, duplicate: true });
    } catch {}
  }

  // Subscription statuses that mean "not in good standing" → drop to sandbox.
  const DOWNGRADE_STATUSES = ['past_due', 'unpaid', 'canceled', 'incomplete_expired', 'paused'];

  if (event.type === 'invoice.payment_succeeded') {
    const invoice = event.data.object;
    const subscriptionId = invoice.subscription;
    const userId = await resolveUserId(
      invoice.subscription_details?.metadata?.userId || invoice.metadata?.userId,
      invoice.customer
    );
    const priceId = invoice.lines?.data?.[0]?.price?.id;
    const mode = PRICE_TO_MODE[priceId];
    if (userId && mode) {
      await upgradeUserMode(userId, mode, subscriptionId);
    } else {
      console.warn('Stripe webhook: invoice.payment_succeeded — could not resolve userId or mode', { priceId, mode });
    }
  }

  if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object;
    const userId = await resolveUserId(
      invoice.subscription_details?.metadata?.userId || invoice.metadata?.userId,
      invoice.customer
    );
    // Don't kill access on the very first retry-able failure; Stripe will move
    // the subscription to past_due/unpaid, which we downgrade on below. Just log.
    console.warn('Stripe webhook: invoice.payment_failed', { userId, sub: invoice.subscription });
  }

  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.created') {
    const sub = event.data.object;
    const userId = await resolveUserId(sub.metadata?.userId, sub.customer);
    const priceId = sub.items?.data?.[0]?.price?.id;
    const mode = PRICE_TO_MODE[priceId];
    if (!userId) {
      console.warn('Stripe webhook: subscription event could not resolve userId — subscription:', sub.id);
    } else if (sub.status === 'active' && mode) {
      await upgradeUserMode(userId, mode, sub.id);
    } else if (DOWNGRADE_STATUSES.includes(sub.status)) {
      // Card failed / sub no longer active → revoke paid access (no "paid forever").
      await upgradeUserMode(userId, 'sandbox', null);
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object;
    const userId = await resolveUserId(sub.metadata?.userId, sub.customer);
    if (userId) {
      await upgradeUserMode(userId, 'sandbox', null);
    } else {
      console.warn('Stripe webhook: subscription.deleted could not resolve userId — subscription:', sub.id);
    }
  }

  return res.status(200).json({ received: true });
}
