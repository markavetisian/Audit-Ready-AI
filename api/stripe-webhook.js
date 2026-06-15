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

  if (webhookSecret && sig) {
    try {
      const { createHmac } = await import('crypto');
      const parts = sig.split(',');
      const ts = parts.find(p => p.startsWith('t='))?.slice(2);
      const v1 = parts.find(p => p.startsWith('v1='))?.slice(3);
      if (!ts || !v1) {
        console.error('Stripe webhook: invalid signature format — missing t= or v1= parts. sig header:', sig?.slice(0, 60));
        return res.status(400).json({ error: 'Invalid signature format' });
      }
      const payload = `${ts}.${rawBody.toString()}`;
      const expected = createHmac('sha256', webhookSecret).update(payload).digest('hex');
      if (expected !== v1) {
        console.error('Stripe webhook: signature mismatch. Event timestamp:', ts, 'Body length:', rawBody.length);
        return res.status(400).json({ error: 'Signature mismatch' });
      }
    } catch (err) {
      console.error('Stripe webhook: signature verification exception:', err.message);
      return res.status(400).json({ error: 'Signature verification failed' });
    }
  } else if (!webhookSecret) {
    console.warn('Stripe webhook: STRIPE_WEBHOOK_SECRET not set — skipping signature verification. Set this in production.');
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
      if (!sub.cancel_at_period_end) await upgradeUserMode(userId, 'sandbox', null);
    } else {
      console.warn('Stripe webhook: subscription.deleted missing metadata.userId — subscription:', sub.id);
    }
  }

  return res.status(200).json({ received: true });
}
