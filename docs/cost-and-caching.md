# Cost & prompt-cache economics

zk-flow spawns many subagents per run (`agent(prompt, {agentType, model, schema})`). Input
tokens dominate cost, and the Anthropic **prompt cache** is the biggest lever on it. This doc
captures how caching interacts with zk-flow's architecture and where the wins are.

## The economics (Opus 4.8, indicative)
- Base input ≈ `$5/MTok`. Cache **hit** (read) ≈ `$0.50/MTok` (**10%** of base). 5-min cache
  **write** ≈ `$6.25/MTok` (**125%** of base). So a miss-that-writes is ≈ **12.5×** a hit.
- A high hit-rate can turn a ~$100 session into ~$20. Hit rate is the single biggest cost knob.
- Cache matches by **exact prefix hash from byte 0**; any earlier-byte change invalidates
  everything after it. TTL is 5 min (each hit resets it); idle >5 min = cold next turn.
- Caches are **per-model** and **per-process**. A subagent spawn is a separate process with its
  own cache; its only cross-spawn cacheable prefix is the **system prompt + tool definitions**
  (i.e. the `agentType` `.claude/agents/<name>.md` body + tools).

## What this means for zk-flow (levers, in priority order)
1. **Artifact volume is the dominant cost.** Workflows `JSON.stringify` whole artifacts
   (`design`, `research.out`, `implResult.out`, `reviewGrade`, full `gh pr diff`) into every
   perspective / grader / revision spawn. The artifact is genuinely variable, so it's a
   cache-write regardless of position — the cost is the **token count**. Win: pass **slices,
   diffs/deltas, or bead references** instead of whole blobs. Targets: `feature.src.js`,
   `src/fragments/run-phase.js` (`priorContext` + `JSON.stringify(out)` each iteration),
   `review.src.js`, `improve.src.js`.
2. **House byte-stable contract text in the agent system prompt, not the per-spawn user
   prompt.** The findings format ("severity P0-P3, file, line, why_it_matters"), the arbiter
   merge rule, and rubric contracts are identical across spawns — when they live in the
   `.claude/agents/*.md` body they're a cached prefix; when restated in the workflow's user
   prompt they're fresh tokens every spawn. (Most already live in the agents post-standardization;
   avoid re-stating them in workflow prompts.)
3. **Keep `agentType` system prompts byte-stable.** Anything that injects a timestamp, run-id,
   iteration counter, or nondeterministically-ordered skill text **into the system prompt** busts
   the one cross-spawn-cacheable prefix. Iteration number / prior feedback belong in the **user**
   prompt (where `run-phase.js` correctly puts them) — never the system prompt. Audit the
   skill-render path for deterministic ordering.
4. **TTL warmth.** `parallel()` fan-out (review/critique) reuses a warm same-`agentType` prefix.
   The `feature startAt=impl` human-approval seam goes cold (>5 min) by design — unavoidable.

## Measure before optimizing (do this first)
Capture `cache_read_input_tokens` + `cache_creation_input_tokens` per `agent()` call (CodeBurn,
or the run usage). Treat a zero cache-read on an expected hit as a failed health check. Confirm
writes dominate + where, THEN cut volume. Don't optimize blind.

## Structural idea (flag, not a quick win)
The `runPhase` / design / review revision loops spawn a **fresh subagent each iteration** over
largely-overlapping context (stable prior + growing feedback) — the cache's "fork" sweet spot.
Running an iteration loop as **multi-turn within one subagent** (append feedback as a new user
turn) would keep the prior prefix warm and pay only for the new turn. This fights the
schema-per-agent design and is a larger change — evaluate against measured data before adopting.

> Sources: Anthropic prompt-caching docs + "How Prompt Caching Actually Works in Claude Code"
> (claudecodecamp.com). The per-spawn cache-boundary behavior is standard Claude Code subagent
> behavior; instrument a real run to confirm breakpoint placement before relying on lever #2's exact magnitude.
