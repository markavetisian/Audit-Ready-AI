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
  'price_1Tcq4kFQiRRnlhwuthAHX32Z': 'starter',
  'price_1TcqCPFQiRRnlhwu7pzdaXHQ': 'growth',
  'price_1TcqDYFQiRRnlhwucV6hP5ok': 'god',
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
      if (!ts || !v1) return res.status(400).json({ error: 'Invalid signature format' });
      const payload = `${ts}.${rawBody.toString()}`;
      const expected = createHmac('sha256', webhookSecret).update(payload).digest('hex');
      if (expected !== v1) return res.status(400).json({ error: 'Signature mismatch' });
    } catch (err) {
      return res.status(400).json({ error: 'Signature verification failed' });
    }
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
    const userId = invoice.subscription_details?.metadata?.userId || invoice.metadata?.userId;
    const priceId = invoice.lines?.data?.[0]?.price?.id;
    const mode = PRICE_TO_MODE[priceId];
    if (userId && mode) await upgradeUserMode(userId, mode, subscriptionId);
  }

  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.created') {
    const sub = event.data.object;
    const userId = sub.metadata?.userId;
    const priceId = sub.items?.data?.[0]?.price?.id;
    const mode = PRICE_TO_MODE[priceId];
    if (userId && mode && sub.status === 'active') await upgradeUserMode(userId, mode, sub.id);
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object;
    const userId = sub.metadata?.userId;
    if (userId) {
      if (!sub.cancel_at_period_end) await upgradeUserMode(userId, 'sandbox', null);
    }
  }

  return res.status(200).json({ received: true });
}
