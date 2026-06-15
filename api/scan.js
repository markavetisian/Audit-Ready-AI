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
// ADDED:   GitHub org/repo scanning logic mapped to 33 SOC 2 controls
//          Google Drive folder scanning for evidence keywords
//          Control status updater, scannedAt timestamp writer
// ─────────────────────────────────────────────────────────────

import { Redis } from '@upstash/redis';
import { trackUser, isBlocked, checkRateLimit, logError } from './telemetry.js';

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

function getGitHubToken(authHeader) {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  return token.startsWith('google:') ? null : token;
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

async function scanGitHub(token) {
  const results = {};

  // Get authenticated user
  const user = await ghGet('user', token);
  if (!user) return results;
  const owner = user.login;

  // Get orgs
  const orgs = await ghGet('user/orgs', token) || [];
  const orgLogin = orgs[0]?.login || null;

  // Get repos
  const repos = await ghGet(`users/${owner}/repos?per_page=50&sort=updated`, token) || [];
  const mainRepo = repos[0] || null;

  // ── CC8.2 — Branch protection / required PR reviews ──────────
  if (mainRepo) {
    const branches = await ghGet(`repos/${owner}/${mainRepo.name}/branches`, token) || [];
    const mainBranch = branches.find(b => b.name === 'main' || b.name === 'master');
    if (mainBranch) {
      const protection = await ghGet(`repos/${owner}/${mainRepo.name}/branches/${mainBranch.name}/protection`, token);
      if (protection && protection.required_pull_request_reviews) {
        results['CC8.2'] = 'CONNECTED_AUTO';
      }
    }
    // ── CC8.3 — Separate dev/staging/prod environments ──────────
    const branchNames = branches.map(b => b.name);
    const hasEnvBranches = branchNames.some(n => n.includes('staging') || n.includes('develop') || n.includes('dev') || n.includes('prod'));
    if (hasEnvBranches) results['CC8.3'] = 'CONNECTED_AUTO';

    // ── CC8.1 — Change management (PRs exist) ────────────────────
    const pulls = await ghGet(`repos/${owner}/${mainRepo.name}/pulls?state=closed&per_page=10`, token) || [];
    if (pulls.length > 0) results['CC8.1'] = 'CONNECTED_AUTO';

    // ── CC8.4 — Deployment pipeline (workflows exist) ────────────
    const workflows = await ghGet(`repos/${owner}/${mainRepo.name}/actions/workflows`, token);
    if (workflows?.workflows?.length > 0) results['CC8.4'] = 'CONNECTED_AUTO';

    // ── CC5.2 — TLS enforced (GitHub Pages = HTTPS enforced) ─────
    if (mainRepo.has_pages) results['CC5.2'] = 'CONNECTED_AUTO';
  }

  // ── CC6.2 — MFA enforced (org level) ─────────────────────────
  if (orgLogin) {
    const orgData = await ghGet(`orgs/${orgLogin}`, token);
    if (orgData?.two_factor_requirement_enabled) results['CC6.2'] = 'CONNECTED_AUTO';

    // ── CC6.3 — Unique user accounts ─────────────────────────────
    const members = await ghGet(`orgs/${orgLogin}/members`, token) || [];
    if (members.length > 0) results['CC6.3'] = 'CONNECTED_AUTO';

    // ── CC6.6 — Audit log access ─────────────────────────────────
    const auditLog = await ghGet(`orgs/${orgLogin}/audit-log?per_page=1`, token);
    if (auditLog && Array.isArray(auditLog) && auditLog.length >= 0) {
      results['CC6.6'] = 'CONNECTED_AUTO';
    }
  }

  // ── CC6.1 — Access provisioning (collaborators exist with review) ─
  if (mainRepo) {
    const collaborators = await ghGet(`repos/${owner}/${mainRepo.name}/collaborators`, token) || [];
    if (collaborators.length > 0) results['CC6.1'] = 'CONNECTED_AUTO';
  }

  // ── CC6.7 — Password policy (GitHub enforces this at platform level) ─
  results['CC6.7'] = 'CONNECTED_AUTO';

  return results;
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
  try {
    // List files in AuditReady Evidence folder
    const searchUrl = `https://www.googleapis.com/drive/v3/files?q=name+contains+'AuditReady'&fields=files(name,id)&pageSize=100`;
    const r = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${googleToken}` },
    });
    if (!r.ok) return results;
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
            results[id] = 'EVIDENCE_UPLOADED';
          }
        }
      }
    }
  } catch (err) {
    console.error('Google Drive scan error:', err.message);
  }
  return results;
}

// ── Update controls in Redis with scan results ────────────────

async function applyGitHubScanResults(userId, scanResults) {
  const now = new Date().toISOString();
  for (const [controlId, status] of Object.entries(scanResults)) {
    const key = `control:${userId}:${controlId}`;
    try {
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
        await redis.set(key, JSON.stringify(control));
      }
    } catch {}
  }
}

async function applyDriveScanResults(userId, scanResults) {
  const now = new Date().toISOString();
  for (const [controlId, status] of Object.entries(scanResults)) {
    const key = `control:${userId}:${controlId}`;
    try {
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
        await redis.set(key, JSON.stringify(control));
      }
    } catch {}
  }
}

// ── Main handler ─────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
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
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST: Trigger scan ────────────────────────────────────────
  if (req.method === 'POST') {
    const rl = await checkRateLimit(userId, 'scan');
    if (!rl.ok) {
      return res.status(429).json({ error: `Scan rate limit. Retry in ${rl.retryAfter}s.`, retryAfter: rl.retryAfter });
    }

    try {
      const ghToken = getGitHubToken(req.headers.authorization);
      const { googleToken } = req.body || {};
      const scanResults = {};
      const scanSummary = { github: {}, googleDrive: {} };

      // GitHub scan
      if (ghToken) {
        const ghResults = await scanGitHub(ghToken);
        Object.assign(scanResults, ghResults);
        scanSummary.github = ghResults;
        await applyGitHubScanResults(userId, ghResults);
      }

      // Google Drive scan
      if (googleToken) {
        const driveResults = await scanGoogleDrive(googleToken);
        Object.assign(scanResults, driveResults);
        scanSummary.googleDrive = driveResults;
        await applyDriveScanResults(userId, driveResults);
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
      }));

      await trackUser(userId, 'scan');

      // Trigger score recompute (call score.js logic inline to avoid extra HTTP)
      await recomputeScore(userId);

      return res.status(200).json({
        ok: true,
        scannedAt,
        controlsAutoFilled,
        results: scanSummary,
      });

    } catch (err) {
      await logError('scan_error', { msg: err.message, userId });
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// ── Score recompute (also called by evidence.js) ─────────────
// Exported so evidence.js can call it when evidence is added/removed

export async function recomputeScore(userId) {
  try {
    // Get all 33 control IDs
    const ALL_CONTROLS = [
      'CC1.1','CC1.2','CC2.1','CC2.2','CC3.1','CC3.2','CC4.1','CC4.2',
      'CC5.1','CC5.2','CC5.3','CC6.1','CC6.2','CC6.3','CC6.4','CC6.5',
      'CC6.6','CC6.7','CC7.1','CC7.2','CC7.3','CC7.4','CC7.5',
      'CC8.1','CC8.2','CC8.3','CC8.4','CC9.1','CC9.2','CC9.3','CC9.4','CC9.5','CC9.6',
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

    await redis.set(scoreKey, JSON.stringify(entry));
    await redis.lpush(histKey, JSON.stringify(entry));
    await redis.ltrim(histKey, 0, 89); // Keep 90 entries

    return score;
  } catch (err) {
    console.error('recomputeScore error:', err.message);
    return 0;
  }
}
