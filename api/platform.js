// api/platform.js
// Multi-purpose platform endpoint (uses the last available Vercel function slot
// — Vercel Hobby caps a deployment at 12 Serverless Functions, so new routes
// get added here as a `type=` action instead of as a new api/*.js file)
//
//   GET  /api/platform?type=vendors            → list vendors
//   POST /api/platform  {type:'vendor',...}    → add vendor
//   DELETE /api/platform?type=vendor&id=X      → remove vendor
//   GET  /api/platform?type=profile            → get company profile
//   POST /api/platform  {type:'profile',...}   → save company profile
//   GET  /api/platform?type=reminders          → upcoming renewals + expiring evidence
//   GET  /api/platform?type=export             → full self-service data export (GDPR/CCPA)
//   DELETE /api/platform?type=account          → self-service account + data deletion

import { Redis } from '@upstash/redis';
import { verifySession, logError } from './_telemetry.js';
import { CONTROL_DEFINITIONS } from './controls.js';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

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

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

const RISK_LEVELS = ['HIGH', 'MEDIUM', 'LOW'];

// Controls with periodic renewal requirements and their cadence in days
const RENEWAL_SCHEDULE = {
  'CC1.1': { days: 365, label: 'Security Policy annual review' },
  'CC1.3': { days: 365, label: 'Code of conduct annual acknowledgment' },
  'CC2.1': { days: 365, label: 'Security awareness training renewal' },
  'CC3.1': { days: 365, label: 'Risk assessment annual review' },
  'CC3.2': { days: 365, label: 'Risk register annual update' },
  'CC4.2': { days: 365, label: 'Internal audit annual review' },
  'CC5.3': { days: 365, label: 'Data retention policy annual review' },
  'CC6.4': { days: 90,  label: 'Quarterly access review due' },
  'CC7.2': { days: 180, label: 'Backup restoration test due' },
  'CC7.3': { days: 365, label: 'Incident response plan annual review' },
  'CC7.4': { days: 90,  label: 'Vulnerability scan due' },
  'CC7.5': { days: 365, label: 'Annual penetration test due' },
  'CC9.1': { days: 365, label: 'Vendor risk assessment annual review' },
  'CC9.3': { days: 365, label: 'Business continuity plan annual test' },
  'CC9.4': { days: 365, label: 'Disaster recovery plan annual test' },
  'CC9.9': { days: 365, label: 'Annual SOC 2 readiness review' },
  'CC9.10':{ days: 365, label: 'Privacy policy annual review' },
};

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

