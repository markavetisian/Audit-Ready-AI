// Central knobs for the growth/outreach system. Edit these, not the source files.

export const GOAL = {
  mrrTarget: 10000,        // $/mo
  pricePerCustomer: 500,   // Starter plan — the realistic first-sale price for cold leads
  get customersNeeded() { return Math.ceil(this.mrrTarget / this.pricePerCustomer); },
  deadline: '2026-09-22',  // end of summer (northern hemisphere equinox)
};

// Per-channel daily send caps. Kept deliberately low on the channels where
// bulk/automated sending gets you banned (X, LinkedIn).
export const DAILY_CAPS = {
  x: 10,
  linkedin: 8,
  producthunt: 5,
  github: 10,
};

export const HEADCOUNT_HINTS = [
  'seed', 'series a', 'small team', 'early stage', 'startup', 'yc ', 'y combinator',
];

// No email channels (HN hiring-thread, Apollo) — outreach here is DM/social
// only, by design, to stay off CAN-SPAM/email-compliance risk entirely.
export const CHANNELS = ['x', 'linkedin', 'producthunt', 'github'];

// GitHub topic slugs to search for candidate B2B repos (method 5).
export const GITHUB_TOPICS = ['saas', 'b2b-saas', 'devtools', 'api-platform', 'fintech', 'healthtech'];

export const SENDER = {
  name: 'Vlad Avetisian',
  site: 'auditready.space',
};
