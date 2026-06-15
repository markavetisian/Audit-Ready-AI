// ─────────────────────────────────────────────────────────────
// api/report.js
// ACTION: REFACTORED from api/deploy-bot.js
//
//   POST /api/report     → generate Groq audit readiness report
//   GET  /api/report     → list saved reports for user
//   GET  /api/report?id= → get single report by ID
//
// KEPT:    Groq API call pattern (verbatim from analyze.js), Redis client,
//          auth middleware, CORS headers, error handling
// REMOVED: GitHub repo creation, file uploads to GitHub, Pages enabling,
//          agent tier HTML generation, deploy tracking
// ADDED:   SOC 2 audit report prompt (Section I), report save to Redis,
//          report retrieval by ID, structured JSON output
// ─────────────────────────────────────────────────────────────

import { Redis } from '@upstash/redis';
import { trackUser, checkRateLimit, logError } from './telemetry.js';

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

// ── Groq API call (verbatim pattern from analyze.js) ─────────

function safeJsonParse(text) {
  try {
    let c = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const s = c.indexOf('{'), e = c.lastIndexOf('}');
    if (s >= 0 && e > s) c = c.slice(s, e + 1);
    return JSON.parse(c);
  } catch { return null; }
}

async function groqPost(messages, maxTokens, temperature) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + process.env.GROQ_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages,
      max_tokens: maxTokens || 1000,
      temperature: temperature || 0.7,
    }),
  });
  if (!res.ok) throw new Error('Groq error ' + res.status);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

// ── Report schema ─────────────────────────────────────────────

const REPORT_SCHEMA = {
  executiveSummary: 'string — 2-3 sentences, business-focused',
  readinessByCategory: {
    CC1: 'string — one paragraph',
    CC2: 'string — one paragraph',
    CC3: 'string — one paragraph',
    CC4: 'string — one paragraph',
    CC5: 'string — one paragraph',
    CC6: 'string — one paragraph',
    CC7: 'string — one paragraph',
    CC8: 'string — one paragraph',
    CC9: 'string — one paragraph',
  },
  criticalGaps: [
    { controlId: 'string', title: 'string', remediationAction: 'string', urgency: 'HIGH|MEDIUM|LOW' }
  ],
  nextSteps: {
    thirtyDays: ['string'],
    sixtyDays: ['string'],
    ninetyDays: ['string'],
  },
  estimatedTimeToAuditReady: 'string — honest estimate e.g. "4-6 months with focused effort"',
  overallRating: 'NOT_READY | IN_PROGRESS | GETTING_CLOSE | AUDIT_READY',
};

// ── Build controls summary for prompt ────────────────────────

async function buildControlsSummary(userId) {
  const ALL_CONTROLS = [
    'CC1.1','CC1.2','CC2.1','CC2.2','CC3.1','CC3.2','CC4.1','CC4.2',
    'CC5.1','CC5.2','CC5.3','CC6.1','CC6.2','CC6.3','CC6.4','CC6.5',
    'CC6.6','CC6.7','CC7.1','CC7.2','CC7.3','CC7.4','CC7.5',
    'CC8.1','CC8.2','CC8.3','CC8.4','CC9.1','CC9.2','CC9.3','CC9.4','CC9.5','CC9.6',
  ];

  const summary = [];
  for (const id of ALL_CONTROLS) {
    const raw = await redis.get(`control:${userId}:${id}`);
    if (raw) {
      const c = typeof raw === 'object' ? raw : JSON.parse(raw);
      summary.push({ id: c.id, title: c.title, status: c.status, category: c.category });
    } else {
      summary.push({ id, status: 'NOT_STARTED', category: id.split('.')[0] });
    }
  }
  return summary;
}

// ── Get current score ─────────────────────────────────────────

async function getCurrentScore(userId) {
  try {
    const raw = await redis.get(`user:${userId}:score`);
    if (!raw) return 0;
    const data = typeof raw === 'object' ? raw : JSON.parse(raw);
    return data.score || 0;
  } catch { return 0; }
}

