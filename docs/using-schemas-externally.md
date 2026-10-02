# Using zk-flow schemas outside the /workflows runtime

## The problem

The `schema:` field on an `agent()` call is enforced by the `/workflows` runtime -- it
validates the agent's final JSON message against the named schema before the workflow
proceeds. When you dispatch a subagent via the plain **Agent tool** (outside a saved workflow),
that contract is not enforced. The agent can emit any JSON -- or none at all -- and nothing
stops the downstream consumer from using a malformed payload.

## What to do

When dispatching a zk-flow-compatible agent outside the `/workflows` runtime:

**Step 1: Paste the schema contract into the prompt.**

Read the relevant `schemas/<name>.json` and include it verbatim in the agent's system prompt
or user message. Tell the agent: "Your final message must be a JSON object matching this
schema exactly." This gives the agent the contract as a hard instruction.

**Step 2: Run the `schema-validator` agent on the output.**

After the dispatched agent responds, send its output to the `schema-validator` agent:

```
Agent: schema-validator
Prompt: Schema name: research
Payload: <paste the agent's JSON output here>
```

The `schema-validator` reads `schemas/research.json`, validates the payload, and emits:

```json
{"valid": true, "errors": []}
```

or

```json
{
  "valid": false,
  "errors": [
    {"path": "key_findings[0].evidence_quality", "problem": "value 'ok' not in enum [strong, adequate, weak]"}
  ]
}
```

If `valid` is false, correct the payload (or re-run the agent with the errors as feedback)
before using it downstream.

## The 8 schemas

| Schema name | File | Used for |
|---|---|---|
| `research` | `schemas/research.json` | Research phase output: key findings with evidence, selected skills, search coverage across 5 sources, overall evidence quality |
| `design` | `schemas/design.json` | Design phase output: SQCA format (Summary, Questions, Context, Approach), questions raised, proposed approach |
| `implementation` | `schemas/implementation.json` | Impl phase output: files changed, commits made, tests run/passed/failed, approach rationale |
| `review` | `schemas/review.json` | Grade gate verdict: `APPROVE`/`REQUEST_CHANGES`/`BLOCK`, weighted score 0-1, findings with severity/owner/autofix_class |
| `testing` | `schemas/testing.json` | Testing phase output: smoke command, exit code, scenarios exercised |
| `discover` | `schemas/discover.json` | Discover phase output: skills to load, vault paths, related bead IDs, rationale |
| `proposal` | `schemas/proposal.json` | Improve workflow: proposed change with rationale and scope |
| `solution` | `schemas/solution.json` | Improve workflow: verified solution with evidence |

See `schemas/` for the full JSON Schema definitions including all required fields, enums, and
constraints.

## Why inline schemas exist in some workflows

Simple single-shot phases (like the `dashboard` workflow's Fetch/Verify) use inline schemas
directly in the workflow body rather than referencing `schemas/*.json`. These inline schemas
carry no `verdict` field and are intentionally minimal -- the workflow checks one boolean
(`fetched`, `verified`) and escalates on false. There is no `schema-validator` entry for
these inline schemas because they are workflow-internal and not designed for external
dispatch.

The 8 named schemas above are the shared contracts that cross workflow/agent/session
boundaries and are worth validating externally.

## Related

- [docs/architecture.md](architecture.md) -- full five-layer breakdown, schema validation
  contract across seams
- [docs/workflows/README.md](workflows/README.md) -- per-workflow schema summary
