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

import { trackUser, mintSession, stashAuthCode, takeAuthCode, verifySession, revokeSessions } from './_telemetry.js';
import { Redis } from '@upstash/redis';
import { scryptSync, randomBytes, timingSafeEqual } from 'crypto';

const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });

// ── Email + password helpers (self-contained, no external services) ──
// Disposable / temporary email domains blocked at signup.
const DISPOSABLE_DOMAINS = new Set([
  '10minutemail.com','10minutemail.net','20minutemail.com','10mail.org','minuteinbox.com',
  'mailinator.com','mailinator.net','guerrillamail.com','guerrillamail.net','guerrillamail.org',
  'guerrillamail.info','guerrillamail.biz','guerrillamailblock.com','grr.la','sharklasers.com',
  'yopmail.com','yopmail.net','yopmail.fr','tempmail.com','temp-mail.org','tempmail.net','tempmailo.com',
  'tempr.email','tempinbox.com','tempail.com','throwawaymail.com','getnada.com','nada.email',
  'trashmail.com','trashmail.net','maildrop.cc','dispostable.com','fakeinbox.com','fake-mail.net',
  'mailnesia.com','mytemp.email','emailondeck.com','mohmal.com','spamgourmet.com','mintemail.com',
  'discard.email','discardmail.com','mailcatch.com','inboxkitten.com','tempmailaddress.com',
  'burnermail.io','moakt.com','wegwerfmail.de','einrot.com','spam4.me','spambox.us','anonbox.net',
  'maileater.com','33mail.com','emltmp.com','mail-temp.com','luxusmail.org','tmail.ws','mailto.plus',
]);

function isValidEmailFormat(email) {
  if (typeof email !== 'string' || email.length > 254) return false;
  if (email.includes('..')) return false;
  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email);
}
function isDisposableEmail(email) {
  return DISPOSABLE_DOMAINS.has((email.split('@')[1] || '').toLowerCase());
}
function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
function verifyPassword(password, stored) {
  try {
    const [salt, hash] = String(stored).split(':');
    if (!salt || !hash) return false;
    const test = scryptSync(password, salt, 64);
    const a = Buffer.from(hash, 'hex');
    return a.length === test.length && timingSafeEqual(a, test);
  } catch { return false; }
}
function clientIp(req) {
  const fwd = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.headers['x-real-ip'] || 'unknown';
}
async function authRateLimit(ip) {
  try {
    const n = await redis.incr(`rl:auth:${ip}`);
    if (n === 1) await redis.expire(`rl:auth:${ip}`, 3600);
    return n <= 12; // 12 signup/login attempts per hour per IP
  } catch { return true; }
}

