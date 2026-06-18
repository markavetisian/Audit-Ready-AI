// ─────────────────────────────────────────────────────────────
// api/share.js
// ACTION: NEW (slot 12)
//
//   POST /api/share                  → create shareable auditor token
//   GET  /api/share?token=X          → public report (NO AUTH required)
//   GET  /api/share?list=true        → list user's active share links (auth required)
//
// Token TTL: 30 days (configurable via body)
// Public view: score, category breakdown, report if generated
// Sensitive data (userId, raw controls detail) excluded from public view
// Disclaimer + selfReported flags included in all public payloads
// ─────────────────────────────────────────────────────────────

import { Redis } from '@upstash/redis';
import { createHash, randomBytes } from 'crypto';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

// ── Auth helpers (POST and list GET — public GET is token-based) ──

async function getUserId(authHeader) {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  if (token.startsWith('google:')) return token;
  if (token.startsWith('slack:')) return token;
  try {
    const r = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'AuditReady-AI' },
    });
    if (!r.ok) return null;
    const u = await r.json();
    return 'github:' + u.login;
  } catch { return null; }
}

// ── Token generation (cryptographically random) ───────────────

function generateToken() {
  // Use crypto.randomBytes for a cryptographically secure 32-char URL-safe token
  try {
    const bytes = randomBytes(24);
    // Base64url encode: replace +/= with URL-safe chars and trim padding
    return bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '').slice(0, 32);
  } catch {
    // Fallback: use crypto.randomUUID if available
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID().replace(/-/g, '').slice(0, 32);
    }
    // Last resort: timestamp + random (should not reach here in Node.js)
    return Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  }
}

// ── Score color helper ────────────────────────────────────────

function getScoreMeta(score) {
  if (score >= 90) return { color: '#10B981', label: 'Audit Ready' };
  if (score >= 70) return { color: '#3B82F6', label: 'Getting Close' };
  if (score >= 40) return { color: '#F59E0B', label: 'In Progress' };
  return { color: '#EF4444', label: 'Not Ready' };
}

// ── Build public report payload ───────────────────────────────

async function buildPublicPayload(userId, options = {}) {
  const { includeReport, reportId } = options;

  // Get score
  const scoreRaw = await redis.get(`user:${userId}:score`);
  const scoreData = scoreRaw ? (typeof scoreRaw === 'object' ? scoreRaw : JSON.parse(scoreRaw)) : null;
  const score = scoreData?.score || 0;

  // Get category breakdown from controls
  const CONTROLS_BY_CATEGORY = {
    CC1: ['CC1.1', 'CC1.2', 'CC1.3', 'CC1.4'],
    CC2: ['CC2.1', 'CC2.2', 'CC2.3'],
    CC3: ['CC3.1', 'CC3.2', 'CC3.3'],
    CC4: ['CC4.1', 'CC4.2'],
    CC5: ['CC5.1', 'CC5.2', 'CC5.3', 'CC5.4', 'CC5.5'],
    CC6: ['CC6.1', 'CC6.2', 'CC6.3', 'CC6.4', 'CC6.5', 'CC6.6', 'CC6.7', 'CC6.8', 'CC6.9'],
    CC7: ['CC7.1', 'CC7.2', 'CC7.3', 'CC7.4', 'CC7.5', 'CC7.6'],
    CC8: ['CC8.1', 'CC8.2', 'CC8.3', 'CC8.4', 'CC8.5', 'CC8.6'],
    CC9: ['CC9.1', 'CC9.2', 'CC9.3', 'CC9.4', 'CC9.5', 'CC9.6', 'CC9.7', 'CC9.8', 'CC9.9', 'CC9.10', 'CC9.11'],
  };

  const CATEGORY_NAMES = {
    CC1: 'Control Environment',
    CC2: 'Communication & Information',
    CC3: 'Risk Assessment',
    CC4: 'Monitoring of Controls',
    CC5: 'Control Activities',
    CC6: 'Logical & Physical Access Controls',
    CC7: 'System Operations',
    CC8: 'Change Management',
    CC9: 'Risk Mitigation',
  };

  const categoryBreakdown = {};
  for (const [cat, ids] of Object.entries(CONTROLS_BY_CATEGORY)) {
    let verified = 0, applicable = 0;
    for (const id of ids) {
      const raw = await redis.get(`control:${userId}:${id}`);
      if (raw) {
        const c = typeof raw === 'object' ? raw : JSON.parse(raw);
        if (c.status !== 'NOT_APPLICABLE') {
          applicable++;
          if (c.status === 'EVIDENCE_UPLOADED' || c.status === 'CONNECTED_AUTO') verified++;
        }
      } else {
        applicable++;
      }
    }
    const catScore = applicable > 0 ? Math.round((verified / applicable) * 100) : 0;
    categoryBreakdown[cat] = {
      name: CATEGORY_NAMES[cat],
      score: catScore,
      verified,
      applicable,
    };
  }

  // Get company profile
  const profileRaw = await redis.get(`user:${userId}:profile`);
  const profile = profileRaw ? (typeof profileRaw === 'object' ? profileRaw : JSON.parse(profileRaw)) : {};

  const payload = {
    score,
    ...getScoreMeta(score),
    framework: 'SOC 2 Type 1',
    categoryBreakdown,
    generatedAt: new Date().toISOString(),
    // Transparency: this is self-reported
    disclaimer: 'This compliance readiness score is self-reported and was assessed using AuditReady AI. It has not been independently verified by a licensed CPA firm and does not constitute a SOC 2 attestation.',
    selfReported: true,
    company: {
      name: profile.companyName || '',
      description: profile.description || '',
      website: profile.website || '',
      logoUrl: profile.logoUrl || '',
      frameworks: profile.frameworks || ['SOC 2 Type 1'],
    },
  };

  // Optionally include generated report (executive summary only for public view)
  if (includeReport && reportId) {
    const reportRaw = await redis.get(`user:${userId}:report:${reportId}`);
    if (reportRaw) {
      const report = typeof reportRaw === 'object' ? reportRaw : JSON.parse(reportRaw);
      payload.report = {
        companyName: report.companyName,
        executiveSummary: report.report?.executiveSummary,
        overallRating: report.report?.overallRating,
        estimatedTimeToAuditReady: report.report?.estimatedTimeToAuditReady,
        generatedAt: report.generatedAt,
        aiGenerated: report.aiGenerated || false,
        generatedBy: report.generatedBy || null,
      };
    }
  }

  return payload;
}

