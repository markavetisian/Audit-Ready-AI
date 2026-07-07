// Central knobs for the growth/outreach system. Edit these, not the source files.

export const GOAL = {
  mrrTarget: 10000,        // $/mo
  pricePerCustomer: 250,   // matches the $250/mo plan on auditready.space
  get customersNeeded() { return Math.ceil(this.mrrTarget / this.pricePerCustomer); },
  deadline: '2026-09-22',  // end of summer (northern hemisphere equinox)
};

// Per-channel daily send caps. Kept deliberately low on the channels where
// bulk/automated sending gets you banned (X, LinkedIn) or burns a domain's
// email reputation (Apollo). HN is event-based (one thread/month), not capped.
export const DAILY_CAPS = {
  x: 10,
  linkedin: 8,
  hn: 50,
  producthunt: 5,
  github: 10,
  apollo: 5,
};

// Keywords used to filter HN "who is hiring" listings and GitHub repo search
// toward companies likely to hit SOC 2 / security-questionnaire friction soon.
export const TARGET_KEYWORDS = [
  'soc 2', 'soc2', 'security questionnaire', 'compliance', 'infosec',
  'fintech', 'healthtech', 'hipaa', 'devtools', 'saas', 'b2b', 'api platform',
  'data platform', 'ai infra', 'llm infra', 'identity', 'iam',
];

export const HEADCOUNT_HINTS = [
  'seed', 'series a', 'small team', 'early stage', 'startup', 'yc ', 'y combinator',
];

export const CHANNELS = ['x', 'linkedin', 'hn', 'producthunt', 'github', 'apollo'];

// GitHub topic slugs to search for candidate B2B repos (method 5).
export const GITHUB_TOPICS = ['saas', 'b2b-saas', 'devtools', 'api-platform', 'fintech', 'healthtech'];

export const SENDER = {
  name: 'Vlad Avetisian',
  site: 'auditready.space',
};
