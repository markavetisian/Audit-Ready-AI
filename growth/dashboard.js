#!/usr/bin/env node
// Local-only web dashboard. Binds to 127.0.0.1 (never 0.0.0.0) since lead
// contact info is PII and there's no auth layer here — this is a tool you
// run on your own machine, not something to expose on a network.

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { STATUSES, setStatus, listAll, listByStatus } from './lib/store.js';
import { buildTodayQueue, writeQueueFile } from './lib/queue.js';
import { getStatusSnapshot } from './lib/status.js';
import { ingestGitHub } from './sources/github.js';
import { ingestProductHunt } from './sources/producthunt.js';

const dir = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.GROWTH_DASHBOARD_PORT || 4173);
const HOST = '127.0.0.1';

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

function send(res, status, body, contentType = 'application/json') {
  const payload = contentType === 'application/json' ? JSON.stringify(body) : body;
  res.writeHead(status, { 'Content-Type': `${contentType}; charset=utf-8` });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

async function handleApi(req, res, pathname) {
  if (pathname === '/api/status' && req.method === 'GET') {
    return send(res, 200, await getStatusSnapshot());
  }

  if (pathname === '/api/leads' && req.method === 'GET') {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const status = url.searchParams.get('status');
    const leads = status && status !== 'all' ? await listByStatus(status) : await listAll();
    leads.sort((a, b) => b.addedAt - a.addedAt);
    return send(res, 200, { leads });
  }

  if (pathname === '/api/mark' && req.method === 'POST') {
    const { id, status } = await readBody(req);
    if (!id || !STATUSES.includes(status)) return send(res, 400, { error: `id and a valid status (${STATUSES.join('|')}) required` });
    const lead = await setStatus(id, status);
    return send(res, 200, { lead });
  }

  if (pathname === '/api/queue' && req.method === 'POST') {
    const { totalQueued, byChannel } = await buildTodayQueue();
    const outPath = totalQueued > 0 ? writeQueueFile(byChannel) : null;
    return send(res, 200, { totalQueued, byChannel, outPath });
  }

  if (pathname === '/api/source' && req.method === 'POST') {
    const { which } = await readBody(req);
    if (which === 'github') return send(res, 200, await ingestGitHub());
    if (which === 'producthunt') return send(res, 200, await ingestProductHunt());
    return send(res, 400, { error: 'which must be github or producthunt' });
  }

  return send(res, 404, { error: 'not found' });
}

function serveStatic(req, res, pathname) {
  const file = pathname === '/' ? 'dashboard.html' : pathname.slice(1);
  const filePath = join(dir, 'public', file);
  if (!filePath.startsWith(join(dir, 'public'))) return send(res, 403, { error: 'forbidden' });
  try {
    const body = readFileSync(filePath);
    send(res, 200, body, MIME[extname(filePath)] || 'application/octet-stream');
  } catch {
    send(res, 404, { error: 'not found' });
  }
}

const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
  try {
    if (pathname.startsWith('/api/')) await handleApi(req, res, pathname);
    else serveStatic(req, res, pathname);
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Growth dashboard: http://${HOST}:${PORT}`);
});
