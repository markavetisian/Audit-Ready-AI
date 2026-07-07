// ─────────────────────────────────────────────────────────────
// api/lead.js — readiness-quiz lead capture
//
//   POST /api/lead → store the quiz answers and email them to the
//                    team inbox (vlad@auditready.space by default).
//
// Every lead is written to Redis first, so a lead is never lost even
// if email delivery is not configured yet. Email is sent via Resend
// when RESEND_API_KEY is present.
// ─────────────────────────────────────────────────────────────

import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

// Where leads are emailed. Overridable via env without a code change.
const LEAD_TO = process.env.LEAD_TO_EMAIL || 'vlad@auditready.space';
// Resend requires the "from" to be on a verified domain. Until the
// domain is verified, Resend's shared onboarding sender still delivers
// to the account owner's own address.
const LEAD_FROM = process.env.LEAD_FROM_EMAIL || 'Audit Ready AI Leads <onboarding@resend.dev>';

function setCors(req, res) {
  const origin = req.headers.origin || '';
  const ok = /^https:\/\/(auditready\.space|[a-z0-9-]+\.vercel\.app)$/i.test(origin);
  res.setHeader('Access-Control-Allow-Origin', ok ? origin : 'https://auditready.space');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const clean = (s, max) => String(s ?? '').replace(/[\x00-\x1f]+/g, ' ').trim().slice(0, max);
const escHtml = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function sendViaResend({ email, company, answers, ts }) {
  if (!process.env.RESEND_API_KEY) return { sent: false, reason: 'no_api_key' };

  const rows = answers.map(a =>
    `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee;color:#555;vertical-align:top">${escHtml(a.question)}</td>` +
    `<td style="padding:6px 12px;border-bottom:1px solid #eee;font-weight:600;color:#111">${escHtml(a.answer)}</td></tr>`
  ).join('');

  const html =
    `<div style="font-family:system-ui,Arial,sans-serif;max-width:600px">` +
    `<h2 style="margin:0 0 4px">New readiness-check lead</h2>` +
    `<p style="margin:0 0 16px;color:#666;font-size:13px">${escHtml(ts)}</p>` +
    `<table style="border-collapse:collapse;width:100%;font-size:14px">` +
    `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee;color:#555">Company</td><td style="padding:6px 12px;border-bottom:1px solid #eee;font-weight:700;color:#111">${escHtml(company)}</td></tr>` +
    `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee;color:#555">Email</td><td style="padding:6px 12px;border-bottom:1px solid #eee;font-weight:700;color:#111"><a href="mailto:${escHtml(email)}">${escHtml(email)}</a></td></tr>` +
    rows +
    `</table></div>`;

  const text = `New readiness-check lead (${ts})\n\nCompany: ${company}\nEmail: ${email}\n\n` +
    answers.map(a => `${a.question}\n  → ${a.answer}`).join('\n\n');

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: LEAD_FROM,
      to: [LEAD_TO],
      reply_to: email,
      subject: `SOC 2 lead — ${company}`,
      html,
      text,
    }),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    return { sent: false, reason: `resend_${r.status}`, detail: detail.slice(0, 300) };
  }
  return { sent: true };
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body || {};
    const email = clean(body.email, 200);
    const company = clean(body.company, 200);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Invalid email' });
    if (!company) return res.status(400).json({ error: 'Company required' });

    const answers = Array.isArray(body.answers)
      ? body.answers.slice(0, 20).map(a => ({ question: clean(a.question, 200), answer: clean(a.answer, 200) }))
      : [];
    const ts = new Date().toISOString();
    const lead = { email, company, answers, source: clean(body.source, 60) || 'quiz', ts };

    // Store first so the lead is never lost, even if email is unconfigured.
    let stored = false;
    try {
      await redis.lpush('leads', JSON.stringify(lead));
      await redis.ltrim('leads', 0, 999);
      stored = true;
    } catch { /* fall through to email attempt */ }

    let emailResult = { sent: false, reason: 'unknown' };
    try {
      emailResult = await sendViaResend(lead);
    } catch (err) {
      emailResult = { sent: false, reason: 'exception', detail: String(err.message || err).slice(0, 200) };
    }

    if (!stored && !emailResult.sent) {
      return res.status(500).json({ error: 'Could not record lead' });
    }
    return res.status(200).json({ ok: true, emailed: emailResult.sent });
  } catch (err) {
    return res.status(500).json({ error: 'Lead capture failed' });
  }
}