// ── Main handler ─────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET: Public report view — NO AUTH (token) or list (auth) ──
  if (req.method === 'GET') {
    const { token, list } = req.query;

    // ── GET ?list=true — authenticated list of user's share links ─
    if (list === 'true') {
      const userId = await getUserId(req.headers.authorization);
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });

      try {
        const userSharesKey = `user:${userId}:shares`;
        const raw = await redis.lrange(userSharesKey, 0, 19);
        const shares = [];
        const now = Date.now();
        for (const item of (raw || [])) {
          try {
            const s = typeof item === 'object' ? item : JSON.parse(item);
            if (s.expiresAt && s.expiresAt > now) {
              // Get view count
              const viewCountRaw = await redis.get(`share:${s.token}:views`);
              shares.push({
                token: s.token,
                createdAt: s.createdAt,
                expiresAt: s.expiresAt,
                ttlDays: s.ttlDays,
                viewCount: viewCountRaw ? parseInt(viewCountRaw, 10) : 0,
              });
            }
          } catch {}
        }
        return res.status(200).json({ shares });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    // ── GET ?token=X — public unauthenticated view ────────────────
    if (!token) return res.status(400).json({ error: 'Missing token' });

    try {
      const tokenKey = `share:${token}`;
      const raw = await redis.get(tokenKey);
      if (!raw) return res.status(404).json({ error: 'Share link not found or expired' });

      const shareData = typeof raw === 'object' ? raw : JSON.parse(raw);
      const { userId, options, createdAt, expiresAt, companyName } = shareData;

      // Check expiry
      if (expiresAt && Date.now() > expiresAt) {
        return res.status(410).json({ error: 'Share link has expired' });
      }

      // Increment view count
      const viewKey = `share:${token}:views`;
      await redis.incr(viewKey).catch(() => {});

      const payload = await buildPublicPayload(userId, options);
      payload.companyName = companyName;
      payload.sharedAt = createdAt;
      payload.poweredBy = 'AuditReady AI';

      return res.status(200).json(payload);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST: Create shareable token (requires auth) ──────────────
  if (req.method === 'POST') {
    const userId = await getUserId(req.headers.authorization);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    try {
      const { companyName, ttlDays, includeReport, reportId } = req.body || {};
      const ttl = Math.min(Math.max(ttlDays || 30, 1), 90); // 1-90 days
      const token = generateToken();
      const now = Date.now();
      const expiresAt = now + ttl * 24 * 60 * 60 * 1000;
      const appUrl = process.env.APP_URL || 'https://auditready.space';

      const shareData = {
        token,
        userId,
        companyName: companyName || 'Company',
        createdAt: now,
        expiresAt,
        ttlDays: ttl,
        options: {
          includeReport: !!includeReport,
          reportId: reportId || null,
        },
      };

      const tokenKey = `share:${token}`;
      await redis.set(tokenKey, JSON.stringify(shareData), { ex: ttl * 24 * 60 * 60 });

      // Also store in user's share list
      const userSharesKey = `user:${userId}:shares`;
      await redis.lpush(userSharesKey, JSON.stringify({ token, createdAt: now, expiresAt, ttlDays: ttl }));
      await redis.ltrim(userSharesKey, 0, 19); // Keep last 20 shares

      const shareUrl = `${appUrl}/?share=${token}`;

      return res.status(201).json({
        ok: true,
        token,
        shareUrl,
        expiresAt,
        ttlDays: ttl,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