export default async function handler(req, res) {
  const _origin = req.headers.origin || '';
  const _originOk = /^https:\/\/(auditready\.space|[a-z0-9-]+\.vercel\.app)$/i.test(_origin);
  res.setHeader('Access-Control-Allow-Origin', _originOk ? _origin : 'https://auditready.space');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const userId = await getUserId(req.headers.authorization);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { type, id } = req.query;

  // ── GET ──────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {

    // Hands the Google Picker API key to an already-authenticated frontend
    // instead of shipping it baked into the static HTML. It's a browser key
    // restricted by HTTP referrer, not a secret — this is about easy
    // rotation, not protecting a credential that needed hiding.
    if (type === 'config') {
      return res.status(200).json({ pickerApiKey: process.env.GOOGLE_PICKER_API_KEY || '' });
    }

    if (type === 'vendors') {
      try {
        const raw = await redis.get(`user:${userId}:vendors`);
        const vendors = raw ? (typeof raw === 'object' ? raw : JSON.parse(raw)) : [];
        return res.status(200).json({ vendors });
      } catch (err) { return res.status(500).json({ error: 'Internal error. Please try again.' }); }
    }

    if (type === 'profile') {
      try {
        const raw = await redis.get(`user:${userId}:profile`);
        const profile = raw ? (typeof raw === 'object' ? raw : JSON.parse(raw)) : {};
        return res.status(200).json({ profile });
      } catch (err) { return res.status(500).json({ error: 'Internal error. Please try again.' }); }
    }

    if (type === 'reminders') {
      try {
        const now = Date.now();
        const reminders = [];

        const renewalEntries = Object.entries(RENEWAL_SCHEDULE);

        // Fetch all control + evidence + vendor data in parallel
        const [renewalRaws, evidenceRaws, vendorRaw] = await Promise.all([
          Promise.all(renewalEntries.map(([id]) => redis.get(`control:${userId}:${id}`).catch(() => null))),
          Promise.all(ALL_CONTROLS.map(id => redis.get(`user:${userId}:evidence:${id}`).catch(() => null))),
          redis.get(`user:${userId}:vendors`).catch(() => null),
        ]);

        // Control-based renewal reminders
        for (let i = 0; i < renewalEntries.length; i++) {
          const [controlId, schedule] = renewalEntries[i];
          const raw = renewalRaws[i];
          if (!raw) continue;
          const control = typeof raw === 'object' ? raw : JSON.parse(raw);
          if (control.status === 'NOT_APPLICABLE' || control.status === 'NOT_STARTED') continue;
          const lastUpdated = control.lastUpdated ? new Date(control.lastUpdated).getTime() : now;
          const dueDate = lastUpdated + schedule.days * 24 * 60 * 60 * 1000;
          const daysUntilDue = Math.round((dueDate - now) / (24 * 60 * 60 * 1000));
          if (daysUntilDue <= 60) {
            reminders.push({
              type: 'control_renewal',
              controlId,
              label: schedule.label,
              dueDate: new Date(dueDate).toISOString(),
              daysUntilDue,
              urgent: daysUntilDue <= 14,
            });
          }
        }

        // Expiring evidence items
        for (let i = 0; i < ALL_CONTROLS.length; i++) {
          const raw = evidenceRaws[i];
          if (!raw) continue;
          const controlId = ALL_CONTROLS[i];
          const items = typeof raw === 'object' ? raw : JSON.parse(raw);
          for (const item of items) {
            if (!item.expiryDate) continue;
            const expiry = new Date(item.expiryDate).getTime();
            const daysUntilExpiry = Math.round((expiry - now) / (24 * 60 * 60 * 1000));
            if (daysUntilExpiry <= 60) {
              reminders.push({
                type: 'evidence_expiry',
                controlId,
                evidenceId: item.id,
                label: `Evidence expiring: ${(item.value || '').slice(0, 50)}`,
                dueDate: item.expiryDate,
                daysUntilDue: daysUntilExpiry,
                urgent: daysUntilExpiry <= 14,
              });
            }
          }
        }

        // Vendor SOC 2 report expiry
        const vendors = vendorRaw ? (typeof vendorRaw === 'object' ? vendorRaw : JSON.parse(vendorRaw)) : [];
        for (const vendor of vendors) {
          if (!vendor.soc2ReportExpiry) continue;
          const expiry = new Date(vendor.soc2ReportExpiry).getTime();
          const daysUntilExpiry = Math.round((expiry - now) / (24 * 60 * 60 * 1000));
          if (daysUntilExpiry <= 90) {
            reminders.push({
              type: 'vendor_report_expiry',
              vendorId: vendor.id,
              vendorName: vendor.name,
              label: `${vendor.name} SOC 2 report expiring`,
              dueDate: vendor.soc2ReportExpiry,
              daysUntilDue: daysUntilExpiry,
              urgent: daysUntilExpiry <= 30,
            });
          }
        }

        reminders.sort((a, b) => a.daysUntilDue - b.daysUntilDue);
        return res.status(200).json({
          reminders,
          total: reminders.length,
          urgent: reminders.filter(r => r.urgent).length,
        });
      } catch (err) {
        console.error('platform reminders error:', err && (err.stack || err.message || err));
        await logError('platform_reminders_error', { msg: err?.message, stack: err?.stack }).catch(() => {});
        return res.status(500).json({ error: 'Internal error. Please try again.', detail: err?.message || String(err) });
      }
    }

    if (type === 'export') {
      try {
        const controlIds = CONTROL_DEFINITIONS.map(d => d.id);

        const [controlRaws, evidenceRaws, profile, vendors, score, scoreHistoryRaw, reportIds] = await Promise.all([
          Promise.all(controlIds.map(cid => redis.get(`control:${userId}:${cid}`).catch(() => null))),
          Promise.all(controlIds.map(cid => redis.get(`user:${userId}:evidence:${cid}`).catch(() => null))),
          redis.get(`user:${userId}:profile`).catch(() => null),
          redis.get(`user:${userId}:vendors`).catch(() => null),
          redis.get(`user:${userId}:score`).catch(() => null),
          redis.lrange(`user:${userId}:scoreHistory`, 0, 89).catch(() => []),
          redis.lrange(`user:${userId}:reports`, 0, 49).catch(() => []),
        ]);

        const controls = {};
        const evidence = {};
        for (let i = 0; i < controlIds.length; i++) {
          const c = parseJson(controlRaws[i]);
          if (c) controls[controlIds[i]] = c;
          const e = parseJson(evidenceRaws[i]);
          if (e) evidence[controlIds[i]] = e;
        }

        const scoreHistory = (scoreHistoryRaw || []).map(parseJson).filter(Boolean);
        const reportRaws = await Promise.all((reportIds || []).map(id => redis.get(`user:${userId}:report:${id}`).catch(() => null)));
        const reports = reportRaws.map(parseJson).filter(Boolean);

        return res.status(200).json({
          exportedAt: new Date().toISOString(),
          userId,
          profile: parseJson(profile) || {},
          controls,
          evidence,
          vendors: parseJson(vendors) || [],
          score: parseJson(score),
          scoreHistory,
          reports,
        });
      } catch (err) {
        console.error('Export error:', err.message);
        return res.status(500).json({ error: 'Could not generate export. Please try again.' });
      }
    }

    return res.status(400).json({ error: 'Missing or invalid type parameter' });
  }

  // ── POST ─────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const body = req.body || {};

    if (body.type === 'vendor') {
      const { name, website, category, riskLevel, soc2ReportUrl, soc2ReportExpiry, notes } = body;
      if (!name || !name.trim()) return res.status(400).json({ error: 'Vendor name required' });
      try {
        const key = `user:${userId}:vendors`;
        const raw = await redis.get(key);
        const vendors = raw ? (typeof raw === 'object' ? raw : JSON.parse(raw)) : [];
        const vendor = {
          id: generateId(),
          name: name.trim(),
          website: website || '',
          category: category || 'Other',
          riskLevel: RISK_LEVELS.includes(riskLevel) ? riskLevel : 'MEDIUM',
          soc2ReportUrl: soc2ReportUrl || '',
          soc2ReportExpiry: soc2ReportExpiry || '',
          notes: notes || '',
          addedAt: new Date().toISOString(),
        };
        vendors.push(vendor);
        await redis.set(key, JSON.stringify(vendors));
        return res.status(201).json({ ok: true, vendor });
      } catch (err) { return res.status(500).json({ error: 'Internal error. Please try again.' }); }
    }

    if (body.type === 'profile') {
      const { companyName, description, website, logoUrl, frameworks } = body;
      try {
        const key = `user:${userId}:profile`;
        const raw = await redis.get(key);
        const existing = raw ? (typeof raw === 'object' ? raw : JSON.parse(raw)) : {};
        const profile = {
          ...existing,
          companyName: companyName !== undefined ? companyName : existing.companyName || '',
          description: description !== undefined ? description : existing.description || '',
          website: website !== undefined ? website : existing.website || '',
          logoUrl: logoUrl !== undefined ? logoUrl : existing.logoUrl || '',
          frameworks: frameworks || existing.frameworks || ['SOC 2 Type 1'],
          updatedAt: new Date().toISOString(),
        };
        await redis.set(key, JSON.stringify(profile));
        return res.status(200).json({ ok: true, profile });
      } catch (err) { return res.status(500).json({ error: 'Internal error. Please try again.' }); }
    }

    return res.status(400).json({ error: 'Missing or invalid type' });
  }

  // ── DELETE ────────────────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    if (type === 'vendor' && id) {
      try {
        const key = `user:${userId}:vendors`;
        const raw = await redis.get(key);
        let vendors = raw ? (typeof raw === 'object' ? raw : JSON.parse(raw)) : [];
        vendors = vendors.filter(v => v.id !== id);
        await redis.set(key, JSON.stringify(vendors));
        return res.status(200).json({ ok: true });
      } catch (err) { return res.status(500).json({ error: 'Internal error. Please try again.' }); }
    }

    // Self-service account + data deletion (GDPR Art. 17 / CCPA right to delete).
    // Erases the same full key set as the admin "delete" action, but is
    // callable by the user themselves against their own account only.
    if (type === 'account') {
      try {
        const [controlKeys, evidenceKeys, reportKeys] = await Promise.all([
          redis.keys(`control:${userId}:*`).catch(() => []),
          redis.keys(`user:${userId}:evidence:*`).catch(() => []),
          redis.keys(`user:${userId}:report:*`).catch(() => []),
        ]);
        const keysToDelete = [
          `admin:user:${userId}`,
          `blocked:${userId}`,
          `banned:${userId}`,
          `user:${userId}:score`,
          `user:${userId}:scoreHistory`,
          `user:${userId}:vendors`,
          `user:${userId}:profile`,
          `user:${userId}:shares`,
          `user:${userId}:lastScan`,
          `user:${userId}:reports`,
          `user:${userId}:seeded`,
          ...controlKeys, ...evidenceKeys, ...reportKeys,
        ];
        await Promise.all(keysToDelete.map(k => redis.del(k).catch(() => {})));
        return res.status(200).json({ ok: true, deleted: true });
      } catch (err) {
        await logError('account_delete_error', { msg: err.message, userId });
        return res.status(500).json({ error: 'Could not delete account. Please try again or contact support.' });
      }
    }

    return res.status(400).json({ error: 'Missing type or id' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

function parseJson(raw) {
  if (!raw) return null;
  return typeof raw === 'object' ? raw : JSON.parse(raw);
}
