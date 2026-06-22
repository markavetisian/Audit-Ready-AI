// ─────────────────────────────────────────────────────────────
// api/admin.js
// Admin panel API — protected by ADMIN_GH env var
//
//   GET  /api/admin                    → all users, stats, logs
//   GET  /api/admin?action=check       → auth check
//   GET  /api/admin?action=user&id=X   → single user detail
//   POST /api/admin {userId, type}     → user actions
//     types: suspend | unsuspend | ban | unban | set_mode | cancel_subscription | delete
// ─────────────────────────────────────────────────────────────

import { Redis } from '@upstash/redis';
import { verifySession, withLock, logError } from './_telemetry.js';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;

function adminList(envVar) {
  return (process.env[envVar] || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

async function resolveIdentity(authHeader) {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);

  // Signed session token (google/slack users). The uid was issued only after
  // the provider verified the user, so the embedded email is trustworthy.
  if (token.startsWith('s1.')) {
    const uid = await verifySession(token);
    if (!uid) return null;
    if (uid.startsWith('google:')) return { username: null, email: uid.slice(7) };
    if (uid.startsWith('slack:')) return { username: null, email: uid.slice(6) };
    if (uid.startsWith('github:')) return { username: uid.slice(7), email: null };
    return null;
  }

  // Bare email claims are NOT trusted for admin (the admin email is public).
  if (token.startsWith('google:') || token.startsWith('slack:')) return null;

  // Otherwise treat as a GitHub OAuth token — verify it against GitHub's API
  // rather than trusting a client-asserted username. NOTE: we deliberately do
  // NOT return the GitHub profile email — it can be an unverified public email,
  // so GitHub admins must be allowlisted by username (ADMIN_GH), never by email.
  try {
    const r = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'AuditReady-AI' },
    });
    if (!r.ok) return null;
    const u = await r.json();
    return { username: u.login || null, email: null };
  } catch { return null; }
}

function identityIsAdmin(identity) {
  if (!identity) return false;
  const ghAdmins = adminList('ADMIN_GH');
  const emailAdmins = adminList('ADMIN_EMAIL');
  if (identity.username && ghAdmins.includes(identity.username.toLowerCase())) return true;
  if (identity.email && emailAdmins.includes(identity.email.toLowerCase())) return true;
  return false;
}

