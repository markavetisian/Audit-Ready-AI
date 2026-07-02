// ─────────────────────────────────────────────────────────────
// api/lead.js
// ACTION: NEW
//
//   POST /api/lead   → capture a top-of-funnel lead (NO AUTH required)
//
// Powers the no-login "Instant SOC 2 Readiness Estimate" on the landing
// page. A cold visitor (from an ad or cold email) answers a short quiz,
// gets their score in-browser, and drops their email to unlock the full
// fix plan. We store the lead so the founder can follow up and so paid
// ad clicks are never wasted — even a visitor who doesn't connect their
// stack becomes a captured, qualified lead.
//
// Public + unauthenticated by design, so it validates and caps every
// field and never trusts size/shape of the incoming body.
// ─────────────────────────────────────────────────────────────

import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

function setCors(req, res) {
  const origin = req.headers.origin || '';
  const allowed = /^https:\/\/(auditready\.space|[a-z0-9-]+\.vercel\.app)$/i.test(origin);
  res.setHeader('Access-Control-Allow-Origin', allowed ? origin : 'https://auditready.space');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { email, score, answers, gaps, source } = req.body || {};
    if (!email || typeof email !== 'string' || !EMAIL_RE.test(email) || email.length > 200) {
      return res.status(400).json({ error: 'Valid email required' });
    }
    const cleanEmail = email.toLowerCase().trim().slice(0, 200);
    const s = Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : null;

    const rec = {
      email: cleanEmail,
      score: s,
      // Keep answers small + plain — only a flat map of booleans is expected.
      answers: (answers && typeof answers === 'object' && !Array.isArray(answers))
        ? Object.fromEntries(Object.entries(answers).slice(0, 20).map(([k, v]) => [String(k).slice(0, 40), !!v]))
        : null,
      gaps: Array.isArray(gaps) ? gaps.slice(0, 12).map(g => String(g).slice(0, 160)) : null,
      source: (typeof source === 'string' ? source : 'estimate').slice(0, 40),
      ts: Date.now(),
    };

    // Key by email so a repeat submission updates the same lead instead of
    // creating duplicates; preserve the original firstSeen timestamp.
    const key = 'lead:' + cleanEmail;
    let existing = null;
    try { existing = await redis.get(key); } catch {}
    await redis.set(key, JSON.stringify({
      ...(existing && typeof existing === 'object' ? existing : {}),
      ...rec,
      firstSeen: (existing && existing.firstSeen) || rec.ts,
    }));

    // Maintain a capped, newest-first index the founder can scan for follow-up.
    try {
      await redis.lpush('leads:index', cleanEmail + '|' + rec.ts);
      await redis.ltrim('leads:index', 0, 4999);
    } catch {}

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Lead capture error:', err.message);
    return res.status(500).json({ error: 'Could not save. Please try again.' });
  }
}
