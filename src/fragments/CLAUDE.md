# zk-flow fragments

Fragments are pure JS modules inlined at build time into workflow bundles.

- No `import` statements — everything must be self-contained.
- Use `export` for functions/constants; `build.js` strips `export` before inlining.
- Every workflow `.src.js` that uses these must include `// @@USE: <name>,...` at the top and `// @@FRAGMENTS@@` where inlining occurs.
- Edit source here (`src/fragments/*.js`), never in generated `.claude/workflows/*.js`.
- Run `npm run build` after changes to regenerate workflow bundles.

## The one import exception
`build.js` `stripFragmentImports` strips exactly ONE import shape so a fragment can
be loaded as real ESM by tests while bundles stay import-free:

    import { name } from './frag.js';

Default / `* as ns` / multi-line / double-quoted / extensionless imports are NOT
stripped — they survive into the bundle and fail `build-validity.test.js`. The
imported name must resolve from shared bundle scope at runtime, so the providing
fragment must be in the workflow's `// @@USE:` list and in
`assertBundleSelfContained`'s `known[]`. Live case: `model-tiers.js` importing
`operatingInstructions` from `operating-posture.js` (the shared operating-posture
floor). See `.claude/rules/fragments.md`.
