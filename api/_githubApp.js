// ─────────────────────────────────────────────────────────────
// api/_githubApp.js
// GitHub App authentication helpers.
//
// ADDITIVE: this module is used ONLY by the new GitHub App paths
// (install flow, webhook, App-based scanning). It does NOT touch the
// existing OAuth App sign-in (GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET)
// that current users authenticate with. No external dependencies —
// everything here is built on Node's crypto.
//
// Env vars it reads:
//   GITHUB_APP_ID              — numeric App ID (e.g. 4326334)
//   GITHUB_APP_PRIVATE_KEY     — full contents of the .pem private key
//   GITHUB_APP_WEBHOOK_SECRET  — webhook signing secret (once enabled)
// ─────────────────────────────────────────────────────────────

import crypto from 'crypto';

const APP_ID = process.env.GITHUB_APP_ID;

// Vercel stores the PEM with real newlines, but tolerate \n-escaped values too.
function privateKey() {
  const raw = process.env.GITHUB_APP_PRIVATE_KEY || '';
  return raw.includes('\\n') && !raw.includes('\n') ? raw.replace(/\\n/g, '\n') : raw;
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

// App-level JWT (RS256), valid ~9 min. Used to call app-level endpoints
// such as minting installation tokens.
export function generateAppJWT() {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = { iat: now - 30, exp: now + 9 * 60, iss: APP_ID };
  const unsigned = b64url(JSON.stringify(header)) + '.' + b64url(JSON.stringify(payload));
  const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(privateKey());
  return unsigned + '.' + b64url(sig);
}

// Exchange the app JWT for a short-lived (~1h) installation access token,
// which is what actually reads a customer's repos during a scan.
export async function getInstallationToken(installationId) {
  const jwt = generateAppJWT();
  const r = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'AuditReady-AI',
    },
  });
  if (!r.ok) throw new Error('installation token request failed: ' + r.status);
  const d = await r.json();
  return d.token;
}

// Verify an incoming webhook body against the X-Hub-Signature-256 header.
// Constant-time comparison; returns false on any missing/mismatched input.
export function verifyWebhookSignature(rawBody, signature) {
  const secret = process.env.GITHUB_APP_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export const GITHUB_APP_ID = APP_ID;
