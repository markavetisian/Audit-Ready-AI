# Growth / outreach system

Operationalizes the 6 lead channels (X, LinkedIn, HN hiring thread, Product
Hunt/Peerlist, GitHub, Apollo) into one lead tracker with daily send caps and
per-channel message drafts, tracked toward the $10k MRR / $250-per-customer
(40 customers) goal by 2026-09-22 — see `config.js`.

## Why some channels are automated and some aren't

Two channels have legitimate public APIs that are fine to hit programmatically:

- **HN "Who is hiring?"** — `sources/hn.js`, via the public HN Algolia API.
- **GitHub** — `sources/github.js`, via the public GitHub REST API. It only
  reads each contributor's public profile fields (blog/website, X handle) —
  it deliberately never harvests commit-author emails, since GitHub's
  Acceptable Use Policies bar using data pulled from the service to send
  unsolicited outreach.
- **Product Hunt** — `sources/producthunt.js`, via PH's official GraphQL API,
  if you set `PRODUCTHUNT_TOKEN` (free, from
  https://api.producthunt.com/v2/oauth/applications). Skipped otherwise.

**X, LinkedIn, and Apollo are intentionally manual-import, not bots.**
X has no public search API for this, LinkedIn scraping/auto-DM breaks their
ToS and gets accounts banned, and Apollo's own method here calls for
low-volume, hand-typed sends specifically to avoid spam detection — automating
that defeats the point. So: browse those platforms by hand exactly as the
method describes, drop what you find into a CSV
(`leads-import-template.csv`), and run `import`. Same tracker, same queue,
same caps — the only difference is a human did the finding and will do the
sending, which is also what keeps this out of the same legal/ToS trouble
mass cold email caused before.

## Setup

Needs the same Upstash Redis the main app uses. Either export the vars or
drop them in a repo-root `.env.local` (gitignored):

```
KV_REST_API_URL=...
KV_REST_API_TOKEN=...
# optional, raises GitHub rate limits from 60/hr to 5000/hr
GITHUB_TOKEN=...
# optional, enables the Product Hunt source
PRODUCTHUNT_TOKEN=...
```

## Daily workflow

```
# 1. Pull in new leads from the automated sources
node growth/cli.js source hn            # once a month when the thread posts
node growth/cli.js source github
node growth/cli.js source producthunt

# 2. Import whatever you hand-collected from X / LinkedIn / Apollo today
node growth/cli.js import my-x-leads.csv --channel x
node growth/cli.js import my-linkedin-leads.csv --channel linkedin
node growth/cli.js import apollo-export.csv --channel apollo

# 3. Build today's capped, drafted outreach batch
node growth/cli.js queue
# -> writes growth/out/queue-<date>.md with ready-to-paste drafts,
#    grouped by channel, capped per config.js DAILY_CAPS

# 4. Actually send them by hand from the real platform/inbox, then:
node growth/cli.js mark <id> contacted
node growth/cli.js mark <id> replied
node growth/cli.js mark <id> won        # closes into the MRR number

# 5. Check where you stand
node growth/cli.js status
```

## Dashboard

`node growth/cli.js dashboard` (or `npm run growth:dashboard`) starts a local
web UI at `http://127.0.0.1:4173` — same data, click-through instead of CLI
commands: MRR progress bar, per-channel cards with a "fetch new leads" button
for hn/github/producthunt, a "build today's queue" button, and a lead table
with status dropdowns and drafted-message previews.

It's a plain `node:http` server bound to `127.0.0.1` only (not `0.0.0.0`) —
there's no auth layer, and lead contact info is PII, so it's built to run on
your own machine, not to be exposed on a network.

`growth/out/` (drafts) and `.env.local` (secrets) are gitignored — this repo
is the product's source, not a place to keep leads' contact info or your
Redis token.

## Daily caps

Set in `config.js` `DAILY_CAPS`. Defaults mirror what the methods themselves
specify (Apollo capped at 5/day, LinkedIn/X kept low to look human, HN/GitHub
higher since a monthly thread and repo contributors are naturally bounded).
`queue` won't exceed these even if there are more "new" leads sitting in the
tracker — it just leaves them for tomorrow.

## Known limitation

The HN and GitHub sources need normal outbound internet access. If you're
running this from a sandboxed Claude Code Remote session with a locked-down
network policy, those `fetch` calls will be blocked — run `source` from your
own machine, a GitHub Action, or a Vercel cron instead. The parsing/matching
logic itself doesn't depend on network access and I unit-tested it directly.
