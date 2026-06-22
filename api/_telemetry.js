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
import { createHmac, timingSafeEqual, randomBytes } from 'crypto';

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
  // Prefer a dedicated SESSION_SECRET. Fall back to other server-only secrets
  // so existing deployments keep working, but NEVER to a hardcoded constant —
  // a public fallback would let anyone forge a valid session for any user.
  const s = process.env.SESSION_SECRET
    || process.env.STRIPE_SECRET_KEY
    || process.env.GITHUB_CLIENT_SECRET;
  if (!s) throw new Error('No session secret configured (set SESSION_SECRET).');
  return s;
}

export function mintSession(uid, ttlDays = 30) {
  const payload = Buffer.from(JSON.stringify({ uid, iat: Date.now(), exp: Date.now() + ttlDays * 86400000 })).toString('base64url');
  const sig = createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
  return `s1.${payload}.${sig}`;
}

// verifySession validates the HMAC signature AND honours server-side
// revocation. "Sign out everywhere" stamps a cutoff timestamp per user; any
// token issued at/before that cutoff is rejected even though its signature is
// still cryptographically valid — making leaked or stolen tokens killable.
export async function verifySession(token) {
  try {
    const parts = String(token).split('.');
    if (parts.length !== 3 || parts[0] !== 's1') return null;
    const expected = createHmac('sha256', sessionSecret()).update(parts[1]).digest('base64url');
    const a = Buffer.from(parts[2]);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const data = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (!data.uid || !data.exp || Date.now() > data.exp) return null;
    try {
      const cutoff = await redis.get(`sess:revafter:${data.uid}`);
      // If a cutoff exists, reject tokens issued before it. Legacy tokens with
      // no iat are also rejected once a cutoff is set (they predate it).
      if (cutoff && (!data.iat || data.iat <= Number(cutoff))) return null;
    } catch {}
    return data.uid;
  } catch { return null; }
}

// Revoke every session for a user (e.g. on logout or suspected compromise).
export async function revokeSessions(uid) {
  if (!uid) return;
  try {
    await redis.set(`sess:revafter:${uid}`, String(Date.now()), { ex: 60 * 60 * 24 * 60 });
  } catch {}
}

// ── One-time auth codes (keep OAuth credentials out of the URL) ──
// After an OAuth provider verifies a user, we stash the resulting payload
// (tokens, session token, profile) in Redis under a single-use random code
// and redirect with only ?auth=<code>. The frontend redeems it once via POST;
// the code is deleted on first read and expires in 2 minutes — so a copied
// callback URL is useless and no real token ever lands in history/logs/Referer.
export async function stashAuthCode(payload) {
  const code = randomBytes(24).toString('base64url');
  await redis.set(`authcode:${code}`, JSON.stringify(payload), { ex: 120 });
  return code;
}

