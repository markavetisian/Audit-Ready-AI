#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ingestHN } from './sources/hn.js';
import { ingestGitHub } from './sources/github.js';
import { ingestProductHunt } from './sources/producthunt.js';
import { importCsv } from './sources/import.js';
import { draftMessage } from './templates.js';
import {
  STATUSES, listByChannel, setStatus, saveDraft,
  countsByStatus, countsByChannel, sentTodayCount, incrSentToday,
} from './lib/store.js';
import { CHANNELS, DAILY_CAPS, GOAL } from './config.js';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');

function usage() {
  console.log(`auditready growth CLI

  node growth/cli.js source hn                 fetch this month's HN "who is hiring" thread
  node growth/cli.js source github              scan GitHub for candidate repos/contributors
  node growth/cli.js source producthunt         scan today's Product Hunt launches (needs PRODUCTHUNT_TOKEN)
  node growth/cli.js import <csv> [--channel c] import hand-collected leads (x / linkedin / apollo / ...)
  node growth/cli.js queue                      build today's capped outreach batch with drafted messages
  node growth/cli.js mark <id> <status>         update a lead's status (${STATUSES.join('|')})
  node growth/cli.js status                     pipeline + MRR progress dashboard
`);
}

async function cmdSource(which) {
  if (which === 'hn') {
    const r = await ingestHN();
    console.log(`[hn] ${r.threadTitle}\nScanned ${r.scanned}, matched ${r.matched}, added ${r.added} new leads (${r.duplicates} dupes).`);
  } else if (which === 'github') {
    const r = await ingestGitHub();
    console.log(`[github] Scanned ${r.scanned} repos, added ${r.added} new leads (${r.duplicates} dupes).`);
  } else if (which === 'producthunt') {
    const r = await ingestProductHunt();
    if (r.skipped) console.log(`[producthunt] skipped: ${r.reason}`);
    else console.log(`[producthunt] Scanned ${r.scanned}, added ${r.added} new leads (${r.duplicates} dupes).`);
  } else {
    console.error(`Unknown source: ${which}. Try hn, github, or producthunt.`);
    process.exit(1);
  }
}

async function cmdImport(path, flags) {
  if (!path) { console.error('Usage: node growth/cli.js import <csv-path> [--channel <channel>]'); process.exit(1); }
  const idx = flags.indexOf('--channel');
  const defaultChannel = idx !== -1 ? flags[idx + 1] : undefined;
  const r = await importCsv(path, { defaultChannel });
  console.log(`[import] Scanned ${r.scanned} rows, added ${r.added} new leads (${r.duplicates} dupes, ${r.skipped} skipped).`);
}

async function cmdQueue() {
  const date = new Date().toISOString().slice(0, 10);
  const lines = [`# Outreach queue — ${date}\n`];
  let totalQueued = 0;

  for (const channel of CHANNELS) {
    const cap = DAILY_CAPS[channel] ?? 0;
    const already = await sentTodayCount(channel);
    const remaining = Math.max(0, cap - already);
    if (remaining === 0) continue;

    const leads = (await listByChannel(channel)).filter(l => l.status === 'new').slice(0, remaining);
    if (leads.length === 0) continue;

    lines.push(`## ${channel} (${leads.length} of ${remaining} remaining today's cap)\n`);
    for (const lead of leads) {
      const draft = draftMessage(lead);
      await saveDraft(lead.id, draft);
      await setStatus(lead.id, 'queued');
      await incrSentToday(channel, 1);
      totalQueued += 1;

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

  if (totalQueued === 0) {
    console.log('Nothing to queue — either daily caps are hit or there are no "new" leads. Run a `source` or `import` command first.');
    return;
  }

  const outDir = join(rootDir, 'growth', 'out');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `queue-${date}.md`);
  writeFileSync(outPath, lines.join('\n'), 'utf8');
  console.log(`Queued ${totalQueued} leads across channels. Drafts written to ${outPath}`);
  console.log('Send them by hand from the actual platform/inbox, then mark each contacted.');
}

async function cmdMark(id, status) {
  if (!id || !STATUSES.includes(status)) {
    console.error(`Usage: node growth/cli.js mark <id> <${STATUSES.join('|')}>`);
    process.exit(1);
  }
  const lead = await setStatus(id, status);
  console.log(`[${lead.id}] ${lead.name || lead.contact} -> ${status}`);
}

async function cmdStatus() {
  const byStatus = await countsByStatus();
  const byChannel = await countsByChannel(CHANNELS);
  const won = byStatus.won || 0;
  const mrr = won * GOAL.pricePerCustomer;
  const daysLeft = Math.ceil((new Date(GOAL.deadline) - Date.now()) / 86400000);

  console.log('=== Pipeline ===');
  for (const s of STATUSES) console.log(`  ${s.padEnd(10)} ${byStatus[s] || 0}`);

  console.log('\n=== By channel ===');
  for (const c of CHANNELS) {
    const sentToday = await sentTodayCount(c);
    console.log(`  ${c.padEnd(12)} ${String(byChannel[c] || 0).padStart(4)} total   ${sentToday}/${DAILY_CAPS[c]} sent today`);
  }

  console.log('\n=== MRR vs goal ===');
  console.log(`  $${mrr}/mo from ${won} won deals  ->  goal $${GOAL.mrrTarget}/mo (${GOAL.customersNeeded} customers @ $${GOAL.pricePerCustomer}/mo)`);
  console.log(`  ${GOAL.customersNeeded - won} customers still needed, ${daysLeft} days left until ${GOAL.deadline}`);
}

async function main() {
  const [, , cmd, ...rest] = process.argv;
  switch (cmd) {
    case 'source': return cmdSource(rest[0]);
    case 'import': return cmdImport(rest[0], rest.slice(1));
    case 'queue': return cmdQueue();
    case 'mark': return cmdMark(rest[0], rest[1]);
    case 'status': return cmdStatus();
    default: return usage();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
