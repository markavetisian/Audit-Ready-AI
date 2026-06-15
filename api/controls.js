// ─────────────────────────────────────────────────────────────
// api/controls.js
// ACTION: REFACTORED from api/agents.js
//
//   GET   /api/controls                   → return all 33 controls + statuses
//   GET   /api/controls?category=CC6      → filter by category
//   GET   /api/controls?status=NOT_STARTED → filter by status
//   PATCH /api/controls                   → update control status / not-applicable toggle
//
// KEPT:    Redis client, auth middleware, CORS headers
// REMOVED: Agent CRUD, GitHub repo deletion, agent upsert logic
// ADDED:   33-control SOC 2 seed on first access, status filter,
//          not-applicable toggle, category grouping
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

// ── SOC 2 Control Definitions (MVP — 33 controls) ────────────

const CONTROL_DEFINITIONS = [
  { id: 'CC1.1', category: 'CC1', title: 'Security policies documented and reviewed annually', description: 'The entity maintains and communicates policies that address security commitments and requirements.', autoDetectable: false, autoSource: null },
  { id: 'CC1.2', category: 'CC1', title: 'Organizational roles and responsibilities defined', description: 'The entity has defined organizational structures, reporting lines, and appropriate authorities.', autoDetectable: false, autoSource: null },
  { id: 'CC2.1', category: 'CC2', title: 'Security awareness training completed', description: 'Personnel receive security awareness training relevant to their role on hire and annually.', autoDetectable: false, autoSource: null },
  { id: 'CC2.2', category: 'CC2', title: 'Incident communication procedure exists', description: 'The entity communicates security incidents to affected parties and regulators as required.', autoDetectable: false, autoSource: null },
  { id: 'CC3.1', category: 'CC3', title: 'Formal risk assessment process documented', description: 'The entity identifies, analyzes, and responds to risks that could affect the achievement of objectives.', autoDetectable: false, autoSource: null },
  { id: 'CC3.2', category: 'CC3', title: 'Risks identified, evaluated, and prioritized', description: 'Risk assessment results are documented and risks are ranked by likelihood and impact.', autoDetectable: false, autoSource: null },
  { id: 'CC4.1', category: 'CC4', title: 'Security monitoring and logging enabled', description: 'The entity monitors system components and the operation of controls.', autoDetectable: true, autoSource: 'aws' },
  { id: 'CC4.2', category: 'CC4', title: 'Internal audit or review process defined', description: 'The entity evaluates and communicates internal control deficiencies in a timely manner.', autoDetectable: false, autoSource: null },
  { id: 'CC5.1', category: 'CC5', title: 'Encryption at rest implemented', description: 'The entity uses encryption to protect data at rest from unauthorized access.', autoDetectable: true, autoSource: 'aws' },
  { id: 'CC5.2', category: 'CC5', title: 'Encryption in transit (TLS) enforced', description: 'The entity uses TLS to protect data transmitted over networks.', autoDetectable: true, autoSource: 'github' },
  { id: 'CC5.3', category: 'CC5', title: 'Data retention policy documented', description: 'The entity has a documented data retention and disposal policy.', autoDetectable: false, autoSource: null },
  { id: 'CC6.1', category: 'CC6', title: 'Access provisioning requires approval', description: 'The entity authorizes, modifies, or removes access based on an approval process.', autoDetectable: true, autoSource: 'github' },
  { id: 'CC6.2', category: 'CC6', title: 'MFA enforced for all users', description: 'Multi-factor authentication is enforced for all user accounts.', autoDetectable: true, autoSource: 'github' },
  { id: 'CC6.3', category: 'CC6', title: 'Unique user accounts (no shared credentials)', description: 'Each user has a unique identifier and credentials are not shared.', autoDetectable: true, autoSource: 'github' },
  { id: 'CC6.4', category: 'CC6', title: 'Access reviews conducted quarterly', description: 'User access is reviewed quarterly to ensure it remains appropriate.', autoDetectable: false, autoSource: null },
  { id: 'CC6.5', category: 'CC6', title: 'Terminated employee access removed within 24h', description: 'Access for terminated personnel is removed within 24 hours of termination.', autoDetectable: false, autoSource: null },
  { id: 'CC6.6', category: 'CC6', title: 'Privileged access documented and limited', description: 'Privileged access is documented, limited to authorized users, and monitored.', autoDetectable: true, autoSource: 'github' },
  { id: 'CC6.7', category: 'CC6', title: 'Password policy enforced', description: 'Password complexity, rotation, and storage requirements are enforced.', autoDetectable: true, autoSource: 'github' },
  { id: 'CC7.1', category: 'CC7', title: 'System availability monitored', description: 'The entity monitors system availability and capacity to meet its objectives.', autoDetectable: true, autoSource: 'aws' },
  { id: 'CC7.2', category: 'CC7', title: 'Backup procedures documented and tested', description: 'The entity backs up data and systems and tests recovery procedures.', autoDetectable: true, autoSource: 'aws' },
  { id: 'CC7.3', category: 'CC7', title: 'Incident response plan exists', description: 'The entity has a documented and tested incident response plan.', autoDetectable: false, autoSource: null },
  { id: 'CC7.4', category: 'CC7', title: 'Vulnerability scanning performed regularly', description: 'The entity performs regular vulnerability scans and remediates findings.', autoDetectable: false, autoSource: null },
  { id: 'CC7.5', category: 'CC7', title: 'Penetration testing conducted annually', description: 'Annual penetration testing is performed by qualified testers.', autoDetectable: false, autoSource: null },
  { id: 'CC8.1', category: 'CC8', title: 'Change management process documented', description: 'Changes to system components are authorized and documented.', autoDetectable: true, autoSource: 'github' },
  { id: 'CC8.2', category: 'CC8', title: 'Code review required before deployment', description: 'All code changes undergo peer review before merging to production.', autoDetectable: true, autoSource: 'github' },
  { id: 'CC8.3', category: 'CC8', title: 'Separate dev/staging/production environments', description: 'Development, staging, and production environments are separated.', autoDetectable: true, autoSource: 'github' },
  { id: 'CC8.4', category: 'CC8', title: 'Deployment pipeline documented', description: 'The deployment process is documented and follows an automated pipeline.', autoDetectable: true, autoSource: 'github' },
  { id: 'CC9.1', category: 'CC9', title: 'Third-party vendor risk assessment process', description: 'The entity assesses vendor risk before engagement and on an ongoing basis.', autoDetectable: false, autoSource: null },
  { id: 'CC9.2', category: 'CC9', title: 'Vendor contracts include security requirements', description: 'Vendor agreements include data security obligations and SLAs.', autoDetectable: false, autoSource: null },
  { id: 'CC9.3', category: 'CC9', title: 'Business continuity plan documented', description: 'The entity has a documented business continuity plan that is tested annually.', autoDetectable: false, autoSource: null },
  { id: 'CC9.4', category: 'CC9', title: 'Disaster recovery plan documented and tested', description: 'A disaster recovery plan exists, is tested, and RTO/RPO are defined.', autoDetectable: false, autoSource: null },
  { id: 'CC9.5', category: 'CC9', title: 'Cyber liability insurance in place', description: 'The entity maintains cyber liability insurance appropriate for its risk profile.', autoDetectable: false, autoSource: null },
  { id: 'CC9.6', category: 'CC9', title: 'Sub-processors listed and documented', description: 'All sub-processors handling customer data are identified, documented, and assessed.', autoDetectable: false, autoSource: null },
];

