import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { listByChannel, setStatus, saveDraft, sentTodayCount, incrSentToday } from './store.js';
import { draftMessage } from '../templates.js';
import { CHANNELS, DAILY_CAPS } from '../config.js';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Selects up to each channel's remaining daily cap from "new" leads,
// generates + saves a draft for each, flips them to "queued", and bumps
// the day's sent counter. Shared by the CLI and the dashboard so both
// enforce the exact same caps against the exact same counters.
export async function buildTodayQueue() {
  const byChannel = {};
  let totalQueued = 0;

  for (const channel of CHANNELS) {
    const cap = DAILY_CAPS[channel] ?? 0;
    const already = await sentTodayCount(channel);
    const remaining = Math.max(0, cap - already);
    if (remaining === 0) continue;

    const leads = (await listByChannel(channel)).filter(l => l.status === 'new').slice(0, remaining);
    if (leads.length === 0) continue;

    const entries = [];
    for (const lead of leads) {
      const draft = draftMessage(lead);
      await saveDraft(lead.id, draft);
      const updated = await setStatus(lead.id, 'queued');
      await incrSentToday(channel, 1);
      totalQueued += 1;
      entries.push({ lead: updated, draft });
    }
    byChannel[channel] = entries;
  }

  return { totalQueued, byChannel };
}

export function formatQueueMarkdown(byChannel, date) {
  const lines = [`# Outreach queue — ${date}\n`];
  for (const [channel, entries] of Object.entries(byChannel)) {
    lines.push(`## ${channel} (${entries.length})\n`);
    for (const { lead, draft } of entries) {
      lines.push(`### [${lead.id}] ${lead.name || '(no name)'} — ${lead.company || 'unknown company'}`);
      lines.push(`Contact: ${lead.contact}`);
      if (draft.subject) lines.push(`Subject: ${draft.subject}`);
      lines.push('');
      lines.push(draft.body);
      lines.push('');
      lines.push(`_mark sent:_ \`node growth/cli.js mark ${lead.id} contacted\``);
      lines.push('\n---\n');
    }
  }
  return lines.join('\n');
}

export function writeQueueFile(byChannel) {
  const date = new Date().toISOString().slice(0, 10);
  const outDir = join(rootDir, 'growth', 'out');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `queue-${date}.md`);
  writeFileSync(outPath, formatQueueMarkdown(byChannel, date), 'utf8');
  return outPath;
}
