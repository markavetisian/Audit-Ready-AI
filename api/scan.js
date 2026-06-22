// ─────────────────────────────────────────────────────────────
// api/scan.js
// ACTION: REFACTORED from api/analyze.js
//
//   POST /api/scan → trigger GitHub + Google Drive compliance scan
//   GET  /api/scan → get last scan status + results for user
//
// KEPT:    Groq client init pattern, Redis client, CORS, error handling
//          isBlocked, checkRateLimit from telemetry.js
// REMOVED: Agent analysis prompt, website fetching, chat mode
//          SHA-256 anti-spam logic (repurposed as rate limiter via checkRateLimit)
// ADDED:   GitHub org/repo scanning logic mapped to SOC 2 controls
//          Google Drive folder scanning for evidence keywords
//          Control status updater, scannedAt timestamp writer
//          Detection details object for transparency
// ─────────────────────────────────────────────────────────────

import { Redis } from '@upstash/redis';
import { trackUser, isBlocked, checkRateLimit, logError, verifySession, getUserMode, withLock } from './_telemetry.js';
import { seedControlsIfNeeded } from './controls.js';

// Give the scan extra headroom — multi-repo GitHub + Drive crawls can exceed
// the default 10s serverless cap. 60s is the maximum on the Hobby plan.
export const config = { maxDuration: 60 };

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

function getGitHubToken(authHeader) {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  return (token.startsWith('s1.') || token.startsWith('google:') || token.startsWith('slack:')) ? null : token;
}

// ── GitHub scanning helpers ──────────────────────────────────

