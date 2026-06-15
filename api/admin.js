// ─────────────────────────────────────────────────────────────
// api/admin.js
// ACTION: KEPT AS-IS — unchanged
// ─────────────────────────────────────────────────────────────

import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

function isAdmin(req) {
  const auth = req.headers['x-admin-key'];
  if (!auth) return false;
  const parts = auth.split(':');
  const username = parts[parts.length - 1];
  return username === process.env.ADMIN_GH;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET' && req.query.action === 'check') {
    return res.status(isAdmin(req) ? 200 : 401).json({ ok: isAdmin(req) });
  }

  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });

  try {
    if (req.method === 'GET') {
      const [
        totalUsers, totalDeploys, deploysToday, failedDeploys,
        activeSessions, analyzeCount, errorCount
      ] = await Promise.all([
        redis.get('admin:stats:total_users').then(v => Number(v || 0)),
        redis.get('admin:stats:total_deploys').then(v => Number(v || 0)),
        redis.get(`admin:stats:deploys:${today()}`).then(v => Number(v || 0)),
        redis.get('admin:stats:failed_deploys').then(v => Number(v || 0)),
        redis.get('admin:stats:active_sessions').then(v => Number(v || 0)),
        redis.get('admin:stats:total_analyzes').then(v => Number(v || 0)),
        redis.get('admin:stats:total_errors').then(v => Number(v || 0)),
      ]);

      const userKeys = await redis.keys('admin:user:*');
      const users = [];
      for (const k of userKeys.slice(0, 200)) {
        try {
          const u = await redis.get(k);
          if (u) users.push(typeof u === 'object' ? u : JSON.parse(u));
        } catch {}
      }
      users.sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0));

      const [deployLogs, authLogs, analyzeLogs, errorLogs] = await Promise.all([
        redis.lrange('admin:logs:deploy', 0, 49).then(parse),
        redis.lrange('admin:logs:auth', 0, 49).then(parse),
        redis.lrange('admin:logs:analyze', 0, 49).then(parse),
        redis.lrange('admin:logs:error', 0, 49).then(parse),
      ]);

      const templateKeys = await redis.keys('admin:template:*');
      const templates = [];
      for (const k of templateKeys) {
        try {
          const t = await redis.get(k);
          if (t) templates.push(typeof t === 'object' ? t : JSON.parse(t));
        } catch {}
      }
      templates.sort((a, b) => (b.deployCount || 0) - (a.deployCount || 0));

      return res.status(200).json({
        stats: { totalUsers, totalDeploys, deploysToday, failedDeploys, activeSessions, analyzeCount, errorCount },
        users,
        logs: { deploy: deployLogs, auth: authLogs, analyze: analyzeLogs, error: errorLogs },
        templates,
      });
    }

    if (req.method === 'POST') {
      const { userId, type } = req.body;
      if (!userId || !type) return res.status(400).json({ error: 'Missing userId or type' });

      const userKey = `admin:user:${userId}`;
      let user = await redis.get(userKey);
      if (!user) return res.status(404).json({ error: 'User not found' });
      if (typeof user === 'string') user = JSON.parse(user);

      if (type === 'suspend') {
        user.status = 'suspended'; user.suspendedAt = Date.now();
        await redis.set(`blocked:${userId}`, JSON.stringify({ status: 'suspended', since: Date.now() }));
        await log('admin', { action: 'suspend', userId, ts: Date.now() });
      } else if (type === 'unsuspend') {
        user.status = 'active'; delete user.suspendedAt;
        await redis.del(`blocked:${userId}`);
        await log('admin', { action: 'unsuspend', userId, ts: Date.now() });
      } else if (type === 'ban') {
        user.status = 'banned'; user.bannedAt = Date.now();
        await redis.set(`blocked:${userId}`, JSON.stringify({ status: 'banned', since: Date.now() }));
        await redis.set(`banned:${userId}`, '1');
        await log('admin', { action: 'ban', userId, ts: Date.now() });
      } else if (type === 'unban') {
        user.status = 'active'; delete user.bannedAt;
        await redis.del(`blocked:${userId}`); await redis.del(`banned:${userId}`);
        await log('admin', { action: 'unban', userId, ts: Date.now() });
      } else if (type === 'reset_sandbox') {
        user.sandboxUsed = false;
        await redis.del(`sb_used:${userId}`);
        await log('admin', { action: 'reset_sandbox', userId, ts: Date.now() });
      } else if (type === 'set_mode') {
        user.mode = req.body.mode || 'sandbox';
        await log('admin', { action: 'set_mode', userId, mode: user.mode, ts: Date.now() });
      } else if (type === 'delete') {
        await redis.del(userKey);
        await redis.del(`blocked:${userId}`);
        await redis.del(`banned:${userId}`);
        await log('admin', { action: 'delete', userId, ts: Date.now() });
        return res.status(200).json({ ok: true, deleted: true });
      } else {
        return res.status(400).json({ error: 'Unknown action type' });
      }

      await redis.set(userKey, JSON.stringify(user));
      return res.status(200).json({ ok: true, user });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Admin error:', err);
    return res.status(500).json({ error: err.message });
  }
}

function today() { return new Date().toISOString().slice(0, 10); }
function parse(arr) {
  return (arr || []).map(x => { try { return typeof x === 'object' ? x : JSON.parse(x); } catch { return null; } }).filter(Boolean);
}
async function log(type, data) {
  try {
    await redis.lpush(`admin:logs:${type}`, JSON.stringify({ ...data, ts: Date.now() }));
    await redis.ltrim(`admin:logs:${type}`, 0, 499);
  } catch {}
}
