// ─────────────────────────────────────────────────────────────
// api/integrations.js
// ACTION: NEW (slot 10)
//
//   GET    /api/integrations  → list connected integrations + status
//   POST   /api/integrations  → connect an integration (save token)
//   DELETE /api/integrations  → disconnect an integration
//
// GitHub: connected via existing OAuth token (already in auth header)
// Google Drive: connected via google OAuth token stored in Redis
// AWS: Coming Soon (scaffolded only, no scanning logic)
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

function getGitHubToken(authHeader) {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  return token.startsWith('google:') ? null : token;
}

// ── Verify GitHub token and get user info ─────────────────────

async function verifyGitHub(token) {
  try {
    const r = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'AuditReady-AI' },
    });
    if (!r.ok) return null;
    return r.json();
  } catch { return null; }
}

// ── Verify Google token ───────────────────────────────────────

async function verifyGoogle(token) {
  try {
    const r = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return null;
    return r.json();
  } catch { return null; }
}

// ── Main handler ─────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const userId = await getUserId(req.headers.authorization);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const intKey = `user:${userId}:integrations`;

  // ── GET: List all integrations + connection status ────────────
  if (req.method === 'GET') {
    try {
      const raw = await redis.get(intKey);
      const stored = raw ? (typeof raw === 'object' ? raw : JSON.parse(raw)) : {};

      // Check GitHub — live verification if token in header
      const ghToken = getGitHubToken(req.headers.authorization);
      let githubStatus = stored.github || { connected: false };
      if (ghToken) {
        const ghUser = await verifyGitHub(ghToken);
        if (ghUser) {
          githubStatus = {
            connected: true,
            login: ghUser.login,
            avatarUrl: ghUser.avatar_url,
            scannedAt: stored.github?.scannedAt || null,
            controlsAutoFilled: stored.github?.controlsAutoFilled || 0,
          };
        }
      }

      const integrations = {
        github: {
          id: 'github',
          name: 'GitHub',
          description: 'Scans branch protection, PR reviews, MFA enforcement, deployment pipelines',
          icon: 'github',
          status: githubStatus.connected ? 'CONNECTED' : 'DISCONNECTED',
          ...githubStatus,
          comingSoon: false,
        },
        googleDrive: {
          id: 'googleDrive',
          name: 'Google Drive',
          description: 'Links your evidence folder and auto-maps policy documents to controls',
          icon: 'google_drive',
          status: stored.googleDrive?.connected ? 'CONNECTED' : 'DISCONNECTED',
          connected: !!stored.googleDrive?.connected,
          scannedAt: stored.googleDrive?.scannedAt || null,
          controlsAutoFilled: stored.googleDrive?.controlsAutoFilled || 0,
          comingSoon: false,
        },
        aws: {
          id: 'aws',
          name: 'AWS',
          description: 'Checks CloudTrail, S3 encryption, IAM MFA, RDS backups via read-only IAM role',
          icon: 'aws',
          status: 'COMING_SOON',
          connected: false,
          comingSoon: true,
        },
      };

      return res.status(200).json({ integrations });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST: Connect an integration ──────────────────────────────
  if (req.method === 'POST') {
    const { provider, googleToken } = req.body || {};

    if (!provider) return res.status(400).json({ error: 'Missing provider' });
    if (provider === 'aws') return res.status(400).json({ error: 'AWS integration is Coming Soon' });

    try {
      const raw = await redis.get(intKey);
      const stored = raw ? (typeof raw === 'object' ? raw : JSON.parse(raw)) : {};

      if (provider === 'github') {
        const ghToken = getGitHubToken(req.headers.authorization);
        if (!ghToken) return res.status(400).json({ error: 'GitHub token required — please sign in with GitHub' });
        const ghUser = await verifyGitHub(ghToken);
        if (!ghUser) return res.status(401).json({ error: 'Invalid GitHub token' });
        stored.github = {
          connected: true,
          login: ghUser.login,
          avatarUrl: ghUser.avatar_url,
          connectedAt: new Date().toISOString(),
          scannedAt: null,
          controlsAutoFilled: 0,
        };
        await redis.set(intKey, JSON.stringify(stored));
        return res.status(200).json({ ok: true, provider: 'github', connected: true, login: ghUser.login });
      }

      if (provider === 'googleDrive') {
        if (!googleToken) return res.status(400).json({ error: 'googleToken required' });
        const gUser = await verifyGoogle(googleToken);
        if (!gUser) return res.status(401).json({ error: 'Invalid Google token' });
        // Store encrypted reference (store email only, token not persisted for security)
        stored.googleDrive = {
          connected: true,
          email: gUser.email,
          connectedAt: new Date().toISOString(),
          scannedAt: null,
          controlsAutoFilled: 0,
          // Note: googleToken is NOT stored in Redis — user must pass it per-request
        };
        await redis.set(intKey, JSON.stringify(stored));
        return res.status(200).json({ ok: true, provider: 'googleDrive', connected: true, email: gUser.email });
      }

      return res.status(400).json({ error: `Unknown provider: ${provider}` });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── DELETE: Disconnect an integration ─────────────────────────
  if (req.method === 'DELETE') {
    const { provider } = req.query;
    if (!provider) return res.status(400).json({ error: 'Missing provider' });

    try {
      const raw = await redis.get(intKey);
      const stored = raw ? (typeof raw === 'object' ? raw : JSON.parse(raw)) : {};
      delete stored[provider];
      await redis.set(intKey, JSON.stringify(stored));

      // If disconnecting GitHub, clear auto-detected control statuses from GitHub
      if (provider === 'github') {
        const ALL_CONTROLS = [
          'CC1.1','CC1.2','CC2.1','CC2.2','CC3.1','CC3.2','CC4.1','CC4.2',
          'CC5.1','CC5.2','CC5.3','CC6.1','CC6.2','CC6.3','CC6.4','CC6.5',
          'CC6.6','CC6.7','CC7.1','CC7.2','CC7.3','CC7.4','CC7.5',
          'CC8.1','CC8.2','CC8.3','CC8.4','CC9.1','CC9.2','CC9.3','CC9.4','CC9.5','CC9.6',
        ];
        for (const id of ALL_CONTROLS) {
          const cRaw = await redis.get(`control:${userId}:${id}`);
          if (cRaw) {
            const control = typeof cRaw === 'object' ? cRaw : JSON.parse(cRaw);
            if (control.autoSource === 'github' && control.status === 'CONNECTED_AUTO') {
              control.status = 'NOT_STARTED';
              control.autoSource = null;
              control.lastUpdated = new Date().toISOString();
              await redis.set(`control:${userId}:${id}`, JSON.stringify(control));
            }
          }
        }
      }

      return res.status(200).json({ ok: true, provider, disconnected: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
