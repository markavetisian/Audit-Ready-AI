// ─────────────────────────────────────────────────────────────
// api/account.js
// ACTION: NEW
//
//   DELETE /api/account   → self-service account + data deletion
//                           (GDPR Art. 17 / CCPA right to delete)
//
// Erases the same full key set as the admin "delete" action, but is
// callable by the user themselves against their own account only.
// ─────────────────────────────────────────────────────────────

import { Redis } from '@upstash/redis';
import { verifySession, logError } from './_telemetry.js';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

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

export default async function handler(req, res) {
  const _origin = req.headers.origin || '';
  const _originOk = /^https:\/\/(auditready\.space|[a-z0-9-]+\.vercel\.app)$/i.test(_origin);
  res.setHeader('Access-Control-Allow-Origin', _originOk ? _origin : 'https://auditready.space');
  res.setHeader('Access-Control-Allow-Methods', 'DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });

  const userId = await getUserId(req.headers.authorization);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const [controlKeys, evidenceKeys, reportKeys] = await Promise.all([
      redis.keys(`control:${userId}:*`).catch(() => []),
      redis.keys(`user:${userId}:evidence:*`).catch(() => []),
      redis.keys(`user:${userId}:report:*`).catch(() => []),
    ]);
    const keysToDelete = [
      `admin:user:${userId}`,
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
  } catch (err) {
    await logError('account_delete_error', { msg: err.message, userId });
    return res.status(500).json({ error: 'Could not delete account. Please try again or contact support.' });
  }
}