export async function takeAuthCode(code) {
  if (!code) return null;
  const key = `authcode:${String(code)}`;
  try {
    const raw = await redis.get(key);
    if (!raw) return null;
    await redis.del(key); // single use — redeemable exactly once
    return typeof raw === 'object' ? raw : JSON.parse(raw);
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

const PAID_MODES = ['starter', 'growth', 'enterprise'];
export function isPaidMode(mode) { return PAID_MODES.includes(mode); }

// Resolve a user's current plan from their stored record (defaults to sandbox).
export async function getUserMode(userId) {
  if (!userId) return 'sandbox';
  try {
    const raw = await redis.get(`admin:user:${userId}`);
    if (!raw) return 'sandbox';
    const u = typeof raw === 'object' ? raw : JSON.parse(raw);
    return u.mode || 'sandbox';
  } catch { return 'sandbox'; }
}

// Per-tier rate limits. Paid plans get a much higher ceiling; sandbox is kept
// tight to control LLM/scan cost and match the published free-tier allowance.
export async function checkRateLimit(userId, type, mode = 'sandbox') {
  const LIMITS = {
    scan:   { sandbox: { window: 3600, max: 3 },  paid: { window: 3600, max: 30 } },
    report: { sandbox: { window: 3600, max: 2 },  paid: { window: 3600, max: 20 } },
  };
  const tier = isPaidMode(mode) ? 'paid' : 'sandbox';
  const cfg = LIMITS[type]?.[tier];
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
  } catch {
    // Fail CLOSED: if we can't verify the limit (Redis error), deny rather than
    // allow unbounded, costly LLM/scan calls. A short retry keeps it recoverable.
    return { ok: false, retryAfter: 60, remaining: 0, degraded: true };
  }
}

// Admin check based on the already-verified userId (github:login / google:email
// / slack:email) against env allowlists. More robust than matching an
// unverified provider profile email.
export function isAdminUserId(userId) {
  if (!userId) return false;
  const list = (v) => (process.env[v] || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const ghAdmins = list('ADMIN_GH');
  const emailAdmins = list('ADMIN_EMAIL');
  if (userId.startsWith('github:')) return ghAdmins.includes(userId.slice(7).toLowerCase());
  if (userId.startsWith('google:')) return emailAdmins.includes(userId.slice(7).toLowerCase());
  if (userId.startsWith('slack:')) return emailAdmins.includes(userId.slice(6).toLowerCase());
  return false;
}

// Resolve the authenticated userId from an Authorization header (shared pattern).
async function resolveUserId(authHeader) {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  if (token.startsWith('s1.')) return await verifySession(token);
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

export async function logError(msg, ctx = {}) {
  try {
    await redis.lpush('admin:logs:error', JSON.stringify({ msg, ...ctx, ts: Date.now() }));
    await redis.ltrim('admin:logs:error', 0, 499);
    await redis.incr('admin:stats:total_errors');
  } catch {}
}

// ── Main handler ─────────────────────────────────────────────

export default async function handler(req, res) {
  const _origin = req.headers.origin || '';
  const _originOk = /^https:\/\/(auditready\.space|[a-z0-9-]+\.vercel\.app)$/i.test(_origin);
  res.setHeader('Access-Control-Allow-Origin', _originOk ? _origin : 'https://auditready.space');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const type = req.query.type || req.body?.type;

  // Authenticate every request. The authenticated userId is the ONLY identity
  // we trust — body-supplied userId/email are ignored to prevent record/log
  // poisoning by unauthenticated callers.
  const authUserId = await resolveUserId(req.headers.authorization);

  // ── GET: Platform-level analytics — ADMIN ONLY ───────────────
  if (req.method === 'GET') {
    if (!isAdminUserId(authUserId)) return res.status(403).json({ error: 'Forbidden' });
    try {
      const [totalUsers, totalScans, totalReports, failedScans, totalErrors] = await Promise.all([
        redis.get('admin:stats:total_users').then(v => Number(v || 0)),
        redis.get('admin:stats:total_scans').then(v => Number(v || 0)),
        redis.get('admin:stats:total_reports').then(v => Number(v || 0)),
        redis.get('admin:stats:failed_scans').then(v => Number(v || 0)),
        redis.get('admin:stats:total_errors').then(v => Number(v || 0)),
      ]);
      return res.status(200).json({ totalUsers, totalScans, totalReports, failedScans, totalErrors });
    } catch {
      return res.status(500).json({ error: 'Internal error' });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!authUserId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const authType = authUserId.split(':')[0];

    // ── type=log: event logging, always under the authenticated user ──
    if (type === 'log') {
      const { event, data } = req.body || {};
      if (!event) return res.status(400).json({ error: 'Missing fields' });
      const ts = Date.now();
      await redis.lpush('admin:logs:events', JSON.stringify({ userId: authUserId, event, data, ts }));
      await redis.ltrim('admin:logs:events', 0, 499);
      return res.status(200).json({ ok: true });
    }

    // ── track / analytics: record an event for the authenticated user only ──
    const evType = req.body?.event || req.body?.type === 'track' ? (req.body?.event || 'page_view') : 'page_view';
    if (evType) await trackUser(authUserId, evType, null, authType);
    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('Telemetry error:', err.message);
    return res.status(200).json({ ok: true });
  }
}
