---
path: src/workflows/**/*.src.js
---
Workflow source files — built by build.js into .claude/workflows/*.js.
- `// @@USE: frag1,frag2,...` at top declares fragments to inline
- `// @@FRAGMENTS@@` marker is required — marks injection point
- `export const meta = {...}` required at top
- NEVER edit generated .claude/workflows/*.js — edit src/workflows/*.src.js
- After editing, run `npm run build` + `npm test`