// ── Seed controls for a new user ─────────────────────────────

async function seedControlsIfNeeded(userId) {
  const seedKey = `user:${userId}:seeded`;
  const seeded = await redis.get(seedKey);
  if (seeded) return;

  const now = new Date().toISOString();
  for (const def of CONTROL_DEFINITIONS) {
    const key = `control:${userId}:${def.id}`;
    const existing = await redis.get(key);
    if (!existing) {
      await redis.set(key, JSON.stringify({
        id: def.id,
        category: def.category,
        title: def.title,
        description: def.description,
        status: 'NOT_STARTED',
        evidenceItems: [],
        autoDetectable: def.autoDetectable,
        autoSource: def.autoSource,
        notApplicable: false,
        lastUpdated: now,
      }));
    }
  }
  await redis.set(seedKey, '1');
}

// ── Build control list with live Redis data ───────────────────

async function getControlsForUser(userId, filterCategory, filterStatus) {
  await seedControlsIfNeeded(userId);

  const controls = [];
  for (const def of CONTROL_DEFINITIONS) {
    const key = `control:${userId}:${def.id}`;
    try {
      const raw = await redis.get(key);
      let control;
      if (raw) {
        control = typeof raw === 'object' ? raw : JSON.parse(raw);
        // Merge definition fields in case definitions were updated
        control.title = def.title;
        control.description = def.description;
        control.autoDetectable = def.autoDetectable;
        control.autoSource = def.autoSource;
      } else {
        control = {
          id: def.id, category: def.category, title: def.title,
          description: def.description, status: 'NOT_STARTED',
          evidenceItems: [], autoDetectable: def.autoDetectable,
          autoSource: def.autoSource, notApplicable: false,
          lastUpdated: new Date().toISOString(),
        };
      }
      if (filterCategory && control.category !== filterCategory) continue;
      if (filterStatus && control.status !== filterStatus) continue;
      controls.push(control);
    } catch {}
  }
  return controls;
}

