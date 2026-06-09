# zk-flow workflow sources

Workflow sources are built by `build.js` into `.claude/workflows/*.js`.

- `*.src.js` = source of truth. Never edit generated `.claude/workflows/*.js` directly.
- `// @@USE: frag1,frag2,...` at the top declares which fragments to inline.
- `// @@FRAGMENTS@@` marks the injection point inside the source.
- `build.js` strips `export` from fragments before inlining — no imports needed at runtime.
- Run `npm run build` (or `npm install`) to regenerate after any source change.
- Workflow JS runs inside Claude Code's `/workflows` runtime; no Node module system available.
