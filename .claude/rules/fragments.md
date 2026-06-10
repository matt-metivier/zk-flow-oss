---
path: src/fragments/**/*.js
---
Fragment files are inlined at build time into workflow bundles.
- NO `import` statements — must be self-contained
- Use `export function`/`export const` — build.js strips `export` before inlining
- Every function must work without module system (no require, no import)
- After editing any fragment, run `npm run build` to verify it inlines cleanly
