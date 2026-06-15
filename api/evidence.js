// ─────────────────────────────────────────────────────────────
// api/evidence.js
// ACTION: NEW (slot 9)
//
//   POST   /api/evidence              → add evidence item to a control
//   GET    /api/evidence?controlId=X  → get all evidence for a control
//   DELETE /api/evidence?id=X         → remove evidence item
//
// No binary file storage — metadata/links only (per Section H constraints).
// Evidence types: LINK | FILE_NAME | AUTO_DETECTED | SCREENSHOT
// Auto-detected evidence is not deletable.
// Score is recomputed after evidence add/remove.
// ─────────────────────────────────────────────────────────────

import { Redis } from '@upstash/redis';
import { recomputeScore } from './scan.js';

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

// ── Generate a simple unique ID ───────────────────────────────

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ── Evidence item validation ──────────────────────────────────

const VALID_TYPES = ['LINK', 'FILE_NAME', 'AUTO_DETECTED', 'SCREENSHOT'];
const VALID_SOURCES = ['MANUAL', 'GITHUB', 'GOOGLE_DRIVE', 'AWS'];
const MAX_EVIDENCE_PER_CONTROL = 10;

// ── URL validation ────────────────────────────────────────────

function validateUrl(url) {
  if (!url || typeof url !== 'string') return { valid: false, error: 'URL is required' };
  const trimmed = url.trim();
  if (trimmed.length < 10) return { valid: false, error: 'URL is too short to be valid' };
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    return { valid: false, error: 'URL must start with http:// or https://' };
  }
  // Reject localhost and loopback addresses
  if (trimmed.includes('localhost') || trimmed.includes('127.0.0.1') || trimmed.includes('::1')) {
    return { valid: false, error: 'Local URLs (localhost, 127.0.0.1) cannot be used as evidence. Please provide a publicly accessible or internal company URL.' };
  }
  try {
    new URL(trimmed);
    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid URL format. Please include the full URL (e.g. https://docs.company.com/policy)' };
  }
}

// ── Evidence quality scoring ──────────────────────────────────

function computeQuality(type, note) {
  const hasNote = note && note.trim().length > 0;
  if (type === 'LINK') return hasNote ? 'GOOD' : 'BASIC';
  if (type === 'FILE_NAME') return 'BASIC';
  if (type === 'SCREENSHOT') return hasNote ? 'GOOD' : 'BASIC';
  if (type === 'AUTO_DETECTED') return 'GOOD';
  return 'BASIC';
}

