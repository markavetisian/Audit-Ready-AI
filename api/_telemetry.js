// ─────────────────────────────────────────────────────────────
// api/telemetry.js
// ACTION: MERGED from analytics.js + log.js + track.js
//
//   POST /api/telemetry?type=analytics → usage analytics (was analytics.js)
//   POST /api/telemetry?type=log       → event logging (was log.js)
//   POST /api/telemetry?type=track     → user event tracking (was track.js)
//   GET  /api/telemetry                → analytics data fetch
//
// REMOVED: agent-specific stats (agent deploys, agent convos, agent leads)
//          GitHub repo scanning (moved to scan.js)
//          agentStats, topQuestions per-agent, recentMessages per-agent
// KEPT:    Redis client, CORS, all passive data write patterns
//          trackUser, isBlocked, checkRateLimit, logError (exported for scan.js/controls.js)
// ─────────────────────────────────────────────────────────────

import { Redis } from '@upstash/redis';
import { createHmac, timingSafeEqual } from 'crypto';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

// ── Signed session tokens (stateless identity for google/slack) ──
// We mint an HMAC-signed token AFTER the OAuth provider verifies the user,
// so the backend can trust the embedded uid without a bare email claim that
// anyone could forge. Falls back to existing server secrets so no new env
// var is strictly required, but SESSION_SECRET is preferred.
function sessionSecret() {
  return process.env.SESSION_SECRET
    || process.env.STRIPE_SECRET_KEY
    || process.env.GITHUB_CLIENT_SECRET
    || 'auditready-insecure-fallback-set-SESSION_SECRET';
}

export function mintSession(uid, ttlDays = 30) {
  const payload = Buffer.from(JSON.stringify({ uid, exp: Date.now() + ttlDays * 86400000 })).toString('base64url');
  const sig = createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
  return `s1.${payload}.${sig}`;
}

export function verifySession(token) {
  try {
    const parts = String(token).split('.');
    if (parts.length !== 3 || parts[0] !== 's1') return null;
    const expected = createHmac('sha256', sessionSecret()).update(parts[1]).digest('base64url');
    const a = Buffer.from(parts[2]);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const data = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (!data.uid || !data.exp || Date.now() > data.exp) return null;
    return data.uid;
  } catch { return null; }
}

// ── Exported helpers (used by scan.js, controls.js, report.js) ─

export async function trackUser(userId, type, email, authType) {
  if (!userId) return;
  try {
    const key = `admin:user:${userId}`;
    const now = Date.now();
    const day = new Date().toISOString().slice(0, 10);
    let user = {};
    try {
      const raw = await redis.get(key);
      if (raw) user = typeof raw === 'object' ? raw : JSON.parse(raw);
    } catch {}

    if (email && !user.email) user.email = email;
    if (authType && !user.authType) user.authType = authType;
    if (!user.userId) user.userId = userId;
    if (!user.signupDate) user.signupDate = now;
    if (!user.status) user.status = 'active';
    user.lastActivity = now;

    if (type === 'login') {
      user.loginCount = (user.loginCount || 0) + 1;
      user.lastLogin = now;
      const isNew = !user.signupDate || (now - user.signupDate) < 5000;
      if (isNew) await redis.incr('admin:stats:total_users').catch(() => {});
      await redis.lpush('admin:logs:auth', JSON.stringify({ userId, email, authType, ts: now, event: 'login' }));
      await redis.ltrim('admin:logs:auth', 0, 499);
    }
    if (type === 'scan') {
      user.scanCount = (user.scanCount || 0) + 1;
      await redis.incr('admin:stats:total_scans').catch(() => {});
    }
    if (type === 'report') {
      user.reportCount = (user.reportCount || 0) + 1;
      await redis.incr('admin:stats:total_reports').catch(() => {});
    }
    if (type === 'scan_fail') {
      user.failedScans = (user.failedScans || 0) + 1;
      await redis.incr('admin:stats:failed_scans').catch(() => {});
    }

    await redis.set(key, JSON.stringify(user));
    await redis.expire(key, 60 * 60 * 24 * 365).catch(() => {});
  } catch (err) {
    console.error('trackUser error:', err.message);
  }
}

