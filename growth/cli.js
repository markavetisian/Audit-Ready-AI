#!/usr/bin/env node
import { ingestHN } from './sources/hn.js';
import { ingestGitHub } from './sources/github.js';
import { ingestProductHunt } from './sources/producthunt.js';
import { importCsv } from './sources/import.js';
import { STATUSES, setStatus } from './lib/store.js';
import { buildTodayQueue, writeQueueFile } from './lib/queue.js';
import { getStatusSnapshot } from './lib/status.js';
import { DAILY_CAPS, GOAL } from './config.js';

function usage() {
  console.log(`auditready growth CLI

  node growth/cli.js source hn                 fetch this month's HN "who is hiring" thread
  node growth/cli.js source github              scan GitHub for candidate repos/contributors
  node growth/cli.js source producthunt         scan today's Product Hunt launches (needs PRODUCTHUNT_TOKEN)
  node growth/cli.js import <csv> [--channel c] import hand-collected leads (x / linkedin / apollo / ...)
  node growth/cli.js queue                      build today's capped outreach batch with drafted messages
  node growth/cli.js mark <id> <status>         update a lead's status (${STATUSES.join('|')})
  node growth/cli.js status                     pipeline + MRR progress dashboard
  node growth/cli.js dashboard                  start the local web dashboard (http://127.0.0.1:4173)
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
  const { totalQueued, byChannel } = await buildTodayQueue();
  if (totalQueued === 0) {
    console.log('Nothing to queue — either daily caps are hit or there are no "new" leads. Run a `source` or `import` command first.');
    return;
  }
  const outPath = writeQueueFile(byChannel);
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
  const s = await getStatusSnapshot();

  console.log('=== Pipeline ===');
  for (const st of s.statuses) console.log(`  ${st.padEnd(10)} ${s.byStatus[st] || 0}`);

  console.log('\n=== By channel ===');
  for (const c of s.channels) {
    console.log(`  ${c.padEnd(12)} ${String(s.byChannel[c] || 0).padStart(4)} total   ${s.sentToday[c]}/${DAILY_CAPS[c]} sent today`);
  }

  console.log('\n=== MRR vs goal ===');
  console.log(`  $${s.mrr}/mo from ${s.won} won deals  ->  goal $${GOAL.mrrTarget}/mo (${GOAL.customersNeeded} customers @ $${GOAL.pricePerCustomer}/mo)`);
  console.log(`  ${s.customersRemaining} customers still needed, ${s.daysLeft} days left until ${GOAL.deadline}`);
}

async function main() {
  const [, , cmd, ...rest] = process.argv;
  switch (cmd) {
    case 'source': return cmdSource(rest[0]);
    case 'import': return cmdImport(rest[0], rest.slice(1));
    case 'queue': return cmdQueue();
    case 'mark': return cmdMark(rest[0], rest[1]);
    case 'status': return cmdStatus();
    case 'dashboard': return import('./dashboard.js');
    default: return usage();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
