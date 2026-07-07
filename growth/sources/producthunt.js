// Method 4 (Product Hunt half): today's B2B SaaS launches.
// Uses Product Hunt's official GraphQL API (https://api.producthunt.com/v2/docs).
// Requires a free developer token: create one at
// https://api.producthunt.com/v2/oauth/applications and set PRODUCTHUNT_TOKEN.
// Without a token this source is skipped rather than scraping the site.

import { addLead } from '../lib/store.js';

const ENDPOINT = 'https://api.producthunt.com/v2/api/graphql';

const QUERY = `
  query TodaysPosts($after: DateTime!) {
    posts(order: RANKING, postedAfter: $after, first: 20) {
      edges {
        node {
          id
          name
          tagline
          website
          url
          makers { name username twitterUsername websiteUrl }
        }
      }
    }
  }
`;

export async function ingestProductHunt({ limit = 10 } = {}) {
  const token = process.env.PRODUCTHUNT_TOKEN;
  if (!token) {
    return { skipped: true, reason: 'PRODUCTHUNT_TOKEN not set — get one at https://api.producthunt.com/v2/oauth/applications', added: 0, duplicates: 0, leads: [] };
  }

  const after = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query: QUERY, variables: { after } }),
  });
  if (!res.ok) throw new Error(`Product Hunt API failed: ${res.status}`);
  const data = await res.json();
  if (data.errors) throw new Error(`Product Hunt API error: ${JSON.stringify(data.errors)}`);

  const posts = (data.data?.posts?.edges || []).map(e => e.node);
  const results = { scanned: posts.length, added: 0, duplicates: 0, leads: [] };

  for (const post of posts.slice(0, limit)) {
    for (const maker of post.makers || []) {
      const contact = maker.websiteUrl
        || (maker.twitterUsername ? `https://x.com/${maker.twitterUsername}` : null)
        || (maker.username ? `https://www.producthunt.com/@${maker.username}` : null);
      if (!contact) continue;

      const { created, id } = await addLead({
        channel: 'producthunt',
        name: maker.name || maker.username || '',
        company: post.name,
        contact,
        note: `Launched today: ${post.name} — ${post.tagline} (${post.url})`,
      });
      if (created) { results.added += 1; results.leads.push({ id, name: maker.name, contact, product: post.name }); }
      else results.duplicates += 1;
    }
  }
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ingestProductHunt().then(r => {
    if (r.skipped) { console.log(`[producthunt] skipped: ${r.reason}`); return; }
    console.log(`Scanned ${r.scanned} launches, ${r.added} new leads added (${r.duplicates} already known).`);
    for (const l of r.leads) console.log(`  + [${l.id}] ${l.name} <${l.contact}> — ${l.product}`);
  }).catch(e => { console.error(e); process.exit(1); });
}
