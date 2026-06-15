// ─────────────────────────────────────────────────────────────
// api/score.js
// ACTION: NEW (slot 11)
//
//   GET  /api/score                  → current score + category breakdown
//   GET  /api/score?history=true     → score over time
//   POST /api/score                  → recompute score (internal / on-demand)
//
// Scoring algorithm (Section B3):
//   score = (verified_controls / total_applicable_controls) × 100
//   verified = status EVIDENCE_UPLOADED or CONNECTED_AUTO
//   applicable = all controls NOT marked NOT_APPLICABLE
//   result = rounded to nearest integer
//
// Color thresholds:
//   0-39%   → RED    (#EF4444) "Not Ready"
//   40-69%  → AMBER  (#F59E0B) "In Progress"
//   70-89%  → BLUE   (#3B82F6) "Getting Close"
//   90-100% → GREEN  (#10B981) "Audit Ready"
// ─────────────────────────────────────────────────────────────

import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

// ── Auth helpers ─────────────────────────────────────────────

async function getUserId(authHeader) {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  if (token.startsWith('google:')) return token;
  try {
    const r = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'AuditReady-AI' },
    });
    if (!r.ok) return null;
    const u = await r.json();
    return 'github:' + u.login;
  } catch { return null; }
}

// ── All 33 SOC 2 control IDs by category ─────────────────────

const CONTROLS_BY_CATEGORY = {
  CC1: ['CC1.1', 'CC1.2'],
  CC2: ['CC2.1', 'CC2.2'],
  CC3: ['CC3.1', 'CC3.2'],
  CC4: ['CC4.1', 'CC4.2'],
  CC5: ['CC5.1', 'CC5.2', 'CC5.3'],
  CC6: ['CC6.1', 'CC6.2', 'CC6.3', 'CC6.4', 'CC6.5', 'CC6.6', 'CC6.7'],
  CC7: ['CC7.1', 'CC7.2', 'CC7.3', 'CC7.4', 'CC7.5'],
  CC8: ['CC8.1', 'CC8.2', 'CC8.3', 'CC8.4'],
  CC9: ['CC9.1', 'CC9.2', 'CC9.3', 'CC9.4', 'CC9.5', 'CC9.6'],
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

// ── Score color + label ───────────────────────────────────────

function getScoreMeta(score) {
  if (score >= 90) return { color: '#10B981', label: 'Audit Ready', tier: 'AUDIT_READY' };
  if (score >= 70) return { color: '#3B82F6', label: 'Getting Close', tier: 'GETTING_CLOSE' };
  if (score >= 40) return { color: '#F59E0B', label: 'In Progress', tier: 'IN_PROGRESS' };
  return { color: '#EF4444', label: 'Not Ready', tier: 'NOT_READY' };
}

// ── Full score computation with category breakdown ────────────

async function computeFullScore(userId) {
  const categoryBreakdown = {};
  let totalVerified = 0;
  let totalApplicable = 0;
  const gaps = []; // Controls that are NOT_STARTED and high priority

  for (const [category, controlIds] of Object.entries(CONTROLS_BY_CATEGORY)) {
    let catVerified = 0;
    let catApplicable = 0;

    for (const id of controlIds) {
      const raw = await redis.get(`control:${userId}:${id}`);
      let status = 'NOT_STARTED';
      if (raw) {
        const control = typeof raw === 'object' ? raw : JSON.parse(raw);
        status = control.status || 'NOT_STARTED';

        if (status !== 'NOT_APPLICABLE') {
          catApplicable++;
          totalApplicable++;
          if (status === 'EVIDENCE_UPLOADED' || status === 'CONNECTED_AUTO') {
            catVerified++;
            totalVerified++;
          } else if (status === 'NOT_STARTED') {
            // Build gaps list
            gaps.push({
              id,
              category,
              title: control.title || id,
              status,
              autoDetectable: control.autoDetectable || false,
            });
          }
        }
      } else {
        catApplicable++;
        totalApplicable++;
        gaps.push({ id, category, title: id, status: 'NOT_STARTED', autoDetectable: false });
      }
    }

    const catScore = catApplicable > 0 ? Math.round((catVerified / catApplicable) * 100) : 0;
    categoryBreakdown[category] = {
      name: CATEGORY_NAMES[category],
      score: catScore,
      verified: catVerified,
      applicable: catApplicable,
      ...getScoreMeta(catScore),
    };
  }

  const overall = totalApplicable > 0 ? Math.round((totalVerified / totalApplicable) * 100) : 0;
  const meta = getScoreMeta(overall);

  // Sort gaps: CC6 (highest evidence demand) first, then by category
  gaps.sort((a, b) => {
    const priorityOrder = { CC6: 0, CC8: 1, CC7: 2, CC5: 3, CC4: 4, CC3: 5, CC2: 6, CC1: 7, CC9: 8 };
    return (priorityOrder[a.category] ?? 9) - (priorityOrder[b.category] ?? 9);
  });

  return {
    score: overall,
    verified: totalVerified,
    applicable: totalApplicable,
    ...meta,
    categoryBreakdown,
    topGaps: gaps.slice(0, 5),
    computedAt: new Date().toISOString(),
  };
}

// ── Main handler ─────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const userId = await getUserId(req.headers.authorization);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  // ── GET: Current score + category breakdown ───────────────────
  if (req.method === 'GET') {
    const { history } = req.query;

    if (history === 'true') {
      try {
        const histKey = `user:${userId}:scoreHistory`;
        const raw = await redis.lrange(histKey, 0, 89);
        const entries = (raw || []).map(r => {
          try { return typeof r === 'object' ? r : JSON.parse(r); } catch { return null; }
        }).filter(Boolean);
        entries.reverse(); // chronological order
        return res.status(200).json({ history: entries });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    try {
      const result = await computeFullScore(userId);

      // Persist computed score
      const entry = { score: result.score, ts: Date.now(), verified: result.verified, applicable: result.applicable };
      await redis.set(`user:${userId}:score`, JSON.stringify(entry));

      return res.status(200).json(result);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST: Force recompute (called internally + by UI) ─────────
  if (req.method === 'POST') {
    try {
      const result = await computeFullScore(userId);
      const entry = { score: result.score, ts: Date.now(), verified: result.verified, applicable: result.applicable };
      await redis.set(`user:${userId}:score`, JSON.stringify(entry));
      await redis.lpush(`user:${userId}:scoreHistory`, JSON.stringify(entry));
      await redis.ltrim(`user:${userId}:scoreHistory`, 0, 89);
      return res.status(200).json({ ok: true, ...result });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