export async function isBlocked(userId) {
  if (!userId) return null;
  try {
    const raw = await redis.get(`blocked:${userId}`);
    if (raw) {
      const data = typeof raw === 'object' ? raw : JSON.parse(raw);
      if (data.status === 'banned' || data.status === 'suspended') return data;
    }
    const userRaw = await redis.get(`admin:user:${userId}`);
    if (userRaw) {
      const user = typeof userRaw === 'object' ? userRaw : JSON.parse(userRaw);
      if (user.status === 'banned' || user.status === 'suspended') {
        return { status: user.status };
      }
    }
    return null;
  } catch { return null; }
}

export async function checkRateLimit(userId, type) {
  const limits = { scan: { window: 3600, max: 20 }, report: { window: 3600, max: 10 } };
  const cfg = limits[type];
  if (!cfg) return { ok: true };
  const now = Date.now();
  const key = `rl:${type}:${userId}`;
  try {
    const raw = await redis.get(key);
    let data = raw ? (typeof raw === 'object' ? raw : JSON.parse(raw)) : { count: 0, start: now };
    if ((now - data.start) / 1000 > cfg.window) { data = { count: 0, start: now }; }
    data.count++;
    // Expire on the ORIGINAL window, not a fresh full window each call —
    // otherwise repeated retries after hitting the limit keep extending the
    // TTL and lock the user out indefinitely.
    const ttl = Math.max(cfg.window - Math.floor((now - data.start) / 1000), 1);
    await redis.set(key, JSON.stringify(data), { ex: ttl });
    if (data.count > cfg.max) {
      return { ok: false, retryAfter: ttl, remaining: 0 };
    }
    return { ok: true, remaining: cfg.max - data.count };
  } catch { return { ok: true }; }
}

export async function logError(msg, ctx = {}) {
  try {
    await redis.lpush('admin:logs:error', JSON.stringify({ msg, ...ctx, ts: Date.now() }));
    await redis.ltrim('admin:logs:error', 0, 499);
    await redis.incr('admin:stats:total_errors');
  } catch {}
}

// ── Main handler ─────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const type = req.query.type || req.body?.type;

  // ── GET: Platform-level analytics for admin ──────────────────
  if (req.method === 'GET') {
    try {
      const [totalUsers, totalScans, totalReports, failedScans, totalErrors] = await Promise.all([
        redis.get('admin:stats:total_users').then(v => Number(v || 0)),
        redis.get('admin:stats:total_scans').then(v => Number(v || 0)),
        redis.get('admin:stats:total_reports').then(v => Number(v || 0)),
        redis.get('admin:stats:failed_scans').then(v => Number(v || 0)),
        redis.get('admin:stats:total_errors').then(v => Number(v || 0)),
      ]);
      return res.status(200).json({ totalUsers, totalScans, totalReports, failedScans, totalErrors });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // ── type=track: user event tracking (from track.js) ─────────
    if (type === 'track' || (!type && req.body?.userId)) {
      const { userId, type: evType, email, authType } = req.body || {};
      if (userId && evType) await trackUser(userId, evType, email, authType);
      return res.status(200).json({ ok: true });
    }

    // ── type=log: event logging (from log.js) ───────────────────
    // AuditReady repurposes this for compliance event logging
    if (type === 'log') {
      const { userId, event, data } = req.body;
      if (!userId || !event) return res.status(400).json({ error: 'Missing fields' });
      const ts = Date.now();
      await redis.lpush('admin:logs:events', JSON.stringify({ userId, event, data, ts }));
      await redis.ltrim('admin:logs:events', 0, 499);
      return res.status(200).json({ ok: true });
    }

    // ── type=analytics: usage analytics write ───────────────────
    if (type === 'analytics') {
      const { userId, event, data } = req.body;
      if (!userId) return res.status(400).json({ error: 'Missing userId' });
      await trackUser(userId, event || 'page_view', data?.email, data?.authType);
      return res.status(200).json({ ok: true });
    }

    // ── Fallback: accept any POST with userId/type ───────────────
    const { userId, event, email, authType } = req.body || {};
    if (userId && event) await trackUser(userId, event, email, authType);
    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('Telemetry error:', err.message);
    return res.status(200).json({ ok: true });
  }
}
