// ─────────────────────────────────────────────────────────────
// api/export.js
// ACTION: NEW
//
//   GET /api/export?format=json   → full self-service export of a user's
//                                    compliance data, for backup / data
//                                    portability (GDPR Art. 20 / CCPA).
//
// Dumps: controls, evidence, profile, vendors, score, scoreHistory, reports.
// Auth required — a user can only export their own data.
// ─────────────────────────────────────────────────────────────

import { Redis } from '@upstash/redis';
import { verifySession } from './_telemetry.js';
import { CONTROL_DEFINITIONS } from './controls.js';

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

function parse(raw) {
  if (!raw) return null;
  return typeof raw === 'object' ? raw : JSON.parse(raw);
}

export default async function handler(req, res) {
  const _origin = req.headers.origin || '';
  const _originOk = /^https:\/\/(auditready\.space|[a-z0-9-]+\.vercel\.app)$/i.test(_origin);
  res.setHeader('Access-Control-Allow-Origin', _originOk ? _origin : 'https://auditready.space');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const userId = await getUserId(req.headers.authorization);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const controlIds = CONTROL_DEFINITIONS.map(d => d.id);

    const controls = {};
    const evidence = {};
    for (const id of controlIds) {
      const c = parse(await redis.get(`control:${userId}:${id}`).catch(() => null));
      if (c) controls[id] = c;
      const e = parse(await redis.get(`user:${userId}:evidence:${id}`).catch(() => null));
      if (e) evidence[id] = e;
    }

    const profile = parse(await redis.get(`user:${userId}:profile`).catch(() => null)) || {};
    const vendors = parse(await redis.get(`user:${userId}:vendors`).catch(() => null)) || [];
    const score = parse(await redis.get(`user:${userId}:score`).catch(() => null));
    const scoreHistoryRaw = await redis.lrange(`user:${userId}:scoreHistory`, 0, 89).catch(() => []);
    const scoreHistory = (scoreHistoryRaw || []).map(parse).filter(Boolean);

    const reportIds = await redis.lrange(`user:${userId}:reports`, 0, 49).catch(() => []);
    const reports = [];
    for (const id of (reportIds || [])) {
      const r = parse(await redis.get(`user:${userId}:report:${id}`).catch(() => null));
      if (r) reports.push(r);
    }

    const exportData = {
      exportedAt: new Date().toISOString(),
      userId,
      profile,
      controls,
      evidence,
      vendors,
      score,
      scoreHistory,
      reports,
    };

    if (req.query.format === 'download') {
      res.setHeader('Content-Disposition', `attachment; filename="auditready-export-${Date.now()}.json"`);
    }

    return res.status(200).json(exportData);
  } catch (err) {
    console.error('Export error:', err.message);
    return res.status(500).json({ error: 'Could not generate export. Please try again.' });
  }
}
