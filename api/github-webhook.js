// ─────────────────────────────────────────────────────────────
// api/github-webhook.js
// Receives GitHub App webhook events (install / uninstall / repos
// added-removed, and later marketplace_purchase).
//
// ADDITIVE: brand-new endpoint. Nothing else in the app posts here and
// it touches no existing handler. It only records which account has the
// App installed (so a later scan can mint an installation token), and
// always acks with 200 so GitHub never enters a retry storm.
//
// Requires GITHUB_APP_WEBHOOK_SECRET to be set and the webhook re-enabled
// on the GitHub App (Active + URL https://auditready.space/api/github-webhook).
// ─────────────────────────────────────────────────────────────

import { Redis } from '@upstash/redis';
import { verifyWebhookSignature } from './_githubApp.js';

// Raw body is required for signature verification, so disable body parsing.
export const config = { api: { bodyParser: false } };

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const raw = await readRawBody(req);
  const signature = req.headers['x-hub-signature-256'];
  if (!verifyWebhookSignature(raw, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const event = req.headers['x-github-event'];
  let payload;
  try { payload = JSON.parse(raw); } catch { return res.status(400).json({ error: 'Bad JSON' }); }

  try {
    if (event === 'installation' || event === 'installation_repositories') {
      const inst = payload.installation;
      const account = inst?.account?.login;
      const installationId = inst?.id;

      if (payload.action === 'deleted' && account) {
        await redis.del(`ghapp:install:${account.toLowerCase()}`);
      } else if (account && installationId) {
        await redis.set(`ghapp:install:${account.toLowerCase()}`, JSON.stringify({
          installationId,
          account,
          accountType: inst.account.type,
          repositorySelection: inst.repository_selection || null,
          updatedAt: Date.now(),
        }));
      }
    }

    // marketplace_purchase events will be handled here once the listing is live.

    return res.status(200).json({ ok: true });
  } catch {
    // Ack regardless — a failed lookup must not make GitHub retry forever.
    return res.status(200).json({ ok: true });
  }
}
