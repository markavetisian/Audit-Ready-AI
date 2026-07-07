import { Redis } from '@upstash/redis';
import { createHash } from 'node:crypto';
import { loadEnv } from './env.js';

loadEnv();

// Lazy singleton: only requires KV_REST_API_URL/TOKEN once a Redis-backed
// call is actually made, so commands like bare `node growth/cli.js` (usage)
// or `mark`/`status` --help paths don't hard-fail just from being imported.
let _redis = null;
function redis() {
  if (_redis) return _redis;
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    throw new Error(
      'Missing KV_REST_API_URL / KV_REST_API_TOKEN.\n' +
      'Set them in the environment or in a .env.local file at the repo root ' +
      '(same Upstash Redis instance the main app uses works fine).'
    );
  }
  _redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
  return _redis;
}

export const STATUSES = ['new', 'queued', 'contacted', 'replied', 'demo', 'won', 'lost'];

export function leadId(channel, contact) {
  return createHash('sha1').update(`${channel}:${String(contact).trim().toLowerCase()}`).digest('hex').slice(0, 16);
}

function leadKey(id) { return `growth:lead:${id}`; }
function statusIndexKey(status) { return `growth:index:status:${status}`; }
function channelIndexKey(channel) { return `growth:index:channel:${channel}`; }
const ALL_INDEX = 'growth:index:all';

export async function addLead({ channel, name, company, contact, note }) {
  if (!channel || !contact) throw new Error('addLead requires channel and contact');
  const id = leadId(channel, contact);
  const exists = await redis().sismember(ALL_INDEX, id);
  if (exists) return { id, created: false };

  const lead = {
    id, channel, name: name || '', company: company || '', contact,
    note: note || '', status: 'new', addedAt: Date.now(), statusUpdatedAt: Date.now(),
  };
  await redis().set(leadKey(id), JSON.stringify(lead));
  await redis().sadd(ALL_INDEX, id);
  await redis().sadd(channelIndexKey(channel), id);
  await redis().sadd(statusIndexKey('new'), id);
  return { id, created: true, lead };
}

export async function getLead(id) {
  const raw = await redis().get(leadKey(id));
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

export async function setStatus(id, status) {
  if (!STATUSES.includes(status)) throw new Error(`Unknown status: ${status}`);
  const lead = await getLead(id);
  if (!lead) throw new Error(`No lead with id ${id}`);
  await redis().srem(statusIndexKey(lead.status), id);
  lead.status = status;
  lead.statusUpdatedAt = Date.now();
  await redis().set(leadKey(id), JSON.stringify(lead));
  await redis().sadd(statusIndexKey(status), id);
  return lead;
}

export async function saveDraft(id, draft) {
  const lead = await getLead(id);
  if (!lead) throw new Error(`No lead with id ${id}`);
  lead.draft = draft;
  await redis().set(leadKey(id), JSON.stringify(lead));
  return lead;
}

async function hydrate(ids) {
  const leads = await Promise.all(ids.map(getLead));
  return leads.filter(Boolean);
}

export async function listByStatus(status) {
  return hydrate(await redis().smembers(statusIndexKey(status)));
}

export async function listByChannel(channel) {
  return hydrate(await redis().smembers(channelIndexKey(channel)));
}

export async function listAll() {
  return hydrate(await redis().smembers(ALL_INDEX));
}

export async function countsByStatus() {
  const out = {};
  for (const s of STATUSES) out[s] = await redis().scard(statusIndexKey(s));
  return out;
}

export async function countsByChannel(channels) {
  const out = {};
  for (const c of channels) out[c] = await redis().scard(channelIndexKey(c));
  return out;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export async function sentTodayCount(channel) {
  const v = await redis().get(`growth:daily:${channel}:${today()}`);
  return Number(v || 0);
}

export async function incrSentToday(channel, by = 1) {
  const key = `growth:daily:${channel}:${today()}`;
  const v = await redis().incrby(key, by);
  await redis().expire(key, 60 * 60 * 24 * 3);
  return v;
}