// ── Main handler ─────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const userId = await getUserId(req.headers.authorization);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  // ── GET: List reports or get single report ────────────────────
  if (req.method === 'GET') {
    try {
      const { id } = req.query;

      if (id) {
        // Get single report by ID (timestamp key)
        const raw = await redis.get(`user:${userId}:report:${id}`);
        if (!raw) return res.status(404).json({ error: 'Report not found' });
        const report = typeof raw === 'object' ? raw : JSON.parse(raw);
        return res.status(200).json(report);
      }

      // List all report keys for this user
      const keys = await redis.keys(`user:${userId}:report:*`);
      if (!keys.length) return res.status(200).json({ reports: [] });

      const reports = [];
      for (const key of keys.slice(0, 20)) {
        try {
          const raw = await redis.get(key);
          if (raw) {
            const r = typeof raw === 'object' ? raw : JSON.parse(raw);
            // Return summary only (no full content) for listing
            reports.push({
              id: r.id,
              generatedAt: r.generatedAt,
              score: r.score,
              overallRating: r.report?.overallRating,
              executiveSummary: r.report?.executiveSummary,
            });
          }
        } catch {}
      }
      reports.sort((a, b) => (b.generatedAt || 0) - (a.generatedAt || 0));
      return res.status(200).json({ reports });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST: Generate audit readiness report via Groq ───────────
  if (req.method === 'POST') {
    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({ error: 'GROQ_API_KEY not configured.' });
    }

    const rl = await checkRateLimit(userId, 'report');
    if (!rl.ok) {
      return res.status(429).json({ error: `Report rate limit. Retry in ${rl.retryAfter}s.`, retryAfter: rl.retryAfter });
    }

    try {
      const { companyName } = req.body || {};
      const score = await getCurrentScore(userId);
      const controlsSummary = await buildControlsSummary(userId);

      // ── Groq prompt (Section I spec) ─────────────────────────
      const prompt = `You are an expert SOC 2 compliance auditor. Based on the following compliance data, generate a structured audit readiness report.

Company: ${companyName || 'The Company'}
Overall Score: ${score}%
Framework: SOC 2 Type 1
Control Status Summary:
${JSON.stringify(controlsSummary, null, 2)}

Generate a report with these sections:
1. Executive Summary (2-3 sentences, business-focused)
2. Readiness Assessment by Category (one paragraph per TSC category CC1-CC9)
3. Critical Gaps (top 5 controls most urgently needed, with specific remediation actions)
4. Recommended Next Steps (prioritized 30/60/90 day action plan)
5. Estimated Time to Audit Ready (honest estimate based on current gaps)

Be specific, actionable, and honest. Do not pad. Do not use filler language.

Output ONLY valid JSON matching this exact schema, no preamble, no markdown:
${JSON.stringify(REPORT_SCHEMA)}`;

      const responseText = await groqPost(
        [{ role: 'user', content: prompt }],
        1000,
        0.4 // Lower temperature for structured output
      );

      if (!responseText) return res.status(500).json({ error: 'Empty response from AI.' });

      const parsed = safeJsonParse(responseText);
      if (!parsed) {
        return res.status(200).json({ rawResponse: responseText, warning: 'Could not parse structured output — report generated but unstructured' });
      }

      // Store report in Redis
      const timestamp = Date.now();
      const reportId = timestamp.toString();
      const reportData = {
        id: reportId,
        userId,
        companyName: companyName || 'The Company',
        score,
        generatedAt: timestamp,
        controlsSummary,
        report: parsed,
      };

      await redis.set(`user:${userId}:report:${reportId}`, JSON.stringify(reportData));
      await trackUser(userId, 'report');

      return res.status(200).json({
        ok: true,
        reportId,
        report: parsed,
        score,
        generatedAt: timestamp,
      });

    } catch (err) {
      await logError('report_error', { msg: err.message, userId });
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
