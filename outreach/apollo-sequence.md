# Audit Ready AI — Apollo cold email sequence

A 3-step sequence for the 11 SOC 2 prospects in `apollo-contacts.csv`.
One template set, personalized per contact through the `hook` custom field.

## Before you send — two things you must do

1. **Fill your mailing address** in the signature block below (CAN-SPAM requires a
   real physical postal address on every commercial email — a home address, office,
   USPS PO box, or virtual mailbox all count). It appears in all 3 steps.
2. **Leave Apollo's unsubscribe link on.** Apollo appends a compliant one-click
   unsubscribe automatically — do not turn it off. That plus the address makes the
   whole sequence CAN-SPAM clean, so the manual "reply no" line is a courtesy, not
   the legal mechanism.

---

## Step 1 — Day 0 (new thread)

**Subject:** `{{company}} + SOC 2`

```
Hi {{first_name}} — {{hook}}

I built Audit Ready AI for exactly this. You connect your stack and in about
10 minutes you get a real readiness score across all 49 SOC 2 controls, an
ordered fix list, and the policy docs reviewers ask for. Free to run, and it's
you clicking through it, not a sales call.

Want to see where {{company}} actually lands? Reply "score" and I'll send the link.

Vlad Avetisian
Founder, Audit Ready AI
auditready.space
[YOUR MAILING ADDRESS]
```

---

## Step 2 — Day 3 (reply on the same thread)

**Subject:** `Re: {{company}} + SOC 2` *(Apollo: set this step to "reply to previous email")*

```
Hi {{first_name}} — quick bump in case this slipped.

Even if SOC 2 isn't urgent this quarter, the score is free and takes about 10
minutes, and it tells you exactly where {{company}} stands before a buyer's
security team asks. Better to know now than mid-deal.

Want the link?

Vlad
Audit Ready AI · auditready.space
[YOUR MAILING ADDRESS]
```

---

## Step 3 — Day 7 (reply on the same thread, breakup)

**Subject:** `Re: {{company}} + SOC 2`

```
Hi {{first_name}} — last one from me, I'll leave it here.

If SOC 2 comes up in a deal down the line, the readiness check is free whenever
you want it: auditready.space. No follow-ups from me after this.

Vlad
Audit Ready AI · auditready.space
[YOUR MAILING ADDRESS]
```

---

## How to load this into Apollo

1. **Import contacts** → Apollo → *Contacts* → *Import CSV* → upload
   `apollo-contacts.csv`. Map `first_name`, `email`, and `company` to their
   standard fields.
2. **Map the hook** → on the `hook` column choose *Create custom field* →
   name it exactly `hook` (type: text). Finish import.
3. **Build the sequence** → *Sequences* → *New sequence* → add 3 "Automatic email"
   steps at delays **0 / 3 / 7 days**. Paste each step above. Set steps 2 and 3 to
   **"Send as reply to previous email"** so they thread.
4. **Insert variables** with Apollo's `{{ }}` picker: `{{first_name}}`,
   `{{company}}`, and your custom `{{hook}}`. Type the mailing address in directly.
5. **Connect your mailbox** and confirm SPF + DKIM are green in Apollo's mailbox
   settings (deliverability — skip this and you land in spam).
6. **Add all 11 contacts** to the sequence and launch.

## Deliverability guardrails (so 11 emails don't torch your domain)

- Keep daily volume low while the domain is young. 11 leads is fine; don't blast
  hundreds from a fresh domain.
- Consider sending from a **secondary domain** (e.g. `try-auditready.space`) so a
  spam hit never damages your primary `auditready.space` deliverability.
- **Turn OFF open tracking** for this small batch. The tracking pixel rewrites your
  links and hurts inbox placement; with 11 leads you don't need the open data.
- Plain text, no images, one link max. You're already there.

## Not legal advice

Standard CAN-SPAM playbook, not a lawyer's opinion. The hard lines: real address on
every send, working unsubscribe, honor opt-outs within 10 business days, no
misleading subject or From.