async function ghGet(path, token) {
  try {
    const r = await fetch(`https://api.github.com/${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'AuditReady-AI' },
    });
    if (!r.ok) return null;
    return r.json();
  } catch { return null; }
}

export async function scanGitHub(token) {
  const results = {};
  const detectionDetails = {};

  // Get authenticated user
  const user = await ghGet('user', token);
  if (!user) return { results, detectionDetails };
  const owner = user.login;

  // Get orgs + repos in parallel
  const [orgs, repos] = await Promise.all([
    ghGet('user/orgs', token),
    ghGet(`users/${owner}/repos?per_page=50&sort=updated`, token),
  ]);
  const orgLogin = (orgs || [])[0]?.login || null;
  const mainRepo = (repos || [])[0] || null;

  // ── Phase 2: fire all independent repo/org-level lookups in parallel ──
  const repoBase = mainRepo ? `repos/${owner}/${mainRepo.name}` : null;
  const [
    branches, pulls, workflows, collaborators,
    codeownersRoot, codeownersGh, dependabot, codeql,
    secMdRoot, secMdGh, secretScan,
    orgData, auditLog,
  ] = await Promise.all([
    repoBase ? ghGet(`${repoBase}/branches`, token) : null,
    repoBase ? ghGet(`${repoBase}/pulls?state=closed&per_page=10`, token) : null,
    repoBase ? ghGet(`${repoBase}/actions/workflows`, token) : null,
    repoBase ? ghGet(`${repoBase}/collaborators`, token) : null,
    repoBase ? ghGet(`${repoBase}/contents/CODEOWNERS`, token) : null,
    repoBase ? ghGet(`${repoBase}/contents/.github/CODEOWNERS`, token) : null,
    repoBase ? ghGet(`${repoBase}/contents/.github/dependabot.yml`, token) : null,
    repoBase ? ghGet(`${repoBase}/code-scanning/alerts?per_page=1&state=open`, token) : null,
    repoBase ? ghGet(`${repoBase}/contents/SECURITY.md`, token) : null,
    repoBase ? ghGet(`${repoBase}/contents/.github/SECURITY.md`, token) : null,
    repoBase ? ghGet(`${repoBase}/secret-scanning/alerts?per_page=1`, token) : null,
    orgLogin ? ghGet(`orgs/${orgLogin}`, token) : null,
    orgLogin ? ghGet(`orgs/${orgLogin}/audit-log?per_page=1`, token) : null,
  ]);

  if (mainRepo) {
    // ── CC8.2 — Branch protection / required PR reviews ──────────
    const branchList = branches || [];
    const mainBranch = branchList.find(b => b.name === 'main' || b.name === 'master');
    if (mainBranch) {
      const protection = await ghGet(`${repoBase}/branches/${mainBranch.name}/protection`, token);
      if (protection && protection.required_pull_request_reviews) {
        results['CC8.2'] = 'CONNECTED_AUTO';
        detectionDetails['CC8.2'] = `Branch protection enabled on ${mainBranch.name} branch of ${mainRepo.name} with required PR reviews`;
      }
    }
    // ── CC8.3 — Separate dev/staging/prod environments ──────────
    const branchNames = branchList.map(b => b.name);
    const envBranches = branchNames.filter(n => n.includes('staging') || n.includes('develop') || n.includes('dev') || n.includes('prod'));
    if (envBranches.length > 0) {
      results['CC8.3'] = 'CONNECTED_AUTO';
      detectionDetails['CC8.3'] = `Environment branches detected: ${envBranches.slice(0, 3).join(', ')} in repo ${mainRepo.name}`;
    }

    // ── CC8.1 — Change management (PRs exist) ────────────────────
    if ((pulls || []).length > 0) {
      results['CC8.1'] = 'CONNECTED_AUTO';
      detectionDetails['CC8.1'] = `${pulls.length} closed pull requests found in ${mainRepo.name} — pull request workflow is in use`;
    }

    // ── CC8.4 — Deployment pipeline (workflows exist) ────────────
    if (workflows?.workflows?.length > 0) {
      results['CC8.4'] = 'CONNECTED_AUTO';
      detectionDetails['CC8.4'] = `${workflows.workflows.length} GitHub Actions workflow(s) found in ${mainRepo.name}: ${workflows.workflows.slice(0, 2).map(w => w.name).join(', ')}`;
    }

    // ── CC5.2 — TLS enforced — directional signal only ───────────
    if (mainRepo.homepage && mainRepo.homepage.startsWith('https://')) {
      results['CC5.2'] = 'IN_PROGRESS';
      detectionDetails['CC5.2'] = `Repo homepage URL uses HTTPS: ${mainRepo.homepage} — directional signal only, manual verification needed`;
    }

    // ── CC8.5 — Security testing in pipeline ────────────────────
    if (workflows?.workflows?.length > 0) {
      const wfNames = workflows.workflows.map(w => (w.name || '').toLowerCase());
      const hasSecurityWf = wfNames.some(n => n.includes('security') || n.includes('sast') || n.includes('codeql') || n.includes('snyk') || n.includes('dependabot') || n.includes('scan'));
      if (hasSecurityWf) {
        results['CC8.5'] = 'CONNECTED_AUTO';
        detectionDetails['CC8.5'] = `Security-related workflow detected: ${workflows.workflows.find(w => {
          const n = (w.name || '').toLowerCase();
          return n.includes('security') || n.includes('sast') || n.includes('codeql') || n.includes('snyk') || n.includes('dependabot') || n.includes('scan');
        })?.name}`;
      }
    }

    // ── CC6.1 — Access provisioning (collaborators exist) ────────
    if ((collaborators || []).length > 0) {
      results['CC6.1'] = 'CONNECTED_AUTO';
      detectionDetails['CC6.1'] = `${collaborators.length} collaborator(s) found on ${mainRepo.name} — access provisioning via GitHub is in use`;
    }

    // CODEOWNERS file → CC8.2 (code review ownership defined)
    const codeowners = codeownersRoot || codeownersGh;
    if (codeowners && !codeowners.message) {
      results['CC8.2'] = 'CONNECTED_AUTO';
      detectionDetails['CC8.2'] = (detectionDetails['CC8.2'] || '') + ' | CODEOWNERS file found';
    }

    // Dependabot config → CC8.5 + CC7.4
    if (dependabot && !dependabot.message) {
      results['CC8.5'] = results['CC8.5'] || 'CONNECTED_AUTO';
      results['CC7.4'] = results['CC7.4'] || 'IN_PROGRESS';
      detectionDetails['CC8.5'] = (detectionDetails['CC8.5'] || '') + ' | Dependabot enabled';
      detectionDetails['CC7.4'] = 'Dependabot detected — add vuln scan reports for full credit';
    }

    // CodeQL / code scanning → CC7.5
    if (Array.isArray(codeql)) {
      results['CC7.5'] = results['CC7.5'] || 'IN_PROGRESS';
      detectionDetails['CC7.5'] = 'Code scanning active on ' + mainRepo.name + ' — add formal pentest report for full credit';
    }

    // SECURITY.md → CC1.1 directional signal
    const secMd = secMdRoot || secMdGh;
    if (secMd && !secMd.message) {
      results['CC1.1'] = results['CC1.1'] || 'IN_PROGRESS';
      detectionDetails['CC1.1'] = 'SECURITY.md found — upload full Information Security Policy for full credit';
    }

    // Secret scanning enabled → CC6.2 additional signal
    if (Array.isArray(secretScan)) {
      results['CC6.2'] = results['CC6.2'] || 'IN_PROGRESS';
      detectionDetails['CC6.2'] = (detectionDetails['CC6.2'] || '') + ' | Secret scanning enabled';
    }

    // Offboarding-related workflow → CC6.5 directional signal
    if (workflows?.workflows?.length > 0) {
      const wfNames = workflows.workflows.map(w => (w.name || '').toLowerCase());
      if (wfNames.some(n => n.includes('offboard') || n.includes('deprovision') || n.includes('revoke'))) {
        results['CC6.5'] = results['CC6.5'] || 'IN_PROGRESS';
        detectionDetails['CC6.5'] = 'Offboarding-related workflow detected — upload full procedure for credit';
      }
    }
  }

  // ── CC6.2 — MFA enforced (org level) ─────────────────────────
  if (orgLogin) {
    if (orgData?.two_factor_requirement_enabled) {
      results['CC6.2'] = 'CONNECTED_AUTO';
      detectionDetails['CC6.2'] = `GitHub org ${orgLogin} has two-factor authentication requirement enabled for all members`;
    }
    // ── CC6.6 — Audit log access ─────────────────────────────────
    // The signal is simply that the org audit-log endpoint is reachable and
    // returns an array (length >= 0 was always true and thus meaningless).
    if (Array.isArray(auditLog)) {
      results['CC6.6'] = 'IN_PROGRESS';
      detectionDetails['CC6.6'] = `GitHub org audit log is accessible for ${orgLogin} — directional signal; document privileged access controls to meet this requirement fully`;
    }
  }

  return { results, detectionDetails };
}

// ── Google Drive scanning helpers ────────────────────────────

const FILE_KEYWORD_MAP = {
  'access policy': ['CC6.1'],
  'access control': ['CC6.1'],
  'training': ['CC2.1'],
  'security awareness': ['CC2.1'],
  'incident response': ['CC7.3'],
  'incident': ['CC7.3'],
  'risk assessment': ['CC3.1', 'CC3.2'],
  'risk register': ['CC3.2'],
  'vendor': ['CC9.1', 'CC9.2'],
  'third party': ['CC9.1'],
  'backup': ['CC7.2'],
  'penetration test': ['CC7.5'],
  'pentest': ['CC7.5'],
  'security policy': ['CC1.1'],
  'information security': ['CC1.1'],
  'business continuity': ['CC9.3'],
  'disaster recovery': ['CC9.4'],
  'data retention': ['CC5.3'],
  'insurance': ['CC9.5'],
  'sub-processor': ['CC9.6'],
  'communication': ['CC2.2'],
};

async function scanGoogleDrive(googleToken) {
  const results = {};
  const detectionDetails = {};
  try {
    // List files in AuditReady Evidence folder
    const searchUrl = `https://www.googleapis.com/drive/v3/files?q=name+contains+'AuditReady'&fields=files(name,id)&pageSize=100`;
    const r = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${googleToken}` },
    });
    if (!r.ok) return { results, detectionDetails };
    const data = await r.json();
    const files = data.files || [];

    // Also search all accessible files for keyword matches
    const allFilesUrl = `https://www.googleapis.com/drive/v3/files?fields=files(name,id)&pageSize=200`;
    const allR = await fetch(allFilesUrl, {
      headers: { Authorization: `Bearer ${googleToken}` },
    });
    const allData = allR.ok ? await allR.json() : { files: [] };
    const allFiles = [...files, ...(allData.files || [])];

    for (const file of allFiles) {
      const nameLower = (file.name || '').toLowerCase();
      for (const [keyword, controlIds] of Object.entries(FILE_KEYWORD_MAP)) {
        if (nameLower.includes(keyword)) {
          for (const id of controlIds) {
            // Google Drive keyword match: document found but requires human confirmation
            results[id] = 'IN_PROGRESS';
            detectionDetails[id] = `Google Drive: File "${file.name}" matches keyword "${keyword}" — please verify this document meets the control requirement`;
          }
        }
      }
    }
  } catch (err) {
    console.error('Google Drive scan error:', err.message);
  }
  return { results, detectionDetails };
}

// ── Update controls in Redis with scan results ────────────────

async function applyGitHubScanResults(userId, scanResults, detectionDetails) {
  const now = new Date().toISOString();
  for (const [controlId, status] of Object.entries(scanResults)) {
    const key = `control:${userId}:${controlId}`;
    try {
      await withLock(`control:${userId}:${controlId}`, async () => {
        let control = {};
        const raw = await redis.get(key);
        if (raw) control = typeof raw === 'object' ? raw : JSON.parse(raw);
        // Only upgrade status, never downgrade
        const statusRank = { NOT_STARTED: 0, IN_PROGRESS: 1, EVIDENCE_UPLOADED: 2, CONNECTED_AUTO: 3, NOT_APPLICABLE: -1 };
        const currentRank = statusRank[control.status] ?? 0;
        const newRank = statusRank[status] ?? 0;
        if (newRank > currentRank) {
          control.status = status;
          control.lastUpdated = now;
          control.autoSource = 'github';
          // Add descriptive note about what was detected
          if (detectionDetails && detectionDetails[controlId]) {
            control.autoNote = 'GitHub: ' + detectionDetails[controlId];
          }
          await redis.set(key, JSON.stringify(control));
        }
      });
    } catch (err) {
      await logError('scan_apply_github_error', { msg: err.message, userId, controlId });
    }
  }
}

async function applyDriveScanResults(userId, scanResults, detectionDetails) {
  const now = new Date().toISOString();
  for (const [controlId, status] of Object.entries(scanResults)) {
    const key = `control:${userId}:${controlId}`;
    try {
      await withLock(`control:${userId}:${controlId}`, async () => {
        let control = {};
        const raw = await redis.get(key);
        if (raw) control = typeof raw === 'object' ? raw : JSON.parse(raw);
        const statusRank = { NOT_STARTED: 0, IN_PROGRESS: 1, EVIDENCE_UPLOADED: 2, CONNECTED_AUTO: 3, NOT_APPLICABLE: -1 };
        const currentRank = statusRank[control.status] ?? 0;
        const newRank = statusRank[status] ?? 0;
        if (newRank > currentRank) {
          control.status = status;
          control.lastUpdated = now;
          control.autoSource = 'google_drive';
          // Add note that Google Drive matches require human confirmation
          control.autoNote = 'Google Drive: Document keyword match — please verify this document meets the control requirement';
          await redis.set(key, JSON.stringify(control));
        }
      });
    } catch (err) {
      await logError('scan_apply_drive_error', { msg: err.message, userId, controlId });
    }
  }
}

// ── Main handler ─────────────────────────────────────────────

export default async function handler(req, res) {
  const _origin = req.headers.origin || '';
  const _originOk = /^https:\/\/(auditready\.space|[a-z0-9-]+\.vercel\.app)$/i.test(_origin);
  res.setHeader('Access-Control-Allow-Origin', _originOk ? _origin : 'https://auditready.space');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const userId = await getUserId(req.headers.authorization);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const blocked = await isBlocked(userId);
  if (blocked) return res.status(403).json({ error: `Account ${blocked.status}` });

  // ── GET: Return last scan status + results ────────────────────
  if (req.method === 'GET') {
    try {
      const scanKey = `user:${userId}:lastScan`;
      const raw = await redis.get(scanKey);
      if (!raw) return res.status(200).json({ scanned: false, results: {} });
      const scan = typeof raw === 'object' ? raw : JSON.parse(raw);
      return res.status(200).json(scan);
    } catch (err) {
      console.error('Scan status error:', err.message);
      return res.status(500).json({ error: 'Could not load scan status.' });
    }
  }

  // ── POST: Trigger scan ────────────────────────────────────────
  if (req.method === 'POST') {
    const rl = await checkRateLimit(userId, 'scan', await getUserMode(userId));
    if (!rl.ok) {
      return res.status(429).json({ error: `Scan rate limit. Retry in ${rl.retryAfter}s.`, retryAfter: rl.retryAfter });
    }

    try {
      const ghToken = getGitHubToken(req.headers.authorization);
      const { googleToken } = req.body || {};
      const scanResults = {};
      const allDetectionDetails = {};
      const scanSummary = { github: {}, googleDrive: {} };

      // GitHub scan
      if (ghToken) {
        const { results: ghResults, detectionDetails: ghDetails } = await scanGitHub(ghToken);
        Object.assign(scanResults, ghResults);
        Object.assign(allDetectionDetails, ghDetails);
        scanSummary.github = ghResults;
        await applyGitHubScanResults(userId, ghResults, ghDetails);
      }

      // Google Drive scan
      if (googleToken) {
        const { results: driveResults, detectionDetails: driveDetails } = await scanGoogleDrive(googleToken);
        Object.assign(scanResults, driveResults);
        Object.assign(allDetectionDetails, driveDetails);
        scanSummary.googleDrive = driveResults;
        await applyDriveScanResults(userId, driveResults, driveDetails);
      }

      const controlsAutoFilled = Object.keys(scanResults).length;
      const scannedAt = new Date().toISOString();

      // Store scan metadata
      const scanKey = `user:${userId}:lastScan`;
      await redis.set(scanKey, JSON.stringify({
        scanned: true,
        scannedAt,
        controlsAutoFilled,
        githubScanned: !!ghToken,
        driveScanned: !!googleToken,
        results: scanResults,
        detectionDetails: allDetectionDetails,
      }));

      await trackUser(userId, 'scan');

      // Trigger score recompute (call score.js logic inline to avoid extra HTTP)
      await recomputeScore(userId);

      return res.status(200).json({
        ok: true,
        scannedAt,
        controlsAutoFilled,
        results: scanSummary,
        detectionDetails: allDetectionDetails,
      });

    } catch (err) {
      await logError('scan_error', { msg: err.message, userId });
      return res.status(500).json({ error: 'Scan failed. Please try again.' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// ── Score recompute (also called by evidence.js) ─────────────
// Exported so evidence.js can call it when evidence is added/removed

export async function recomputeScore(userId) {
  try {
    await seedControlsIfNeeded(userId);

    // Get all control IDs (expanded set)
    const ALL_CONTROLS = [
      'CC1.1','CC1.2','CC1.3','CC1.4',
      'CC2.1','CC2.2','CC2.3',
      'CC3.1','CC3.2','CC3.3',
      'CC4.1','CC4.2',
      'CC5.1','CC5.2','CC5.3','CC5.4','CC5.5',
      'CC6.1','CC6.2','CC6.3','CC6.4','CC6.5','CC6.6','CC6.7','CC6.8','CC6.9',
      'CC7.1','CC7.2','CC7.3','CC7.4','CC7.5','CC7.6',
      'CC8.1','CC8.2','CC8.3','CC8.4','CC8.5','CC8.6',
      'CC9.1','CC9.2','CC9.3','CC9.4','CC9.5','CC9.6','CC9.7','CC9.8','CC9.9','CC9.10','CC9.11',
    ];

    let verified = 0;
    let applicable = 0;

    for (const id of ALL_CONTROLS) {
      const raw = await redis.get(`control:${userId}:${id}`);
      if (!raw) { applicable++; continue; }
      const control = typeof raw === 'object' ? raw : JSON.parse(raw);
      if (control.status === 'NOT_APPLICABLE') continue;
      applicable++;
      if (control.status === 'EVIDENCE_UPLOADED' || control.status === 'CONNECTED_AUTO') {
        verified++;
      }
    }

    const score = applicable > 0 ? Math.round((verified / applicable) * 100) : 0;

    // Store score with history
    const scoreKey = `user:${userId}:score`;
    const histKey = `user:${userId}:scoreHistory`;
    const entry = { score, ts: Date.now(), verified, applicable };

    await withLock(`score:${userId}`, async () => {
      await redis.set(scoreKey, JSON.stringify(entry));
      await redis.lpush(histKey, JSON.stringify(entry));
      await redis.ltrim(histKey, 0, 89); // Keep 90 entries
    });

    return score;
  } catch (err) {
    console.error('recomputeScore error:', err.message);
    return 0;
  }
}
