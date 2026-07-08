// Per-channel message drafts, matching the tone already used in
// outreach_emails.txt: one specific observation tied to their product/context,
// a one-line pitch, a low-friction ask, plain signature. No hype, no bullet
// lists, short enough to read on a phone. DM/social channels only — no
// email builders here.

function firstName(lead) {
  const n = (lead.name || '').trim();
  if (!n) return null;
  return n.split(' ')[0];
}

function x(lead) {
  const name = firstName(lead) || 'hey';
  const company = lead.company ? ` at ${lead.company}` : '';
  const body = `${name}, saw your post on SOC 2 / security review friction${company}. Built a tool that scores real readiness off your stack and writes the policy docs, way cheaper than Vanta/Drata. Free scan if it's useful — happy to just send it over.`;
  return { subject: '', body };
}

function linkedin(lead) {
  const name = firstName(lead) || 'hey';
  const company = lead.company ? ` at ${lead.company}` : '';
  const body = `${name}, fellow founder here — saw you in the group. Curious how you're handling SOC 2 / security questionnaires${company} as you scale. I built a compliance-mapping tool that scores real readiness and generates the policy docs; would genuinely value a quick gut-check from someone in your seat on whether it'd solve the procurement hurdle for you.`;
  return { subject: '', body };
}

function producthunt(lead) {
  const name = firstName(lead) || 'congrats';
  const company = lead.company || 'the launch';
  const body = `${name}, congrats on shipping ${company} — big day. Once the traction from this brings in bigger customers, the security questionnaire usually shows up fast. Built a tool that scores real SOC 2 readiness off your stack and writes the docs, cheap and fast. Free scan if useful, no pressure either way.`;
  return { subject: '', body };
}

function github(lead) {
  const name = firstName(lead) || 'hey';
  const repo = (lead.note || '').split('(')[0].trim() || 'your repo';
  const body = `${name}, came across ${repo} — nice work. On the security side: I built a tool that maps SOC 2 controls (branch protection, access reviews, the usual audit asks) to your actual stack and scores readiness automatically. Free to run if it's useful for where you're at.`;
  return { subject: '', body };
}

const BUILDERS = { x, linkedin, producthunt, github };

export function draftMessage(lead) {
  const builder = BUILDERS[lead.channel];
  if (!builder) throw new Error(`No template for channel: ${lead.channel}`);
  return builder(lead);
}
