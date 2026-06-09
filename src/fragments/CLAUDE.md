# zk-flow fragments

Fragments are pure JS modules inlined at build time into workflow bundles.

- No `import` statements — everything must be self-contained.
- Use `export` for functions/constants; `build.js` strips `export` before inlining.
- Every workflow `.src.js` that uses these must include `// @@USE: <name>,...` at the top and `// @@FRAGMENTS@@` where inlining occurs.
- Edit source here (`src/fragments/*.js`), never in generated `.claude/workflows/*.js`.
- Run `npm run build` after changes to regenerate workflow bundles.
