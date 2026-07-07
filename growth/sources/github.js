// Method 5: GitHub repo/contributor tracking.
// Uses the public GitHub REST API (https://docs.github.com/en/rest) — no
// scraping. Deliberately only reads each contributor's *public profile
// fields* (blog/website, X/Twitter handle) and never harvests commit
// author emails: GitHub's Acceptable Use Policies bar using data pulled
// from the service to send unsolicited outreach, and commit emails are
// exactly that. Linked profile links are the person's own chosen public
// contact surface, which is what the outreach method actually calls for
// ("locate their linked websites or personal professional profiles").

import { addLead } from '../lib/store.js';
import { GITHUB_TOPICS } from '../config.js';

const API = 'https://api.github.com';

function headers() {
  const h = { Accept: 'application/vnd.github+json', 'User-Agent': 'auditready-growth-cli' };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

async function ghFetch(path) {
  const res = await fetch(`${API}${path}`, { headers: headers() });
  if (res.status === 403) {
    const remaining = res.headers.get('x-ratelimit-remaining');
    throw new Error(`GitHub API rate-limited (remaining=${remaining}). Set GITHUB_TOKEN to raise the limit.`);
  }
  if (!res.ok) throw new Error(`GitHub API ${path} failed: ${res.status}`);
  return res.json();
}

async function searchRepos(topic, { pushedAfter }) {
  const q = encodeURIComponent(`topic:${topic} pushed:>${pushedAfter} archived:false`);
  const data = await ghFetch(`/search/repositories?q=${q}&sort=updated&order=desc&per_page=15`);
  return data.items || [];
}

async function topContributors(owner, repo) {
  try {
    return await ghFetch(`/repos/${owner}/${repo}/contributors?per_page=5`);
  } catch {
    return [];
  }
}

async function userProfile(login) {
  return ghFetch(`/users/${login}`);
}

export function pickContact(profile) {
  if (profile.blog) {
    const url = /^https?:\/\//i.test(profile.blog) ? profile.blog : `https://${profile.blog}`;
    return url;
  }
  if (profile.twitter_username) return `https://x.com/${profile.twitter_username}`;
  return `https://github.com/${profile.login}`;
}

export async function ingestGitHub({ topics = GITHUB_TOPICS, lookbackDays = 30, maxRepos = 5 } = {}) {
  const pushedAfter = new Date(Date.now() - lookbackDays * 86400000).toISOString().slice(0, 10);
  const results = { scanned: 0, added: 0, duplicates: 0, leads: [] };
  const seenLogins = new Set();

  for (const topic of topics) {
    let repos = [];
    try { repos = await searchRepos(topic, { pushedAfter }); } catch (e) { console.error(`[github] ${topic}: ${e.message}`); continue; }

    for (const repo of repos.slice(0, maxRepos)) {
      if (repo.fork) continue;
      results.scanned += 1;
      const contributors = await topContributors(repo.owner.login, repo.name);

      for (const c of contributors.slice(0, 2)) {
        if (!c.login || c.type === 'Bot' || c.login.endsWith('[bot]') || seenLogins.has(c.login)) continue;
        seenLogins.add(c.login);

        let profile;
        try { profile = await userProfile(c.login); } catch { continue; }
        if (profile.type !== 'User') continue;

        const contact = pickContact(profile);
        const { created, id } = await addLead({
          channel: 'github',
          name: profile.name || profile.login,
          company: profile.company || repo.full_name,
          contact,
          note: `${repo.full_name} (${repo.description || 'no description'}) — topic:${topic}`,
        });
        if (created) { results.added += 1; results.leads.push({ id, name: profile.name || profile.login, contact, repo: repo.full_name }); }
        else results.duplicates += 1;
      }
    }
  }
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ingestGitHub().then(r => {
    console.log(`Scanned ${r.scanned} repos, ${r.added} new leads added (${r.duplicates} already known).`);
    for (const l of r.leads) console.log(`  + [${l.id}] ${l.name} <${l.contact}> — ${l.repo}`);
  }).catch(e => { console.error(e); process.exit(1); });
}
