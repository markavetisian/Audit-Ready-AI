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
  'price_1ThZIZFQiRRnlhwuYRI3MfNX': 'starter',
  'price_1ThZLSFQiRRnlhwueStdff4L': 'growth',
  'price_1ThZNGFQiRRnlhwuH23alwzB': 'enterprise',
};

export const config = { api: { bodyParser: false } };

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

  if (event.type === 'invoice.payment_succeeded') {
    const invoice = event.data.object;
    const subscriptionId = invoice.subscription;
    // Try multiple metadata locations for userId
    const userId =
      invoice.subscription_details?.metadata?.userId ||
      invoice.metadata?.userId ||
      invoice.customer_email; // fallback to email as userId key
    const priceId = invoice.lines?.data?.[0]?.price?.id;
    const mode = PRICE_TO_MODE[priceId];
    console.log(`Stripe invoice.payment_succeeded: userId=${userId}, priceId=${priceId}, mode=${mode}, subscriptionId=${subscriptionId}`);
    if (userId && mode) {
      await upgradeUserMode(userId, mode, subscriptionId);
    } else {
      console.warn('Stripe webhook: invoice.payment_succeeded — could not resolve userId or mode', { userId, priceId, mode });
    }
  }

  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.created') {
    const sub = event.data.object;
    const userId = sub.metadata?.userId;
    const priceId = sub.items?.data?.[0]?.price?.id;
    const mode = PRICE_TO_MODE[priceId];
    console.log(`Stripe ${event.type}: userId=${userId}, priceId=${priceId}, mode=${mode}, status=${sub.status}`);
    if (userId && mode && sub.status === 'active') {
      await upgradeUserMode(userId, mode, sub.id);
    } else if (!userId) {
      console.warn('Stripe webhook: subscription event missing metadata.userId — subscription:', sub.id);
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object;
    const userId = sub.metadata?.userId;
    console.log(`Stripe customer.subscription.deleted: userId=${userId}, cancel_at_period_end=${sub.cancel_at_period_end}`);
    if (userId) {
      // Subscription no longer exists — always drop to sandbox.
      await upgradeUserMode(userId, 'sandbox', null);
    } else {
      console.warn('Stripe webhook: subscription.deleted missing metadata.userId — subscription:', sub.id);
    }
  }

  return res.status(200).json({ received: true });
}