// Email verification: 6-digit code delivered via Resend (already configured
// for lead emails). Free tier easily covers signup volume.
function genCode() { return String(Math.floor(100000 + Math.random() * 900000)); }
async function sendVerifyEmail(to, code) {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY not configured');
  const from = process.env.RESEND_FROM || 'Audit Ready AI <vlad@auditready.space>';
  const html = `<!DOCTYPE html><html><body style="margin:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
    <div style="max-width:460px;margin:24px auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0">
      <div style="background:linear-gradient(135deg,#1e3a8a,#2563eb);padding:20px 26px;color:#fff;font-size:15px;font-weight:600">Audit Ready AI</div>
      <div style="padding:26px">
        <p style="margin:0 0 6px;font-size:15px;color:#0f172a;font-weight:600">Confirm your email</p>
        <p style="margin:0 0 18px;font-size:13px;color:#64748b;line-height:1.6">Enter this code to finish creating your account. It expires in 15 minutes.</p>
        <div style="font-size:30px;font-weight:800;letter-spacing:8px;color:#1d4ed8;background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:14px;text-align:center">${code}</div>
        <p style="margin:18px 0 0;font-size:11px;color:#94a3b8">If you didn't request this, you can safely ignore this email.</p>
      </div>
    </div>
  </body></html>`;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject: 'Your Audit Ready AI verification code', html }),
  });
  if (!r.ok) { const b = await r.text().catch(() => ''); throw new Error('Resend error ' + r.status + ' ' + b.slice(0, 160)); }
}

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

  // ─────────────────────────────────────────────────────────────
  // LOGOUT — revoke the caller's session tokens server-side.
  // POST /api/auth?logout=1  (Authorization: Bearer <session token>)
  // Stamps a revocation cutoff so the token (and any other session for this
  // user) stops validating immediately, even before its 30-day expiry.
  // GitHub-token sessions aren't server-revocable here (that's GitHub's token),
  // so the client just clears them locally.
  // ─────────────────────────────────────────────────────────────
  if (req.method === 'POST' && (req.query.logout || req.url?.includes('logout'))) {
    const auth = req.headers.authorization || '';
    const token = auth.replace(/^Bearer\s+/i, '');
    if (token.startsWith('s1.')) {
      const uid = await verifySession(token);
      if (uid) await revokeSessions(uid);
    }
    return res.status(200).json({ ok: true });
  }

  // ─────────────────────────────────────────────────────────────
  // EMAIL + PASSWORD — self-contained signup / login (no OAuth).
  //   POST /api/auth?action=signup { email, password }
  //   POST /api/auth?action=login  { email, password }
  // Returns { sessionToken, email, name } on success.
  // ─────────────────────────────────────────────────────────────
  if (req.method === 'POST' && (req.query.action === 'signup' || req.query.action === 'login')) {
    const isSignup = req.query.action === 'signup';
    if (!(await authRateLimit(clientIp(req)))) {
      return res.status(429).json({ error: 'Too many attempts. Please try again in a little while.' });
    }
    const body = typeof req.body === 'string'
      ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })()
      : (req.body || {});
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');

    if (!isValidEmailFormat(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

    const key = `auth:email:${email}`;
    try {
      if (isSignup) {
        if (isDisposableEmail(email)) {
          return res.status(400).json({ error: 'Please use a permanent email address. Disposable addresses are not allowed.' });
        }
        if (await redis.get(key)) {
          return res.status(409).json({ error: 'An account with this email already exists. Try signing in.' });
        }
        // Don't create the account yet. Email a 6-digit code and stash a
        // pending record; the account is created only after verification.
        const name = email.split('@')[0];
        const code = genCode();
        await redis.set(`auth:pending:${email}`, JSON.stringify({
          email, name, passHash: hashPassword(password), code, attempts: 0, createdAt: Date.now(),
        }), { ex: 900 });
        try {
          await sendVerifyEmail(email, code);
        } catch (e) {
          return res.status(500).json({ error: 'Could not send the verification email. Please try again in a moment.' });
        }
        return res.status(200).json({ ok: true, verify: true, email });
      }
      // login
      const raw = await redis.get(key);
      const record = raw ? (typeof raw === 'object' ? raw : JSON.parse(raw)) : null;
      // Generic error either way, so we never reveal which emails are registered.
      if (!record || !verifyPassword(password, record.passHash)) {
        return res.status(401).json({ error: 'Invalid email or password.' });
      }
      const uid = 'email:' + email;
      try { await trackUser(uid, 'login', email, 'email'); } catch {}
      return res.status(200).json({ ok: true, email, name: record.name || email.split('@')[0], sessionToken: mintSession(uid) });
    } catch (err) {
      return res.status(500).json({ error: 'Server error. Please try again.' });
    }
  }

  // ── EMAIL VERIFY — confirm the 6-digit code, then create the account ──
  if (req.method === 'POST' && req.query.action === 'verify') {
    if (!(await authRateLimit(clientIp(req)))) {
      return res.status(429).json({ error: 'Too many attempts. Please try again in a little while.' });
    }
    const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
    const email = String(body.email || '').trim().toLowerCase();
    const code = String(body.code || '').trim();
    if (!isValidEmailFormat(email) || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: 'Enter the 6-digit code we emailed you.' });
    }
    try {
      const pkey = `auth:pending:${email}`;
      const raw = await redis.get(pkey);
      const pending = raw ? (typeof raw === 'object' ? raw : JSON.parse(raw)) : null;
      if (!pending) return res.status(400).json({ error: 'That code expired. Please sign up again to get a new one.' });
      if ((pending.attempts || 0) >= 5) { await redis.del(pkey); return res.status(429).json({ error: 'Too many incorrect attempts. Please sign up again.' }); }
      if (String(pending.code) !== code) {
        pending.attempts = (pending.attempts || 0) + 1;
        await redis.set(pkey, JSON.stringify(pending), { ex: 900 });
        return res.status(400).json({ error: 'Incorrect code. Please try again.' });
      }
      // Verified — create the real account and sign the user in.
      await redis.set(`auth:email:${email}`, JSON.stringify({ email, name: pending.name, passHash: pending.passHash, createdAt: Date.now(), verified: true }));
      await redis.del(pkey);
      const uid = 'email:' + email;
      try { await trackUser(uid, 'login', email, 'email'); } catch {}
      return res.status(200).json({ ok: true, email, name: pending.name, sessionToken: mintSession(uid) });
    } catch (err) {
      return res.status(500).json({ error: 'Server error. Please try again.' });
    }
  }

  // ── RESEND — issue a fresh verification code for a pending signup ──
  if (req.method === 'POST' && req.query.action === 'resend') {
    if (!(await authRateLimit(clientIp(req)))) {
      return res.status(429).json({ error: 'Too many attempts. Please try again in a little while.' });
    }
    const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
    const email = String(body.email || '').trim().toLowerCase();
    if (!isValidEmailFormat(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
    try {
      const pkey = `auth:pending:${email}`;
      const raw = await redis.get(pkey);
      const pending = raw ? (typeof raw === 'object' ? raw : JSON.parse(raw)) : null;
      if (!pending) return res.status(400).json({ error: 'Please sign up again to get a new code.' });
      const code = genCode();
      pending.code = code; pending.attempts = 0;
      await redis.set(pkey, JSON.stringify(pending), { ex: 900 });
      try { await sendVerifyEmail(email, code); } catch (e) { return res.status(500).json({ error: 'Could not resend the email. Please try again.' }); }
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: 'Server error. Please try again.' });
    }
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