// ── Group controls by category ────────────────────────────────

function groupByCategory(controls) {
  const groups = {};
  for (const c of controls) {
    if (!groups[c.category]) groups[c.category] = [];
    groups[c.category].push(c);
  }
  return groups;
}

// ── Main handler ─────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const userId = await getUserId(req.headers.authorization);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  // ── GET: Return all 33 controls (optionally filtered) ────────
  if (req.method === 'GET') {
    try {
      const { category, status, grouped } = req.query;
      const controls = await getControlsForUser(userId, category, status);
      if (grouped === 'true') {
        return res.status(200).json({ controls, grouped: groupByCategory(controls), total: controls.length });
      }
      return res.status(200).json({ controls, total: controls.length });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── PATCH: Update control status or not-applicable toggle ────
  if (req.method === 'PATCH') {
    try {
      const { controlId, status, notApplicable, note } = req.body || {};
      if (!controlId) return res.status(400).json({ error: 'Missing controlId' });

      const validStatuses = ['NOT_STARTED', 'IN_PROGRESS', 'EVIDENCE_UPLOADED', 'CONNECTED_AUTO', 'NOT_APPLICABLE'];
      if (status && !validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }

      const key = `control:${userId}:${controlId}`;
      let control = {};
      const raw = await redis.get(key);
      if (raw) control = typeof raw === 'object' ? raw : JSON.parse(raw);

      // Prevent overwriting auto-detected statuses with lower ones
      const statusRank = { NOT_STARTED: 0, IN_PROGRESS: 1, EVIDENCE_UPLOADED: 2, CONNECTED_AUTO: 3, NOT_APPLICABLE: -1 };
      if (status) {
        const currentRank = statusRank[control.status] ?? 0;
        const newRank = statusRank[status] ?? 0;
        // Allow explicit NOT_APPLICABLE toggle, and upgrades
        if (status === 'NOT_APPLICABLE' || newRank >= currentRank) {
          control.status = status;
        }
      }

      if (typeof notApplicable === 'boolean') {
        control.notApplicable = notApplicable;
        if (notApplicable) control.status = 'NOT_APPLICABLE';
        else if (control.status === 'NOT_APPLICABLE') control.status = 'NOT_STARTED';
      }

      if (note !== undefined) control.note = note;
      control.lastUpdated = new Date().toISOString();

      await redis.set(key, JSON.stringify(control));

      // Recompute score after status change
      const { recomputeScore } = await import('./scan.js');
      const newScore = await recomputeScore(userId);

      return res.status(200).json({ ok: true, control, newScore });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
