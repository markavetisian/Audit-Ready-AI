// ─────────────────────────────────────────────────────────────
// api/billing.js
// ACTION: MERGED from stripe-checkout.js + stripe-cancel.js
//
//   POST   /api/billing → create subscription checkout (was stripe-checkout.js)
//   DELETE /api/billing → cancel subscription at period end (was stripe-cancel.js)
//
// Logic: identical to originals. Method router only change.
// api/stripe-webhook.js: UNTOUCHED — never modified.
// ─────────────────────────────────────────────────────────────

import { Redis } from '@upstash/redis';
import { verifySession } from './_telemetry.js';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;

const PRICE_TO_MODE = {
  // Monthly
  'price_1ThZIZFQiRRnlhwuYRI3MfNX': 'starter',
  'price_1ThZLSFQiRRnlhwueStdff4L': 'growth',
  'price_1ThZNGFQiRRnlhwuH23alwzB': 'enterprise',
  // Annual
  'price_1Tn4SdFQiRRnlhwuMooey0i2': 'starter',
  'price_1Tn4TsFQiRRnlhwuodI5siQL': 'growth',
  'price_1Tn4UZFQiRRnlhwuA5yXrU8O': 'enterprise',
};

// Restrict CORS to known app origins (not "*") on this money-handling endpoint.
function setCors(req, res) {
  const origin = req.headers.origin || '';
  const allowed = /^https:\/\/(auditready\.space|[a-z0-9-]+\.vercel\.app)$/i.test(origin);
  res.setHeader('Access-Control-Allow-Origin', allowed ? origin : 'https://auditready.space');
  res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// Resolve the authenticated user's id server-side. Never trust a
// client-supplied userId for billing actions.
async function getUserId(authHeader) {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  if (token.startsWith('s1.')) return verifySession(token);
  if (token.startsWith('google:') || token.startsWith('slack:')) return null;
  try {
    const r = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'AuditReady-AI' },
    });
    if (!r.ok) return null;
    const u = await r.json();
    return 'github:' + u.login;
  } catch { return null; }
}

async function stripePost(path, body) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body),
  });
  return res.json();
}

