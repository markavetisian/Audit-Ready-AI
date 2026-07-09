// ─────────────────────────────────────────────────────────────
// api/lead.js
// ACTION: NEW
//
//   POST /api/lead   → capture a readiness-quiz lead (PUBLIC, no auth)
//
// Called by the landing-page readiness quiz in public/index.html.
// Body: { email, company, answers:[{question,answer}], source, ts }
//
// Does two things:
//   1. Stores the lead in Redis (admin:leads list) so a lead is NEVER
//      lost even if email delivery fails.
//   2. Emails a lead alert to the founder via Resend, so new quiz
//      submissions land in the inbox with the full Q&A.
//
// Public + unauthenticated, so it's IP rate-limited to blunt spam.
// ─────────────────────────────────────────────────────────────

import { Redis } from '@upstash/redis';
import { logError } from './_telemetry.js';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

// Where the lead alert is sent, and the verified Resend sender.
const NOTIFY_TO   = process.env.LEAD_NOTIFY_EMAIL || 'vlad@auditready.space';
const NOTIFY_FROM = process.env.RESEND_FROM || 'Audit Ready AI <noreply@auditready.space>';

// ── Helpers ───────────────────────────────────────────────────

function clientIp(req) {
  const fwd = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.headers['x-real-ip'] || 'unknown';
}

// Simple per-IP limiter (checkRateLimit only knows scan/report tiers).
// Fails OPEN: a Redis hiccup should never drop a real lead.
async function leadRateLimit(ip) {
  const key = `rl:lead:${ip}`;
  const WINDOW = 3600, MAX = 8;
  try {
    const n = await redis.incr(key);
    if (n === 1) await redis.expire(key, WINDOW);
    return { ok: n <= MAX };
  } catch {
    return { ok: true };
  }
}

const isEmail = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Lead-alert email (HTML) ───────────────────────────────────

function buildAlertHtml({ email, company, answers, source, ts }) {
  const rows = (answers || []).map(a =>
    `<tr>
       <td style="padding:8px 12px;border-bottom:1px solid #eef2f7;color:#64748b;font-size:13px;vertical-align:top;width:45%">${esc(a.question)}</td>
       <td style="padding:8px 12px;border-bottom:1px solid #eef2f7;color:#0f172a;font-size:13px;font-weight:600">${esc(a.answer)}</td>
     </tr>`
  ).join('');

  return `<!DOCTYPE html><html><body style="margin:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
    <div style="max-width:560px;margin:24px auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0">
      <div style="background:linear-gradient(135deg,#1e3a8a,#2563eb);padding:22px 26px;color:#fff">
        <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.8">New readiness-quiz lead</div>
        <div style="font-size:20px;font-weight:700;margin-top:4px">${esc(company)}</div>
      </div>
      <div style="padding:22px 26px">
        <p style="margin:0 0 4px;font-size:13px;color:#64748b">Contact</p>
        <p style="margin:0 0 18px;font-size:15px;font-weight:600;color:#0f172a">
          <a href="mailto:${esc(email)}" style="color:#2563eb;text-decoration:none">${esc(email)}</a>
        </p>
        <p style="margin:0 0 8px;font-size:13px;color:#64748b">Their answers</p>
        <table style="width:100%;border-collapse:collapse;border:1px solid #eef2f7;border-radius:8px;overflow:hidden">${rows}</table>
        <p style="margin:18px 0 0;font-size:11px;color:#94a3b8">
          Source: ${esc(source || 'readiness-quiz')} · ${esc(ts || new Date().toISOString())}
        </p>
      </div>
    </div>
  </body></html>`;
}

// ── Send via Resend ───────────────────────────────────────────

async function sendResend({ to, from, subject, html, replyTo }) {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY not configured');
  }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + process.env.RESEND_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject, html, reply_to: replyTo }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error('Resend error ' + r.status + ' ' + body.slice(0, 200));
  }
  return r.json().catch(() => ({}));
}

// ── Main handler ─────────────────────────────────────────────

export default async function handler(req, res) {
  const _origin = req.headers.origin || '';
  const _originOk = /^https:\/\/(auditready\.space|[a-z0-9-]+\.vercel\.app)$/i.test(_origin);
  res.setHeader('Access-Control-Allow-Origin', _originOk ? _origin : 'https://auditready.space');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const rl = await leadRateLimit(clientIp(req));
  if (!rl.ok) return res.status(429).json({ error: 'Too many submissions, please try again later.' });

  // Body is JSON-parsed by the platform when Content-Type is application/json.
  const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
  const email   = String(body.email   || '').trim();
  const company = String(body.company || '').trim();
  const source  = String(body.source  || 'readiness-quiz').trim();
  const ts      = String(body.ts      || new Date().toISOString());
  const answers = Array.isArray(body.answers)
    ? body.answers.slice(0, 20).map(a => ({
        question: String(a?.question || '').slice(0, 300),
        answer:   String(a?.answer   || '').slice(0, 300),
      }))
    : [];

  if (!isEmail(email)) return res.status(400).json({ error: 'A valid email is required.' });
  if (!company)        return res.status(400).json({ error: 'Company name is required.' });

  const lead = { email, company, answers, source, ts, ip: clientIp(req), at: Date.now() };

  // 1. Persist the lead first — a backstop so it's never lost, even if
  //    email delivery fails downstream.
  try {
    await redis.lpush('admin:leads', JSON.stringify(lead));
    await redis.ltrim('admin:leads', 0, 999);
    await redis.incr('admin:stats:total_leads');
  } catch (e) {
    await logError('lead: redis store failed', { error: String(e), email });
  }

  // 2. Notify the founder. If this fails we've still captured the lead,
  //    so surface a soft success to the visitor but log the failure.
  try {
    await sendResend({
      to: NOTIFY_TO,
      from: NOTIFY_FROM,
      replyTo: email,
      subject: `New SOC 2 lead — ${company}`,
      html: buildAlertHtml(lead),
    });
    return res.status(200).json({ ok: true });
  } catch (e) {
    await logError('lead: email send failed', { error: String(e), email, company });
    // Lead is safely stored; tell the client it went through rather than
    // showing an error for something we've already captured.
    return res.status(200).json({ ok: true, emailed: false });
  }
}
