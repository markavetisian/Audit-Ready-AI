// ─────────────────────────────────────────────────────────────
// api/auth.js
// ACTION: MERGED from github-auth.js + google-auth.js + slack-auth.js
//
//   GET /api/auth?provider=github    → redirect to GitHub consent
//   GET /api/github-callback         → GitHub OAuth callback (via vercel.json rewrite)
//   GET /api/auth?provider=google    → redirect to Google consent
//   GET /api/google-callback         → Google OAuth callback (via vercel.json rewrite)
//   GET /api/auth?provider=slack     → redirect to Slack consent
//   GET /api/slack-callback          → Slack OAuth callback (via vercel.json rewrite)
// ─────────────────────────────────────────────────────────────

import { trackUser, mintSession, stashAuthCode, takeAuthCode } from './_telemetry.js';

export default async function handler(req, res) {
  const { provider, code, state } = req.query;
  const appUrl = process.env.APP_URL || `https://${req.headers.host}`;

  // ─────────────────────────────────────────────────────────────
  // EXCHANGE — redeem a one-time auth code for the login payload.
  // POST /api/auth?exchange=1  { code }  → { ...payload } (single use)
  // This is how the frontend retrieves tokens after OAuth, so credentials
  // never travel in the redirect URL.
  // ─────────────────────────────────────────────────────────────
  if (req.method === 'POST' && (req.query.exchange || req.url?.includes('exchange'))) {
    const supplied = req.body?.code || req.query.code;
    const payload = await takeAuthCode(supplied);
    if (!payload) return res.status(400).json({ error: 'Invalid or expired code' });
    return res.status(200).json(payload);
  }

  // ── Detect which provider this callback belongs to ──────────
  const isSlackCallback = req.url?.includes('slack-callback') || state === 'slack';
  const isGoogleCallback = !isSlackCallback && (req.url?.includes('google-callback') || state === 'google');
  const isGithubCallback = !isSlackCallback && !isGoogleCallback && (req.url?.includes('github-callback') || code);

  // ─────────────────────────────────────────────────────────────
  // GITHUB — Callback (code present + github-callback path or provider=github)
  // ─────────────────────────────────────────────────────────────
  if (code && isGithubCallback) {
    try {
      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: process.env.GITHUB_CLIENT_ID,
          client_secret: process.env.GITHUB_CLIENT_SECRET,
          code,
        }),
      });
      const tokenData = await tokenRes.json();
      if (tokenData.access_token) {
        // Track the login server-side with verified identity (telemetry endpoint
        // is a shared module, not an HTTP route, so we record it here directly).
        try {
          const ghUserRes = await fetch('https://api.github.com/user', {
            headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'AuditReady-AI' },
          });
          if (ghUserRes.ok) {
            const ghUser = await ghUserRes.json();
            await trackUser('github:' + ghUser.login, 'login', ghUser.email || null, 'github');
          }
        } catch {}
        // Hand the token back via a one-time code, never in the URL.
        const authCode = await stashAuthCode({
          provider: 'github',
          githubToken: tokenData.access_token,
          data: (state && state.length > 0 && state !== 'github') ? state : null,
        });
        return res.redirect(`/?auth=${authCode}`);
      } else {
        return res.status(400).send('GitHub auth failed. Please try again.');
      }
    } catch {
      return res.status(500).send('Auth server error.');
    }
  }

  // ─────────────────────────────────────────────────────────────
  // GOOGLE — Callback (code present + google-callback path)
  // ─────────────────────────────────────────────────────────────
  if (code && isGoogleCallback) {
    try {
      const redirectUri = `${appUrl}/api/google-callback`;
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      });
      const tokenData = await tokenRes.json();
      if (!tokenData.access_token) {
        console.error('Google token error:', tokenData);
        return res.status(400).send('Google auth failed. Please try again.');
      }
      const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const user = await userRes.json();
      // ── Link mode: attach Drive to an existing (e.g. GitHub) account ──
      if (state === 'google_link') {
        const linkCode = await stashAuthCode({
          provider: 'google_link',
          email: user.email,
          googleToken: tokenData.access_token,
        });
        return res.redirect(`/?auth=${linkCode}`);
      }
      if (user.email) {
        try { await trackUser('google:' + user.email, 'login', user.email, 'google'); } catch {}
      }
      const googleCode = await stashAuthCode({
        provider: 'google',
        name: user.name,
        email: user.email,
        avatar: user.picture,
        type: 'google',
        googleToken: tokenData.access_token,
        sessionToken: user.email ? mintSession('google:' + user.email) : null,
      });
      return res.redirect(`/?auth=${googleCode}`);
    } catch (err) {
      console.error('Google callback error:', err);
      return res.status(500).send('Auth server error: ' + err.message);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // GITHUB — Initiate OAuth (provider=github or /api/github-oauth rewrite)
  // AuditReady scopes: repo + read:org + audit_log:read for compliance scanning
  // ─────────────────────────────────────────────────────────────
  if (provider === 'github' || req.url?.includes('github-oauth') || req.url?.includes('github-auth')) {
    const clientId = process.env.GITHUB_CLIENT_ID;
    if (!clientId) return res.status(500).send('GITHUB_CLIENT_ID not configured.');
    const redirectUri = encodeURIComponent(`${appUrl}/api/github-callback`);
    // AuditReady: added read:org and audit_log:read for compliance scanning
    const scope = encodeURIComponent('repo read:org read:user audit_log:read');
    const stateParam = req.query.data ? encodeURIComponent(req.query.data) : 'github';
    const authUrl =
      `https://github.com/login/oauth/authorize` +
      `?client_id=${clientId}` +
      `&redirect_uri=${redirectUri}` +
      `&scope=${scope}` +
      `&state=${stateParam}`;
    return res.redirect(authUrl);
  }

  // ─────────────────────────────────────────────────────────────
  // GOOGLE — Initiate OAuth (provider=google or /api/google-oauth rewrite)
  // AuditReady: added drive.readonly for evidence folder scanning
  // ─────────────────────────────────────────────────────────────
  if (provider === 'google' || req.url?.includes('google-oauth') || req.url?.includes('google-auth')) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) return res.status(500).send('GOOGLE_CLIENT_ID not configured.');
    const redirectUri = encodeURIComponent(`${appUrl}/api/google-callback`);
    // AuditReady: drive.readonly added for evidence folder
    const scope = encodeURIComponent('openid email profile https://www.googleapis.com/auth/drive.readonly');
    // link=1 → attach Drive to an existing account instead of logging in fresh
    const stateParam = req.query.link === '1' ? 'google_link' : 'google';
    const authUrl =
      `https://accounts.google.com/o/oauth2/v2/auth` +
      `?client_id=${clientId}` +
      `&redirect_uri=${redirectUri}` +
      `&response_type=code` +
      `&scope=${scope}` +
      `&access_type=offline` +
      `&prompt=select_account` +
      `&state=${stateParam}`;
    return res.redirect(authUrl);
  }

  // ─────────────────────────────────────────────────────────────
  // SLACK — Callback (uses OpenID Connect)
  // ─────────────────────────────────────────────────────────────
  if (code && isSlackCallback) {
    try {
      const redirectUri = `${appUrl}/api/slack-callback`;
      const tokenRes = await fetch('https://slack.com/api/openid.connect.token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: process.env.SLACK_CLIENT_ID,
          client_secret: process.env.SLACK_CLIENT_SECRET,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      });
      const tokenData = await tokenRes.json();
      if (!tokenData.ok || !tokenData.access_token) {
        console.error('Slack token error:', tokenData);
        return res.status(400).send('Slack auth failed. Please try again.');
      }
      const userRes = await fetch('https://slack.com/api/openid.connect.userInfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const user = await userRes.json();
      if (user.email) {
        try { await trackUser('slack:' + user.email, 'login', user.email, 'slack'); } catch {}
      }
      const slackCode = await stashAuthCode({
        provider: 'slack',
        name: user.name || user['https://slack.com/user_id'] || 'Slack User',
        email: user.email || '',
        avatar: user.picture || null,
        type: 'slack',
        slackTeam: user['https://slack.com/team_name'] || '',
        sessionToken: user.email ? mintSession('slack:' + user.email) : null,
      });
      return res.redirect(`/?auth=${slackCode}`);
    } catch (err) {
      console.error('Slack callback error:', err);
      return res.status(500).send('Auth server error: ' + err.message);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // SLACK — Initiate OAuth
  // ─────────────────────────────────────────────────────────────
  if (provider === 'slack' || req.url?.includes('slack-oauth')) {
    const clientId = process.env.SLACK_CLIENT_ID;
    if (!clientId) return res.status(500).send('SLACK_CLIENT_ID not configured.');
    const redirectUri = encodeURIComponent(`${appUrl}/api/slack-callback`);
    const scope = encodeURIComponent('openid email profile');
    const authUrl =
      `https://slack.com/openid/connect/authorize` +
      `?client_id=${clientId}` +
      `&redirect_uri=${redirectUri}` +
      `&response_type=code` +
      `&scope=${scope}` +
      `&state=slack`;
    return res.redirect(authUrl);
  }

  return res.status(400).json({ error: 'Missing provider. Use ?provider=github, ?provider=google, or ?provider=slack' });
}
