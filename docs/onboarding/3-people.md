---
name: onboard-3-people
description: Person enrichment phase — build real person skills from GitHub PR history, Slack communication patterns, Linear tickets, and Notion docs. Stubs created during machine setup get replaced with evidence-backed profiles. Run after Phase 2 (skills layer complete).
---

# Phase 3 — People

Person skills created during onboarding are stubs — they list who people are, not how they actually think, write, and review code. A stub has ~50 lines from 1:1 notes. A real person skill has 150–250 lines from GitHub PRs, Slack messages, and Linear tickets.

This phase replaces stubs with evidence.

---

## Enrichment Trigger

A person skill needs enrichment when:
- It was created from 1:1 notes only (no GitHub/Slack research)
- It's been 6+ months since last update
- The person has changed teams or domains
- The skill has fewer than 100 lines

Run this phase on every person listed in `persona.md` People section before starting real work.

---

## Buddy Rule

**The buddy is always the highest-priority person skill. Do them first, do them deepest.**

Whoever you will pair with, get reviewed by, or report to most often on this machine — that person gets a full enrichment pass before anyone else. A shallow buddy skill is the single biggest gap between a stub agent and a useful one.

> If your organization uses Jira, start by pulling the buddy's assigned and recently closed issues from the relevant board. Jira tickets reveal problem scope, escalation patterns, and ownership boundaries — rich signal for the mental model section.

---

## Dispatch Pattern: Parallel Agents

Don't enrich people serially. Run one agent per person concurrently:

```
Agent 1 → Enrich <buddy-name>        # your primary pairing partner
Agent 2 → Enrich <person-2>         # frequent reviewer
Agent 3 → Enrich <person-3>         # team lead / manager
Agent 4 → Enrich <person-4>         # cross-team stakeholder
...
```

Each agent follows the full research methodology below independently. Results are written to `skills/agent/machines/<hostname>/people/<name>.md`.

---

## Research Methodology

Full methodology: `skills/general/practices/person-research/SKILL.md`

Summary of the four research phases:

### Phase 1 — GitHub: Code Patterns and Review Philosophy

This is the richest signal. Pull PRs they authored and review comments they left.

```bash
# PRs they authored
gh pr list --repo <org>/<repo> --author <github-handle> --state all --limit 50

# Review comments they left (reveals what they flag, what they let pass, tone)
gh api "repos/<org>/<repo>/pulls/comments?per_page=100" \
  | jq '.[] | select(.user.login == "<handle>") | {body: .body, url: .html_url}'

# Files they touch most (reveals ownership)
gh pr list --repo <org>/<repo> --author <handle> --state merged --limit 20 --json number \
  | jq '.[].number' \
  | xargs -I{} gh pr view {} --json files --jq '.files[].path' \
  | sort | uniq -c | sort -rn | head -20
```

**Extract:**
- 3–5 exact quotes from their review comments that reveal what they block vs discuss vs ignore
- PR size and decomposition patterns
- What files/components they consistently own

### Phase 2 — Slack: Communication Style and Working Patterns

```
Slack MCP: search "from:<Full Name> in:#project-v3-implementation"
Slack MCP: search "from:<Full Name>" with keywords: code review, debugging, design, incident
```

**Extract:**
- Tone (casual/formal, question-first/answer-first)
- Resolution preference (call vs thread for complex topics)
- Update style (proactive vs responsive)
- Timezone and availability pattern

### Phase 3 — Linear: How They Think About Problems

```
Linear MCP: list_issues with assignee filter
Linear MCP: list_issues with creator filter
```

**Extract:**
- Level of detail in ticket writing
- Whether they think in phases/milestones or just tasks
- What they escalate vs handle themselves
- Which domains they consistently own

### Phase 4 — Notion: How They Document

```
Notion MCP: search for their name as author
```

**Extract:**
- Long-form design docs vs short tactical notes
- How they communicate ambiguity vs certainty

---

## Synthesis: Writing the Person Skill

Use `skills/agent/scaffolding/person-skill.md` as the structure. Every claim must trace to a real source.

**Required sections:**

1. **Mental model** (2–3 sentences): What lens do they apply? What's their first question when reading code? Derived from review comments and Slack behavior — not job title.

2. **Code patterns they write**: Direct examples from their PRs. Quoted or paraphrased from real commits, not invented.

3. **Review philosophy:**
   - **What they BLOCK**: Issues explicitly flagged as blocking in real reviews (quote them)
   - **What they DISCUSS**: Softer concerns they raise but don't block on
   - **What they IGNORE**: Things they consistently don't flag (inferred from absence)

4. **Comment style**: Real examples of how they write review comments — tone, format, level of detail.

5. **Slack / working patterns**: How to best collaborate with them.

6. **Sources**: Link every claim back to a real PR, thread, or message. Keep URLs.

---

## Quality Bar

A good person skill answers these questions without ambiguity:

| Question | Source |
|----------|--------|
| What would they block in a PR review? | GitHub review comments |
| What's their communication style in async channels? | Slack message patterns |
| When should you ping them vs wait for async review? | Slack availability + working style |
| What do they own — where do their PRs cluster? | GitHub file-touch analysis |
| What does a bad PR look like to them? | Exact quotes from blocking reviews |
| How do they debug vs how do they design? | Mix of Slack threads + PR descriptions |

---

## Common Mistakes

- **Making up patterns from job title**: "As a platform engineer, they probably care about performance" — not evidence
- **Treating meeting notes as deep signal**: 1:1 notes capture context but not behavior under pressure
- **Stopping at Phase 1**: GitHub alone misses communication style. The best signal on how someone gives feedback is in their Slack messages, not their review comments
- **Skipping the Sources section**: Without sources, the skill can't be audited or updated when stale

---

## Ongoing Enrichment

Person skills are never "done." Update them after:
- Code reviews where they leave unexpected feedback
- Incidents where you see how they work under pressure
- Pairing sessions
- When they change teams or domains

The goal is: could an agent review a PR the way this person would, without them in the room?

---

## Result

After this phase:
- Every person in `persona.md` People section has a skill file at `skills/agent/machines/<hostname>/people/<name>.md`
- Each skill has 150–250 lines backed by real GitHub/Slack/Linear evidence
- The buddy has the deepest enrichment
- Source URLs are recorded in each skill

**Next phase:** `onboard/4-tribal` — cross-repo dependencies, deploy process, PR conventions, branch rules.
