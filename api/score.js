// api/score.js — Full score computation with control titles for topGaps

import { Redis } from '@upstash/redis';
import { verifySession, withLock } from './_telemetry.js';

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

// Full title map so topGaps always has readable titles
const CONTROL_TITLES = {
  'CC1.1': 'Security policies documented and reviewed annually',
  'CC1.2': 'Organizational roles and responsibilities defined',
  'CC1.3': 'Code of conduct and ethics policy documented',
  'CC1.4': 'Background checks conducted for new hires',
  'CC2.1': 'Security awareness training completed',
  'CC2.2': 'Incident communication procedure exists',
  'CC2.3': 'Security incidents communicated to management',
  'CC3.1': 'Formal risk assessment process documented',
  'CC3.2': 'Risks identified, evaluated, and prioritized',
  'CC3.3': 'Risk treatment decisions documented',
  'CC4.1': 'Security monitoring and logging enabled',
  'CC4.2': 'Internal audit or review process defined',
  'CC5.1': 'Encryption at rest implemented',
  'CC5.2': 'Encryption in transit (TLS) enforced',
  'CC5.3': 'Data retention policy documented',
  'CC5.4': 'Encryption key management procedures documented',
  'CC5.5': 'Data classification policy exists',
  'CC6.1': 'Access provisioning requires approval',
  'CC6.2': 'MFA enforced for all users',
  'CC6.3': 'Unique user accounts (no shared credentials)',
  'CC6.4': 'Access reviews conducted quarterly',
  'CC6.5': 'Terminated employee access removed within 24h',
  'CC6.6': 'Privileged access documented and limited',
  'CC6.7': 'Password policy enforced',
  'CC6.8': 'Physical access to systems restricted',
  'CC6.9': 'Remote access secured with MFA and VPN',
  'CC7.1': 'System availability monitored',
  'CC7.2': 'Backup procedures documented and tested',
  'CC7.3': 'Incident response plan exists',
  'CC7.4': 'Vulnerability scanning performed regularly',
  'CC7.5': 'Penetration testing conducted annually',
  'CC7.6': 'System capacity and performance monitored',
  'CC8.1': 'Change management process documented',
  'CC8.2': 'Code review required before deployment',
  'CC8.3': 'Separate dev/staging/production environments',
  'CC8.4': 'Deployment pipeline documented',
  'CC8.5': 'Security testing performed before deployments',
  'CC8.6': 'Rollback procedures documented and tested',
  'CC9.1': 'Third-party vendor risk assessment process',
  'CC9.2': 'Vendor contracts include security requirements',
  'CC9.3': 'Business continuity plan documented',
  'CC9.4': 'Disaster recovery plan documented and tested',
  'CC9.5': 'Cyber liability insurance in place',
  'CC9.6': 'Sub-processors listed and documented',
  'CC9.7': 'Employee offboarding checklist includes access revocation',
  'CC9.8': 'Security incident response retainer identified',
  'CC9.9': 'Annual SOC 2 readiness review conducted',
  'CC9.10': 'Privacy policy published and current',
  'CC9.11': 'Terms of service documented for customers',
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

function getScoreMeta(score) {
  if (score >= 90) return { color: '#10B981', label: 'Audit Ready', tier: 'AUDIT_READY' };
  if (score >= 70) return { color: '#3B82F6', label: 'Getting Close', tier: 'GETTING_CLOSE' };
  if (score >= 40) return { color: '#F59E0B', label: 'In Progress', tier: 'IN_PROGRESS' };
  return { color: '#EF4444', label: 'Not Ready', tier: 'NOT_READY' };
}

async function computeFullScore(userId) {
  const categoryBreakdown = {};
  let totalVerified = 0;
  let totalApplicable = 0;
  const gaps = [];

  for (const [category, controlIds] of Object.entries(CONTROLS_BY_CATEGORY)) {
    let catVerified = 0;
    let catApplicable = 0;

    for (const id of controlIds) {
      const raw = await redis.get(`control:${userId}:${id}`);
      let status = 'NOT_STARTED';
      let autoDetectable = false;

      if (raw) {
        const control = typeof raw === 'object' ? raw : JSON.parse(raw);
        status = control.status || 'NOT_STARTED';
        autoDetectable = control.autoDetectable || false;

        if (status !== 'NOT_APPLICABLE') {
          catApplicable++;
          totalApplicable++;
          if (status === 'EVIDENCE_UPLOADED' || status === 'CONNECTED_AUTO') {
            catVerified++;
            totalVerified++;
          } else if (status === 'NOT_STARTED' || status === 'IN_PROGRESS') {
            gaps.push({
              id,
              category,
              title: CONTROL_TITLES[id] || id,
              status,
              autoDetectable,
            });
          }
        }
      } else {
        catApplicable++;
        totalApplicable++;
        gaps.push({
          id,
          category,
          title: CONTROL_TITLES[id] || id,
          status: 'NOT_STARTED',
          autoDetectable: false,
        });
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

  // Priority: CC6 first (most evidence-heavy), then by category order
  const priorityOrder = { CC6: 0, CC8: 1, CC7: 2, CC5: 3, CC4: 4, CC3: 5, CC2: 6, CC1: 7, CC9: 8 };
  gaps.sort((a, b) => (priorityOrder[a.category] ?? 9) - (priorityOrder[b.category] ?? 9));

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

export default async function handler(req, res) {
  const _origin = req.headers.origin || '';
  const _originOk = /^https:\/\/(auditready\.space|[a-z0-9-]+\.vercel\.app)$/i.test(_origin);
  res.setHeader('Access-Control-Allow-Origin', _originOk ? _origin : 'https://auditready.space');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const userId = await getUserId(req.headers.authorization);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  if (req.method === 'GET') {
    const { history } = req.query;
    if (history === 'true') {
      try {
        const raw = await redis.lrange(`user:${userId}:scoreHistory`, 0, 89);
        const entries = (raw || []).map(r => {
          try { return typeof r === 'object' ? r : JSON.parse(r); } catch { return null; }
        }).filter(Boolean);
        entries.reverse();
        return res.status(200).json({ history: entries });
      } catch (err) {
        return res.status(500).json({ error: 'Internal error. Please try again.' });
      }
    }
    try {
      const result = await computeFullScore(userId);
      const entry = { score: result.score, ts: Date.now(), verified: result.verified, applicable: result.applicable };
      await withLock(`score:${userId}`, async () => {
        await redis.set(`user:${userId}:score`, JSON.stringify(entry));
      });
      // Surface the caller's own plan/status so the frontend can gate features
      // without hitting the admin-only endpoint.
      let mode = 'sandbox', status = 'active';
      try {
        const uRaw = await redis.get(`admin:user:${userId}`);
        if (uRaw) {
          const u = typeof uRaw === 'object' ? uRaw : JSON.parse(uRaw);
          mode = u.mode || 'sandbox';
          status = u.status || 'active';
        }
      } catch {}
      return res.status(200).json({ ...result, mode, status });
    } catch (err) {
      return res.status(500).json({ error: 'Internal error. Please try again.' });
    }
  }

  if (req.method === 'POST') {
    try {
      const result = await computeFullScore(userId);
      const entry = { score: result.score, ts: Date.now(), verified: result.verified, applicable: result.applicable };
      await withLock(`score:${userId}`, async () => {
        await redis.set(`user:${userId}:score`, JSON.stringify(entry));
        await redis.lpush(`user:${userId}:scoreHistory`, JSON.stringify(entry));
        await redis.ltrim(`user:${userId}:scoreHistory`, 0, 89);
      });
      return res.status(200).json({ ok: true, ...result });
    } catch (err) {
      return res.status(500).json({ error: 'Internal error. Please try again.' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
