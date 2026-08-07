---
path: src/workflows/**/*.src.js
---
Workflow source files — built by build.js into .claude/workflows/*.js.
- `// @@USE: frag1,frag2,...` at top declares fragments to inline
- `// @@FRAGMENTS@@` marker is required — marks injection point
- `export const meta = {...}` required at top
- NEVER edit generated .claude/workflows/*.js — edit src/workflows/*.src.js
- After editing, run `npm run build` + `npm test`
- EVERY `key=value` arg a workflow reads off `a` must be listed in `CONTROL_KEYS`
  (`src/fragments/args.js`). A key that is missing is NOT a parse error — the token
  lands in `a._` and the workflow runs on its default. /vault-sync shipped with
  `dryRun` absent from the list and its first live run wrote to the vault with
  `dryRun=true` set. Add the key, and for a workflow that mutates anything, fail
  closed on an unrecognized flag rather than proceeding on defaults.