async function stripeGet(path) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${STRIPE_SECRET}` },
  });
  return res.json();
}

async function stripePatch(path, body) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body),
  });
  return res.json();
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── POST confirm: verify a paid subscription and unlock the plan ──
  // This makes payment → unlock work immediately and reliably, instead of
  // depending solely on the Stripe webhook (which may lag or be misconfigured).
  if (req.method === 'POST' && req.body?.action === 'confirm') {
    const userId = await getUserId(req.headers.authorization);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const { subscriptionId } = req.body || {};
    if (!subscriptionId) return res.status(400).json({ error: 'Missing subscriptionId' });
    try {
      const sub = await stripeGet(`subscriptions/${subscriptionId}?expand[]=latest_invoice`);
      if (sub.error) return res.status(400).json({ error: 'Could not verify subscription' });
      // Ownership check (fail closed): the subscription must positively belong
      // to this user. A subscription with no/ mismatched userId metadata is
      // rejected so a caller can't confirm someone else's (or a foreign) sub.
      if (sub.metadata?.userId !== userId) {
        return res.status(403).json({ error: 'Subscription does not belong to this account' });
      }
      const priceId = sub.items?.data?.[0]?.price?.id;
      const mode = PRICE_TO_MODE[priceId];
      // Only unlock once the FIRST invoice is actually paid — not merely because
      // the subscription reports "active" (it can briefly before capture). This
      // prevents granting paid access without a captured payment.
      const invoicePaid = sub.latest_invoice?.status === 'paid';
      const paid = (sub.status === 'active' && invoicePaid) || sub.status === 'trialing';
      if (!paid || !mode) {
        return res.status(200).json({ ok: false, status: sub.status, mode: null });
      }
      const userKey = `admin:user:${userId}`;
      let userData = {};
      try { userData = (await redis.get(userKey)) || {}; } catch {}
      await redis.set(userKey, JSON.stringify({
        ...userData,
        mode,
        stripeSubscriptionId: sub.id,
        upgradedAt: Date.now(),
      }));
      return res.status(200).json({ ok: true, mode });
    } catch (err) {
      console.error('Confirm error:', err.message);
      return res.status(500).json({ error: 'Could not confirm subscription' });
    }
  }

  // ── POST: Create Stripe subscription checkout ────────────────
  if (req.method === 'POST') {
    const userId = await getUserId(req.headers.authorization);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const { priceId, email } = req.body || {};
    if (!priceId || !email) {
      return res.status(400).json({ error: 'Missing priceId or email' });
    }
    // Derive the plan from the price table server-side. The client never gets to
    // assert its own `mode`, and only known price IDs are accepted.
    const mode = PRICE_TO_MODE[priceId];
    if (!mode) {
      return res.status(400).json({ error: 'Unknown price' });
    }
    try {
      const userKey = `admin:user:${userId}`;
      let userData = {};
      try { userData = (await redis.get(userKey)) || {}; } catch {}
      let customerId = userData.stripeCustomerId;

      if (!customerId) {
        const customer = await stripePost('customers', { email, metadata: { userId } });
        if (customer.error) throw new Error(customer.error.message);
        customerId = customer.id;
        await redis.set(userKey, JSON.stringify({ ...userData, stripeCustomerId: customerId }));
        // Reverse index so the webhook can resolve userId from a customer id
        // without ever falling back to a raw (user-controlled) email.
        await redis.set(`stripe:customer:${customerId}`, userId).catch(() => {});
      }

      const subscription = await stripePost('subscriptions', {
        customer: customerId,
        'items[0][price]': priceId,
        payment_behavior: 'default_incomplete',
        payment_settings: 'save_default_payment_method=on_subscription',
        'expand[0]': 'latest_invoice.payment_intent',
        'metadata[userId]': userId,
        'metadata[mode]': mode,
      });
      if (subscription.error) throw new Error(subscription.error.message);

      const clientSecret = subscription.latest_invoice?.payment_intent?.client_secret;
      if (!clientSecret) throw new Error('Could not create payment intent');

      return res.status(200).json({ clientSecret, subscriptionId: subscription.id });
    } catch (err) {
      console.error('Stripe checkout error:', err.message);
      return res.status(500).json({ error: 'Could not start checkout. Please try again.' });
    }
  }

  // ── DELETE: Cancel subscription at period end ────────────────
  // Identical logic from stripe-cancel.js
  if (req.method === 'DELETE') {
    const userId = await getUserId(req.headers.authorization);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const userKey = `admin:user:${userId}`;
      let userData = {};
      try { userData = (await redis.get(userKey)) || {}; } catch {}
      const subscriptionId = userData.stripeSubscriptionId;
      const customerId = userData.stripeCustomerId;
      let subId = subscriptionId;

      if (!subId && customerId) {
        const subs = await stripeGet(`subscriptions?customer=${customerId}&status=active&limit=1`);
        if (subs.data?.length > 0) subId = subs.data[0].id;
      }

      if (subId) {
        const result = await stripePatch(`subscriptions/${subId}`, {
          cancel_at_period_end: 'true',
        });
        if (result.error) {
          if (!result.error.message?.includes('No such subscription')) {
            throw new Error(result.error.message);
          }
          // Subscription doesn't exist on Stripe's side — nothing to mark pending.
        } else {
          await redis.set(userKey, JSON.stringify({
            ...userData,
            cancelPending: true,
            cancelAt: result.current_period_end || null,
          }));
        }
      }

      return res.status(200).json({
        ok: true,
        message: 'Subscription will cancel at end of billing period. You keep full access until then.',
      });
    } catch (err) {
      console.error('Cancel error:', err.message);
      return res.status(500).json({ error: 'Could not cancel subscription. Please try again.' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