async function stripePatch(path, body) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${STRIPE_SECRET}`, 'Content-Type': 'application/x-www-form-urlencoded' },
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

export default async function handler(req, res) {
  const _origin = req.headers.origin || '';
  const _originOk = /^https:\/\/(auditready\.space|[a-z0-9-]+\.vercel\.app)$/i.test(_origin);
  res.setHeader('Access-Control-Allow-Origin', _originOk ? _origin : 'https://auditready.space');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const identity = await resolveIdentity(req.headers.authorization);
  const admin = identityIsAdmin(identity);
  const adminBy = identity?.username || identity?.email || 'unknown';

  // Auth check endpoint — public (returns 200/401)
  if (req.method === 'GET' && req.query.action === 'check') {
    return res.status(admin ? 200 : 401).json({ ok: admin });
  }

  if (!admin) return res.status(401).json({ error: 'Unauthorized' });

  try {
    // ── GET: Dashboard data ──────────────────────────────────────
    if (req.method === 'GET') {
      // Single user detail
      if (req.query.action === 'user' && req.query.id) {
        const raw = await redis.get(`admin:user:${req.query.id}`);
        if (!raw) return res.status(404).json({ error: 'User not found' });
        const user = typeof raw === 'object' ? raw : JSON.parse(raw);
        return res.status(200).json({ user });
      }

      // Global stats
      const [totalUsers, totalScans, totalReports, failedScans, totalErrors] = await Promise.all([
        redis.get('admin:stats:total_users').then(v => Number(v || 0)),
        redis.get('admin:stats:total_scans').then(v => Number(v || 0)),
        redis.get('admin:stats:total_reports').then(v => Number(v || 0)),
        redis.get('admin:stats:failed_scans').then(v => Number(v || 0)),
        redis.get('admin:stats:total_errors').then(v => Number(v || 0)),
      ]);

      // All users
      const userKeys = await redis.keys('admin:user:*');
      const users = [];
      for (const k of userKeys.slice(0, 500)) {
        try {
          const u = await redis.get(k);
          if (u) {
            const parsed = typeof u === 'object' ? u : JSON.parse(u);
            // Enrich with derived fields
            parsed.displayId = parsed.userId || k.replace('admin:user:', '');
            users.push(parsed);
          }
        } catch {}
      }
      users.sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0));

      // Subscription breakdown
      const modeCounts = { sandbox: 0, starter: 0, growth: 0, enterprise: 0 };
      users.forEach(u => { modeCounts[u.mode || 'sandbox'] = (modeCounts[u.mode || 'sandbox'] || 0) + 1; });

      // Auth logs
      const [authLogs, errorLogs, eventLogs] = await Promise.all([
        redis.lrange('admin:logs:auth', 0, 99).then(parse),
        redis.lrange('admin:logs:error', 0, 49).then(parse),
        redis.lrange('admin:logs:events', 0, 49).then(parse),
      ]);

      return res.status(200).json({
        stats: { totalUsers, totalScans, totalReports, failedScans, totalErrors, modeCounts },
        users,
        logs: { auth: authLogs, error: errorLogs, events: eventLogs },
      });
    }

    // ── POST: User actions ───────────────────────────────────────
    if (req.method === 'POST') {
      const { userId, type, mode } = req.body || {};
      if (!userId || !type) return res.status(400).json({ error: 'Missing userId or type' });

      const userKey = `admin:user:${userId}`;
      const ts = Date.now();
      await adminLog({ action: type, userId, by: adminBy, ts });

      // ── delete: erase ALL of this user's data, not just the account record.
      // A partial erasure here is both a data-integrity and a "right to
      // erasure" (GDPR/CCPA) compliance gap for a product that promises to
      // delete customer data.
      if (type === 'delete') {
        const [controlKeys, evidenceKeys, reportKeys] = await Promise.all([
          redis.keys(`control:${userId}:*`).catch(() => []),
          redis.keys(`user:${userId}:evidence:*`).catch(() => []),
          redis.keys(`user:${userId}:report:*`).catch(() => []),
        ]);
        const keysToDelete = [
          userKey,
          `blocked:${userId}`,
          `banned:${userId}`,
          `user:${userId}:score`,
          `user:${userId}:scoreHistory`,
          `user:${userId}:vendors`,
          `user:${userId}:profile`,
          `user:${userId}:shares`,
          `user:${userId}:lastScan`,
          `user:${userId}:reports`,
          `user:${userId}:seeded`,
          ...controlKeys, ...evidenceKeys, ...reportKeys,
        ];
        await Promise.all(keysToDelete.map(k => redis.del(k).catch(() => {})));
        return res.status(200).json({ ok: true, deleted: true });
      }

      let result;
      await withLock(`admin:${userId}`, async () => {
        let user = await redis.get(userKey);
        if (!user) { result = { status: 404, body: { error: 'User not found' } }; return; }
        if (typeof user === 'string') user = JSON.parse(user);

        if (type === 'suspend') {
          user.status = 'suspended'; user.suspendedAt = ts;
          await redis.set(`blocked:${userId}`, JSON.stringify({ status: 'suspended', since: ts }));

        } else if (type === 'unsuspend') {
          user.status = 'active'; delete user.suspendedAt;
          await redis.del(`blocked:${userId}`);

        } else if (type === 'ban') {
          user.status = 'banned'; user.bannedAt = ts;
          await redis.set(`blocked:${userId}`, JSON.stringify({ status: 'banned', since: ts }));
          await redis.set(`banned:${userId}`, '1');

        } else if (type === 'unban') {
          user.status = 'active'; delete user.bannedAt;
          await redis.del(`blocked:${userId}`); await redis.del(`banned:${userId}`);

        } else if (type === 'set_mode') {
          if (!['sandbox', 'starter', 'growth', 'enterprise'].includes(mode)) {
            result = { status: 400, body: { error: 'Invalid mode' } }; return;
          }
          user.mode = mode;

        } else if (type === 'cancel_subscription') {
          // Cancel via Stripe
          let subId = user.stripeSubscriptionId;
          if (!subId && user.stripeCustomerId) {
            const subs = await stripeGet(`subscriptions?customer=${user.stripeCustomerId}&status=active&limit=1`);
            if (subs.data?.length > 0) subId = subs.data[0].id;
          }
          if (subId) {
            const r = await stripePatch(`subscriptions/${subId}`, { cancel_at_period_end: 'true' });
            if (r.error && !r.error.message?.includes('No such')) {
              result = { status: 500, body: { error: r.error.message } }; return;
            }
            user.cancelPending = true;
            user.cancelAt = r.current_period_end || null;
          }
          user.mode = 'sandbox';

        } else {
          result = { status: 400, body: { error: 'Unknown action type' } }; return;
        }

        await redis.set(userKey, JSON.stringify(user));
        result = { status: 200, body: { ok: true, user } };
      });

      return res.status(result.status).json(result.body);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Admin error:', err);
    return res.status(500).json({ error: 'Internal error. Please try again.' });
  }
}

function today() { return new Date().toISOString().slice(0, 10); }
function parse(arr) {
  return (arr || []).map(x => { try { return typeof x === 'object' ? x : JSON.parse(x); } catch { return null; } }).filter(Boolean);
}
async function adminLog(data) {
  try {
    await redis.lpush('admin:logs:admin_actions', JSON.stringify(data));
    await redis.ltrim('admin:logs:admin_actions', 0, 499);
  } catch {}
}