// ── Main handler ─────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const userId = await getUserId(req.headers.authorization);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  // ── GET: Fetch all evidence for a control ─────────────────────
  if (req.method === 'GET') {
    const { controlId } = req.query;
    if (!controlId) return res.status(400).json({ error: 'Missing controlId' });

    try {
      const key = `user:${userId}:evidence:${controlId}`;
      const raw = await redis.get(key);
      const items = raw ? (typeof raw === 'object' ? raw : JSON.parse(raw)) : [];
      return res.status(200).json({ items, count: items.length });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST: Add evidence item to a control ──────────────────────
  if (req.method === 'POST') {
    const { controlId, type, value, source, note } = req.body || {};

    if (!controlId) return res.status(400).json({ error: 'Missing controlId' });
    if (!type || !VALID_TYPES.includes(type)) {
      return res.status(400).json({ error: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}` });
    }
    if (!value || !value.trim()) return res.status(400).json({ error: 'Missing value' });
    const effectiveSource = (source && VALID_SOURCES.includes(source)) ? source : 'MANUAL';

    // ── LINK type validation ───────────────────────────────────
    if (type === 'LINK') {
      const urlCheck = validateUrl(value.trim());
      if (!urlCheck.valid) {
        return res.status(400).json({ error: urlCheck.error });
      }
    }

    // ── Default note for LINK without note ─────────────────────
    let effectiveNote = note || '';
    if (type === 'LINK' && !effectiveNote) {
      effectiveNote = 'URL link';
    }

    try {
      // ── Check evidence count limit ─────────────────────────────
      const key = `user:${userId}:evidence:${controlId}`;
      const raw = await redis.get(key);
      const items = raw ? (typeof raw === 'object' ? raw : JSON.parse(raw)) : [];

      if (items.length >= MAX_EVIDENCE_PER_CONTROL) {
        return res.status(400).json({
          error: `Maximum of ${MAX_EVIDENCE_PER_CONTROL} evidence items per control. Remove an existing item before adding a new one.`
        });
      }

      // ── Build evidence item per Section D3 schema ──────────────
      const now = new Date().toISOString();
      const quality = computeQuality(type, effectiveNote);
      const item = {
        id: generateId(),
        controlId,
        type,
        value: value.trim(),
        source: effectiveSource,
        uploadedAt: now,
        updatedAt: now,
        note: effectiveNote,
        quality,
      };

      items.push(item);
      await redis.set(key, JSON.stringify(items));

      // Update control status: if was NOT_STARTED or IN_PROGRESS, move to EVIDENCE_UPLOADED
      const controlKey = `control:${userId}:${controlId}`;
      const cRaw = await redis.get(controlKey);
      if (cRaw) {
        const control = typeof cRaw === 'object' ? cRaw : JSON.parse(cRaw);
        const statusRank = { NOT_STARTED: 0, IN_PROGRESS: 1, EVIDENCE_UPLOADED: 2, CONNECTED_AUTO: 3, NOT_APPLICABLE: -1 };
        if ((statusRank[control.status] ?? 0) < statusRank['EVIDENCE_UPLOADED']) {
          control.status = 'EVIDENCE_UPLOADED';
          control.lastUpdated = now;
          control.evidenceItems = items.map(i => i.id);
          await redis.set(controlKey, JSON.stringify(control));
        } else {
          // Just update evidence list reference
          control.evidenceItems = items.map(i => i.id);
          control.lastUpdated = now;
          await redis.set(controlKey, JSON.stringify(control));
        }
      }

      // Recompute score
      const newScore = await recomputeScore(userId);

      return res.status(201).json({ ok: true, item, newScore });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── DELETE: Remove evidence item by ID ────────────────────────
  if (req.method === 'DELETE') {
    const { id, controlId } = req.query;
    if (!id || !controlId) return res.status(400).json({ error: 'Missing id and controlId' });

    try {
      const key = `user:${userId}:evidence:${controlId}`;
      const raw = await redis.get(key);
      if (!raw) return res.status(404).json({ error: 'No evidence found for this control' });

      let items = typeof raw === 'object' ? raw : JSON.parse(raw);
      const target = items.find(i => i.id === id);
      if (!target) return res.status(404).json({ error: 'Evidence item not found' });

      // AUTO_DETECTED evidence cannot be deleted
      if (target.source === 'GITHUB' || target.source === 'GOOGLE_DRIVE' || target.source === 'AWS' || target.type === 'AUTO_DETECTED') {
        return res.status(403).json({ error: 'Auto-detected evidence cannot be manually deleted. Disconnect the integration to remove it.' });
      }

      items = items.filter(i => i.id !== id);
      await redis.set(key, JSON.stringify(items));

      // If no evidence left, revert control to IN_PROGRESS
      if (items.length === 0) {
        const controlKey = `control:${userId}:${controlId}`;
        const cRaw = await redis.get(controlKey);
        if (cRaw) {
          const control = typeof cRaw === 'object' ? cRaw : JSON.parse(cRaw);
          if (control.status === 'EVIDENCE_UPLOADED') {
            control.status = 'IN_PROGRESS';
            control.lastUpdated = new Date().toISOString();
            control.evidenceItems = [];
            await redis.set(controlKey, JSON.stringify(control));
          }
        }
      } else {
        // Update control evidence list
        const controlKey = `control:${userId}:${controlId}`;
        const cRaw = await redis.get(controlKey);
        if (cRaw) {
          const control = typeof cRaw === 'object' ? cRaw : JSON.parse(cRaw);
          control.evidenceItems = items.map(i => i.id);
          control.lastUpdated = new Date().toISOString();
          await redis.set(controlKey, JSON.stringify(control));
        }
      }

      const newScore = await recomputeScore(userId);
      return res.status(200).json({ ok: true, deleted: id, remaining: items.length, newScore });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
