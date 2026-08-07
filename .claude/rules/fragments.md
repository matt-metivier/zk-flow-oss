---
path: src/fragments/**/*.js
---
Fragment files are inlined at build time into workflow bundles.
- NO `import` statements — must be self-contained
- Use `export function`/`export const` — build.js strips `export` before inlining
- Every function must work without module system (no require, no import)
- After editing any fragment, run `npm run build` to verify it inlines cleanly

ONE documented import exception: build.js `stripFragmentImports` removes a
single-named relative fragment import so a fragment can be loaded as real ESM by
tests while staying import-free in the bundle. ONLY this exact shape is stripped:

    import { name } from './frag.js';

Any other shape — default import, `* as ns`, multi-line braces, double quotes,
or a missing `.js` extension — SURVIVES into the bundle and trips
`build-validity.test.js` (`/^import\s/m`). At runtime the imported name must
resolve from shared bundle scope, so the providing fragment must be in the
consuming workflow's `// @@USE:` list AND in `assertBundleSelfContained`'s
`known[]`. Live case: `model-tiers.js` importing `operatingInstructions` from
`operating-posture.js`.
