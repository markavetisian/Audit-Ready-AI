// Method 3: HN "Ask HN: Who is hiring?" thread.
// Uses the public HN Algolia Search API (no auth, no scraping, no ToS issue —
// https://hn.algolia.com/api). Finds the current month's thread, reads the
// top-level job postings, and keeps the ones that mention our target
// keywords AND list a direct contact email in the post body.

import { addLead } from '../lib/store.js';
import { TARGET_KEYWORDS } from '../config.js';

const ALGOLIA_BASE = 'https://hn.algolia.com/api/v1';

export function stripHtml(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#x2F;/g, '/')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractEmails(text) {
  const matches = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || [];
  return [...new Set(matches)].filter(e => !/\.(png|jpg|gif)$/i.test(e));
}

export function guessCompany(text) {
  const head = text.slice(0, 120);
  const seg = head.split(/[|–—-]/)[0].trim();
  return seg.slice(0, 60) || 'Unknown';
}

export function matchesKeywords(text) {
  const lower = text.toLowerCase();
  return TARGET_KEYWORDS.filter(k => lower.includes(k));
}

async function findLatestHiringThread() {
  const url = `${ALGOLIA_BASE}/search_by_date?tags=story,author_whoishiring&hitsPerPage=20`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Algolia search failed: ${res.status}`);
  const data = await res.json();
  const thread = data.hits.find(h => /who is hiring/i.test(h.title || ''));
  if (!thread) throw new Error('Could not find a "Who is hiring?" thread');
  return thread;
}

async function fetchTopLevelComments(storyId) {
  const comments = [];
  let page = 0;
  while (page < 5) {
    const url = `${ALGOLIA_BASE}/search_by_date?tags=comment,story_${storyId}&hitsPerPage=1000&page=${page}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Algolia comments fetch failed: ${res.status}`);
    const data = await res.json();
    comments.push(...data.hits);
    page += 1;
    if (page >= data.nbPages) break;
  }
  return comments.filter(c => String(c.parent_id) === String(storyId) && c.comment_text);
}

export async function ingestHN({ limit = 200 } = {}) {
  const thread = await findLatestHiringThread();
  const rawComments = await fetchTopLevelComments(thread.objectID);

  const results = { threadTitle: thread.title, threadUrl: `https://news.ycombinator.com/item?id=${thread.objectID}`,
    scanned: rawComments.length, matched: 0, added: 0, duplicates: 0, leads: [] };

  for (const c of rawComments.slice(0, limit)) {
    const text = stripHtml(c.comment_text);
    const keywords = matchesKeywords(text);
    const emails = extractEmails(text);
    if (keywords.length === 0 || emails.length === 0) continue;

    results.matched += 1;
    const contact = emails[0];
    const company = guessCompany(text);
    const { created, id } = await addLead({
      channel: 'hn',
      name: '',
      company,
      contact,
      note: `matched: ${keywords.join(', ')} | ${text.slice(0, 200)}`,
    });
    if (created) { results.added += 1; results.leads.push({ id, company, contact }); }
    else results.duplicates += 1;
  }
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ingestHN().then(r => {
    console.log(`Thread: ${r.threadTitle}\n${r.threadUrl}`);
    console.log(`Scanned ${r.scanned} postings, ${r.matched} matched keywords, ${r.added} new leads added (${r.duplicates} already known).`);
    for (const l of r.leads) console.log(`  + [${l.id}] ${l.company} <${l.contact}>`);
  }).catch(e => { console.error(e); process.exit(1); });
}
