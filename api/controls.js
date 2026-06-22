// ─────────────────────────────────────────────────────────────
// api/controls.js
// ACTION: REFACTORED from api/agents.js
//
//   GET   /api/controls                   → return all 49 controls + statuses
//   GET   /api/controls?category=CC6      → filter by category
//   GET   /api/controls?status=NOT_STARTED → filter by status
//   PATCH /api/controls                   → update control status / not-applicable toggle
//
// KEPT:    Redis client, auth middleware, CORS headers
// REMOVED: Agent CRUD, GitHub repo deletion, agent upsert logic
// ADDED:   49-control SOC 2 seed on first access, status filter,
//          not-applicable toggle, category grouping,
//          evidenceGuidance field per control for actionable guidance
// ─────────────────────────────────────────────────────────────

import { Redis } from '@upstash/redis';
import { verifySession } from './_telemetry.js';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

// ── Auth helpers ─────────────────────────────────────────────

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

// ── SOC 2 Control Definitions (49 controls) ──────────────────

const CONTROL_DEFINITIONS = [
  // ── CC1: Control Environment ─────────────────────────────────
  {
    id: 'CC1.1', category: 'CC1',
    title: 'Security policies documented and reviewed annually',
    description: 'The entity maintains and communicates policies that address security commitments and requirements.',
    autoDetectable: false, autoSource: null,
    evidenceGuidance: 'Upload your Information Security Policy document. Should include: scope, policy owner, review date within the last 12 months, and management signature or approval.',
  },
  {
    id: 'CC1.2', category: 'CC1',
    title: 'Organizational roles and responsibilities defined',
    description: 'The entity has defined organizational structures, reporting lines, and appropriate authorities.',
    autoDetectable: false, autoSource: null,
    evidenceGuidance: 'Upload an org chart or RACI matrix showing security roles and reporting structure. Alternatively, provide a link to your internal responsibility assignment documentation.',
  },
  {
    id: 'CC1.3', category: 'CC1',
    title: 'Code of conduct and ethics policy documented',
    description: 'The entity has a documented code of conduct and ethical standards for all personnel.',
    autoDetectable: false, autoSource: null,
    evidenceGuidance: 'Upload your code of conduct or employee handbook section covering ethical standards. Include evidence that all employees have signed/acknowledged it (e.g., acknowledgment log or onboarding checklist).',
  },
  {
    id: 'CC1.4', category: 'CC1',
    title: 'Background checks conducted for new hires',
    description: 'Employment background checks are conducted for new hires with access to sensitive systems.',
    autoDetectable: false, autoSource: null,
    evidenceGuidance: 'Provide your HR policy requiring background checks, and a sample background check completion confirmation (with PII redacted). Do not upload actual background check reports.',
  },

  // ── CC2: Communication & Information ─────────────────────────
  {
    id: 'CC2.1', category: 'CC2',
    title: 'Security awareness training completed',
    description: 'Personnel receive security awareness training relevant to their role on hire and annually.',
    autoDetectable: false, autoSource: null,
    evidenceGuidance: 'Upload a training completion report showing all employees completed security awareness training within the last 12 months. Include the training curriculum outline or a screenshot from your LMS (e.g., KnowBe4, Curricula).',
  },
  {
    id: 'CC2.2', category: 'CC2',
    title: 'Incident communication procedure exists',
    description: 'The entity communicates security incidents to affected parties and regulators as required.',
    autoDetectable: false, autoSource: null,
    evidenceGuidance: 'Upload your incident communication plan or the relevant section of your incident response plan. Should define: who is notified, notification timelines (e.g., 72 hours for GDPR), communication templates.',
  },
  {
    id: 'CC2.3', category: 'CC2',
    title: 'Security incidents communicated to management',
    description: 'Security incidents are escalated to management in a timely manner per defined procedures.',
    autoDetectable: false, autoSource: null,
    evidenceGuidance: 'Provide your incident escalation matrix or procedure showing how and when incidents are escalated to management. An example of a past incident report (sanitized) is strong evidence.',
  },

  // ── CC3: Risk Assessment ──────────────────────────────────────
  {
    id: 'CC3.1', category: 'CC3',
    title: 'Formal risk assessment process documented',
    description: 'The entity identifies, analyzes, and responds to risks that could affect the achievement of objectives.',
    autoDetectable: false, autoSource: null,
    evidenceGuidance: 'Upload your risk assessment policy or procedure. Should describe: scope, methodology (likelihood × impact), review frequency (at least annual), and risk owner assignments.',
  },
  {
    id: 'CC3.2', category: 'CC3',
    title: 'Risks identified, evaluated, and prioritized',
    description: 'Risk assessment results are documented and risks are ranked by likelihood and impact.',
    autoDetectable: false, autoSource: null,
    evidenceGuidance: 'Upload your current risk register. It should include: risk ID, description, likelihood, impact, risk score, owner, and current mitigation status. Even a spreadsheet is acceptable.',
  },
  {
    id: 'CC3.3', category: 'CC3',
    title: 'Risk treatment decisions documented',
    description: 'Decisions to accept, mitigate, transfer, or avoid identified risks are documented and reviewed.',
    autoDetectable: false, autoSource: null,
    evidenceGuidance: 'Provide a risk treatment plan or the risk register with treatment decisions filled in. For accepted risks, show management sign-off. Accepted risk documentation is critical for auditors.',
  },

  // ── CC4: Monitoring of Controls ───────────────────────────────
  {
    id: 'CC4.1', category: 'CC4',
    title: 'Security monitoring and logging enabled',
    description: 'The entity monitors system components and the operation of controls.',
    autoDetectable: false, autoSource: null, // AWS scanning not live yet — don't promise auto-fill
    evidenceGuidance: 'For AWS: export a screenshot of CloudTrail enabled across all regions, and CloudWatch alarms configured. For other providers: export your logging configuration dashboard showing audit logs are enabled.',
  },
  {
    id: 'CC4.2', category: 'CC4',
    title: 'Internal audit or review process defined',
    description: 'The entity evaluates and communicates internal control deficiencies in a timely manner.',
    autoDetectable: false, autoSource: null,
    evidenceGuidance: 'Upload your internal audit charter or schedule showing annual security control reviews. Meeting minutes or review reports from internal security reviews are strong evidence.',
  },

  // ── CC5: Control Activities ───────────────────────────────────
  {
    id: 'CC5.1', category: 'CC5',
    title: 'Encryption at rest implemented',
    description: 'The entity uses encryption to protect data at rest from unauthorized access.',
    autoDetectable: false, autoSource: null, // AWS scanning not live yet — don't promise auto-fill
    evidenceGuidance: 'For AWS: screenshot of S3 bucket encryption settings (SSE-S3 or SSE-KMS enabled) and RDS encryption enabled. For other providers: export encryption configuration. Include your encryption policy document.',
  },
  {
    id: 'CC5.2', category: 'CC5',
    title: 'Encryption in transit (TLS) enforced',
    description: 'The entity uses TLS to protect data transmitted over networks.',
    autoDetectable: true, autoSource: 'github',
    evidenceGuidance: 'Provide an SSL Labs scan result (ssllabs.com/ssltest/) showing A or A+ rating for your main domain. Also screenshot your load balancer or API gateway showing HTTPS-only is enforced and HTTP is redirected.',
  },
  {
    id: 'CC5.3', category: 'CC5',
    title: 'Data retention policy documented',
    description: 'The entity has a documented data retention and disposal policy.',
    autoDetectable: false, autoSource: null,
    evidenceGuidance: 'Upload your data retention policy. Should specify retention periods by data type, disposal methods (secure deletion/overwriting), and who is responsible for enforcement.',
  },
  {
    id: 'CC5.4', category: 'CC5',
    title: 'Encryption key management procedures documented',
    description: 'Cryptographic key lifecycle (generation, storage, rotation, retirement) is documented and followed.',
    autoDetectable: false, autoSource: null,
    evidenceGuidance: 'Upload your key management policy or procedure. If using AWS KMS or similar: screenshot showing key rotation is enabled for all customer-managed keys. Document who has key administrator access.',
  },
  {
    id: 'CC5.5', category: 'CC5',
    title: 'Data classification policy exists',
    description: 'Data is classified by sensitivity level and handled according to classification requirements.',
    autoDetectable: false, autoSource: null,
    evidenceGuidance: 'Upload your data classification policy defining classification levels (e.g., Public, Internal, Confidential, Restricted) and handling requirements for each level.',
  },

  // ── CC6: Logical & Physical Access Controls ───────────────────
  {
    id: 'CC6.1', category: 'CC6',
    title: 'Access provisioning requires approval',
    description: 'The entity authorizes, modifies, or removes access based on an approval process.',
    autoDetectable: true, autoSource: 'github',
    evidenceGuidance: 'Provide your access request and approval procedure. For GitHub: screenshot of org settings showing teams and protected branch rules. Show examples of access provisioning tickets or approvals (from Jira, Slack, etc.).',
  },
  {
    id: 'CC6.2', category: 'CC6',
    title: 'MFA enforced for all users',
    description: 'Multi-factor authentication is enforced for all user accounts.',
    autoDetectable: true, autoSource: 'github',
    evidenceGuidance: 'Export a screenshot from GitHub (Settings > Organization > Authentication security) showing "Require two-factor authentication" is checked, OR from your identity provider (Okta, Google Workspace) showing MFA is enforced for all users.',
  },
  {
    id: 'CC6.3', category: 'CC6',
    title: 'Unique user accounts (no shared credentials)',
    description: 'Each user has a unique identifier and credentials are not shared.',
    autoDetectable: false, autoSource: null,
    evidenceGuidance: 'Provide a screenshot of your user directory (Okta, Google Workspace, AWS IAM) showing individual named accounts. Document your policy prohibiting shared credentials. A signed policy acknowledgment is acceptable.',
  },
  {
    id: 'CC6.4', category: 'CC6',
    title: 'Access reviews conducted quarterly',
    description: 'User access is reviewed quarterly to ensure it remains appropriate.',
    autoDetectable: false, autoSource: null,
    evidenceGuidance: 'Upload a user access review report from the last quarter. Should show: reviewer, review date, list of users reviewed, access confirmed or changes made. A spreadsheet with manager sign-off is acceptable for Type 1.',
  },
  {
    id: 'CC6.5', category: 'CC6',
    title: 'Terminated employee access removed within 24h',
    description: 'Access for terminated personnel is removed within 24 hours of termination.',
    autoDetectable: false, autoSource: null,
    evidenceGuidance: 'Provide your offboarding procedure showing the access revocation SLA. An example offboarding ticket (sanitized) showing access revocation timestamps is strong supporting evidence.',
  },
  {
    id: 'CC6.6', category: 'CC6',
    title: 'Privileged access documented and limited',
    description: 'Privileged access is documented, limited to authorized users, and monitored.',
    autoDetectable: true, autoSource: 'github',
    evidenceGuidance: 'Provide a list of users with admin/privileged access across your key systems (GitHub, AWS, databases). Show the business justification for each privileged user. Include your privileged access management policy.',
  },
  {
    id: 'CC6.7', category: 'CC6',
    title: 'Password policy enforced',
    description: 'Password complexity, rotation, and storage requirements are enforced.',
    autoDetectable: false, autoSource: null,
    evidenceGuidance: 'Screenshot your identity provider (Okta, Google Workspace, AD) showing password policy settings: minimum length (12+ chars), complexity requirements, and lockout policy. Upload your documented password policy.',
  },
  {
    id: 'CC6.8', category: 'CC6',
    title: 'Physical access to systems restricted',
    description: 'Physical access to servers, network equipment, and workstations is restricted to authorized personnel.',
    autoDetectable: false, autoSource: null,
    evidenceGuidance: 'If cloud-only: provide your cloud provider\'s SOC 2 report (e.g., AWS SOC 2) showing physical security controls — you can inherit these. If you have on-premise equipment: photo/description of physical access controls (badge readers, locked racks).',
  },
  {
    id: 'CC6.9', category: 'CC6',
    title: 'Remote access secured with MFA and VPN',
    description: 'Remote access to internal systems requires MFA and uses encrypted channels (VPN or equivalent).',
    autoDetectable: false, autoSource: null,
    evidenceGuidance: 'Screenshot your VPN or zero-trust access solution (Tailscale, Cloudflare Access, etc.) showing it is required for internal system access. Show MFA is configured. Upload your remote access policy.',
  },

  // ── CC7: System Operations ────────────────────────────────────
  {
    id: 'CC7.1', category: 'CC7',
    title: 'System availability monitored',
    description: 'The entity monitors system availability and capacity to meet its objectives.',
    autoDetectable: false, autoSource: null, // AWS scanning not live yet — don't promise auto-fill
    evidenceGuidance: 'Screenshot your uptime monitoring dashboard (Datadog, PagerDuty, StatusPage, AWS CloudWatch). Show configured alerts for availability thresholds. Include your uptime SLA documentation.',
  },
  {
    id: 'CC7.2', category: 'CC7',
    title: 'Backup procedures documented and tested',
    description: 'The entity backs up data and systems and tests recovery procedures.',
    autoDetectable: false, autoSource: null, // AWS scanning not live yet — don't promise auto-fill
    evidenceGuidance: 'Screenshot your backup configuration (AWS Backup, RDS automated backups, etc.) showing backup frequency and retention. Upload a backup restoration test report — showing you actually tested a restore is critical for auditors.',
  },
  {
    id: 'CC7.3', category: 'CC7',
    title: 'Incident response plan exists',
    description: 'The entity has a documented and tested incident response plan.',
    autoDetectable: false, autoSource: null,
    evidenceGuidance: 'Upload your Incident Response Plan (IRP). Should include: severity levels, response procedures per severity, roles and responsibilities, escalation paths, communication templates, and post-incident review process. NIST SP 800-61 is a common template.',
  },
  {
    id: 'CC7.4', category: 'CC7',
    title: 'Vulnerability scanning performed regularly',
    description: 'The entity performs regular vulnerability scans and remediates findings.',
    autoDetectable: false, autoSource: null,
    evidenceGuidance: 'Upload a vulnerability scan report from the last 90 days (from Qualys, Nessus, Tenable.io, AWS Inspector, or similar). Include your remediation tracking showing how findings are prioritized and resolved.',
  },
  {
    id: 'CC7.5', category: 'CC7',
    title: 'Penetration testing conducted annually',
    description: 'Annual penetration testing is performed by qualified testers.',
    autoDetectable: false, autoSource: null,
    evidenceGuidance: 'Upload an executive summary from your annual penetration test report (from a qualified third party). Include the scope, key findings, and remediation status. Full reports can be shared under NDA with auditors.',
  },
  {
    id: 'CC7.6', category: 'CC7',
    title: 'System capacity and performance monitored',
    description: 'System capacity thresholds are defined and monitored; alerts are configured for anomalous conditions.',
    autoDetectable: false, autoSource: null,
    evidenceGuidance: 'Screenshot your performance monitoring dashboard showing CPU, memory, disk, and network metrics with configured alert thresholds. Datadog, CloudWatch, New Relic screenshots are all acceptable.',
  },

  // ── CC8: Change Management ────────────────────────────────────
  {
    id: 'CC8.1', category: 'CC8',
    title: 'Change management process documented',
    description: 'Changes to system components are authorized and documented.',
    autoDetectable: true, autoSource: 'github',
    evidenceGuidance: 'Provide a link to or screenshot of your PR/merge request process. Show that changes require review and approval before merging. A written change management policy or the GitHub branch protection settings showing required reviews is sufficient.',
  },
  {
    id: 'CC8.2', category: 'CC8',
    title: 'Code review required before deployment',
    description: 'All code changes undergo peer review before merging to production.',
    autoDetectable: true, autoSource: 'github',
    evidenceGuidance: 'Export a screenshot from GitHub (repo Settings > Branches > Branch protection rules) showing "Require a pull request before merging" and "Require approvals" (at least 1) are enabled for main/master.',
  },
  {
    id: 'CC8.3', category: 'CC8',
    title: 'Separate dev/staging/production environments',
    description: 'Development, staging, and production environments are separated.',
    autoDetectable: true, autoSource: 'github',
    evidenceGuidance: 'Provide a diagram or description of your environment architecture showing separation between dev, staging, and production. Screenshot GitHub environment configurations or your CI/CD pipeline showing different deployment targets.',
  },
  {
    id: 'CC8.4', category: 'CC8',
    title: 'Deployment pipeline documented',
    description: 'The deployment process is documented and follows an automated pipeline.',
    autoDetectable: true, autoSource: 'github',
    evidenceGuidance: 'Screenshot your CI/CD pipeline (GitHub Actions, CircleCI, etc.) showing automated testing and deployment steps. Upload a brief description of your deployment process including any manual approval gates for production deployments.',
  },
  {
    id: 'CC8.5', category: 'CC8',
    title: 'Security testing performed before deployments',
    description: 'Security testing (SAST/DAST/dependency scanning) is performed as part of the deployment pipeline.',
    autoDetectable: true, autoSource: 'github',
    evidenceGuidance: 'Screenshot your GitHub Actions or CI workflow showing security scanning steps (CodeQL, Dependabot, Snyk, OWASP ZAP, etc.). Show that security scan failures block deployment.',
  },
  {
    id: 'CC8.6', category: 'CC8',
    title: 'Rollback procedures documented and tested',
    description: 'Rollback/rollforward procedures are documented and tested for all production deployments.',
    autoDetectable: false, autoSource: null,
    evidenceGuidance: 'Upload your rollback procedure documentation. Should describe: how to trigger a rollback, rollback decision authority, time objective (RTO for rollback). Evidence of a tested rollback (e.g., post-incident report or drill record) is ideal.',
  },

  // ── CC9: Risk Mitigation ──────────────────────────────────────
  {
    id: 'CC9.1', category: 'CC9',
    title: 'Third-party vendor risk assessment process',
    description: 'The entity assesses vendor risk before engagement and on an ongoing basis.',
    autoDetectable: false, autoSource: null,
    evidenceGuidance: 'Upload your vendor risk assessment procedure and a completed vendor risk assessment form for a key vendor (e.g., your cloud provider, payment processor). Show how vendors are tiered by risk level.',
  },
  {
    id: 'CC9.2', category: 'CC9',
    title: 'Vendor contracts include security requirements',
    description: 'Vendor agreements include data security obligations and SLAs.',
    autoDetectable: false, autoSource: null,
    evidenceGuidance: 'Provide a Data Processing Agreement (DPA) or BAA signed with a key vendor. Alternatively, upload a vendor security addendum that you require vendors to sign. Redact sensitive commercial terms if needed.',
  },
  {
    id: 'CC9.3', category: 'CC9',
    title: 'Business continuity plan documented',
    description: 'The entity has a documented business continuity plan that is tested annually.',
    autoDetectable: false, autoSource: null,
    evidenceGuidance: 'Upload your Business Continuity Plan (BCP). Should include: business impact analysis, recovery priorities, RTO/RPO targets, contact lists, and annual test results.',
  },
  {
    id: 'CC9.4', category: 'CC9',
    title: 'Disaster recovery plan documented and tested',
    description: 'A disaster recovery plan exists, is tested, and RTO/RPO are defined.',
    autoDetectable: false, autoSource: null,
    evidenceGuidance: 'Upload your Disaster Recovery Plan with defined RTO and RPO. Include your most recent DR test results or tabletop exercise report. Auditors want to see that you have actually tested recovery, not just documented it.',
  },
  {
    id: 'CC9.5', category: 'CC9',
    title: 'Cyber liability insurance in place',
    description: 'The entity maintains cyber liability insurance appropriate for its risk profile.',
    autoDetectable: false, autoSource: null,
    evidenceGuidance: 'Upload the declarations page (cover page) of your cyber liability insurance policy showing coverage amounts and policy period. Redact the premium amount if desired. Do not upload the full policy.',
  },
  {
    id: 'CC9.6', category: 'CC9',
    title: 'Sub-processors listed and documented',
    description: 'All sub-processors handling customer data are identified, documented, and assessed.',
    autoDetectable: false, autoSource: null,
    evidenceGuidance: 'Upload or link to your sub-processor list. This is often published publicly for GDPR compliance. Should include: sub-processor name, data category processed, location, and your legal basis for using them.',
  },
  {
    id: 'CC9.7', category: 'CC9',
    title: 'Employee offboarding checklist includes system access revocation',
    description: 'A formal offboarding checklist ensures all system access is revoked when an employee leaves.',
    autoDetectable: false, autoSource: null,
    evidenceGuidance: 'Upload your employee offboarding checklist. It should include: specific systems to revoke access from, responsible owner for each action, and a completion sign-off step. Ideally tied to your HR system.',
  },
  {
    id: 'CC9.8', category: 'CC9',
    title: 'Security incident response retainer or contact identified',
    description: 'An external security incident response firm or retainer is identified for use in major incidents.',
    autoDetectable: false, autoSource: null,
    evidenceGuidance: 'Provide a contract or engagement letter with an incident response firm, or a written policy naming the firm you would engage in a major incident. Having a retainer in place is preferred but not required for Type 1.',
  },
  {
    id: 'CC9.9', category: 'CC9',
    title: 'Annual SOC 2 readiness review conducted',
    description: 'Management conducts an annual review of SOC 2 compliance posture and gap remediation progress.',
    autoDetectable: false, autoSource: null,
    evidenceGuidance: 'Provide meeting minutes or a report from your most recent SOC 2 readiness review meeting (e.g., security steering committee). Should show what gaps were reviewed and what remediation actions were assigned.',
  },
  {
    id: 'CC9.10', category: 'CC9',
    title: 'Privacy policy published and current',
    description: 'A public privacy policy is published, reviewed annually, and accurately reflects data handling practices.',
    autoDetectable: false, autoSource: null,
    evidenceGuidance: 'Provide a link to your live public privacy policy. It should show a "last updated" date within the last 12 months. Keep a copy of the policy and evidence of annual legal review.',
  },
  {
    id: 'CC9.11', category: 'CC9',
    title: 'Terms of service documented for customers',
    description: 'Customer-facing terms of service are documented, legally reviewed, and include security provisions.',
    autoDetectable: false, autoSource: null,
    evidenceGuidance: 'Provide a link to your live Terms of Service. Upload evidence that the ToS has been legally reviewed (e.g., email confirmation from legal counsel). The ToS should reference data security obligations.',
  },
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
        evidenceGuidance: def.evidenceGuidance || null,
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
        control.evidenceGuidance = def.evidenceGuidance || null;
      } else {
        control = {
          id: def.id, category: def.category, title: def.title,
          description: def.description, status: 'NOT_STARTED',
          evidenceItems: [], autoDetectable: def.autoDetectable,
          autoSource: def.autoSource, evidenceGuidance: def.evidenceGuidance || null,
          notApplicable: false, lastUpdated: new Date().toISOString(),
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
  const _origin = req.headers.origin || '';
  const _originOk = /^https:\/\/(auditready\.space|[a-z0-9-]+\.vercel\.app)$/i.test(_origin);
  res.setHeader('Access-Control-Allow-Origin', _originOk ? _origin : 'https://auditready.space');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const userId = await getUserId(req.headers.authorization);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  // ── GET: Return all 49 controls (optionally filtered) ────────
  if (req.method === 'GET') {
    try {
      const { category, status, grouped } = req.query;
      const controls = await getControlsForUser(userId, category, status);
      if (grouped === 'true') {
        return res.status(200).json({ controls, grouped: groupByCategory(controls), total: controls.length });
      }
      return res.status(200).json({ controls, total: controls.length });
    } catch (err) {
      return res.status(500).json({ error: 'Internal error. Please try again.' });
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
      return res.status(500).json({ error: 'Internal error. Please try again.' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
