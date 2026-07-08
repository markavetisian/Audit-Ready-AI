// Methods 1 and 2 (X, LinkedIn) and manual Product Hunt/Peerlist follow-ups.
// No email channels here by design — X search and LinkedIn groups have no
// public API for this anyway, so it's a CSV import: you browse the target
// list by hand, save what you find, and this loads it into the same
// tracker/queue as the automated sources.

import { readFileSync } from 'node:fs';
import { addLead } from '../lib/store.js';
import { CHANNELS } from '../config.js';

export function parseCsv(text) {
  const lines = text.split('\n').map(l => l.trimEnd()).filter(l => l.trim().length > 0);
  if (lines.length === 0) return [];
  const header = splitCsvLine(lines[0]).map(h => h.trim().toLowerCase());
  return lines.slice(1).map(line => {
    const cells = splitCsvLine(line);
    const row = {};
    header.forEach((h, i) => { row[h] = (cells[i] || '').trim(); });
    return row;
  });
}

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else cur += ch;
    } else if (ch === '"') { inQuotes = true; }
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// CSV columns: channel,name,company,contact,note
// `channel` per-row, or pass `defaultChannel` to fill blanks / support
// single-channel exports (e.g. an Apollo CSV export with no channel column).
export async function importCsv(path, { defaultChannel } = {}) {
  const text = readFileSync(path, 'utf8');
  const rows = parseCsv(text);
  const results = { scanned: rows.length, added: 0, duplicates: 0, skipped: 0, leads: [] };

  for (const row of rows) {
    const channel = (row.channel || defaultChannel || '').toLowerCase();
    const contact = row.contact || row.email || row.handle || row.url || '';
    if (!CHANNELS.includes(channel) || !contact) { results.skipped += 1; continue; }

    const { created, id } = await addLead({
      channel, name: row.name || '', company: row.company || '', contact, note: row.note || '',
    });
    if (created) { results.added += 1; results.leads.push({ id, channel, contact }); }
    else results.duplicates += 1;
  }
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , path, ...flags] = process.argv;
  if (!path) {
    console.error('Usage: node growth/sources/import.js <csv-path> [--channel <x|linkedin|producthunt|github>]');
    process.exit(1);
  }
  const channelFlagIdx = flags.indexOf('--channel');
  const defaultChannel = channelFlagIdx !== -1 ? flags[channelFlagIdx + 1] : undefined;
  importCsv(path, { defaultChannel }).then(r => {
    console.log(`Scanned ${r.scanned} rows, ${r.added} new leads added (${r.duplicates} already known, ${r.skipped} skipped — bad channel/contact).`);
    for (const l of r.leads) console.log(`  + [${l.id}] ${l.channel} <${l.contact}>`);
  }).catch(e => { console.error(e); process.exit(1); });
}
