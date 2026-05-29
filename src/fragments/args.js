// src/fragments/args.js
// Task 0 finding: saved workflow commands pass free TEXT as `args`, not an object.
// parseArgs turns "depth=full mode=interview" -> {depth:'full',mode:'interview'};
// bare tokens collect under `_`. readArgs normalizes object|string|undefined -> object.
const CONTROL_KEYS = ['depth','mode','maxIterations','startAt','targetEnv','window','autoApprove','perspectives','bead','brief','skipReview','pr','model','models','ideate','frames','topK','api','id','deleteSibling'];
export function parseArgs(str) {
  if (!str || typeof str !== 'string') return {};
  const out = {};
  const positional = [];
  for (const tok of str.trim().split(/\s+/).filter(Boolean)) {
    const eq = tok.indexOf('=');
    if (eq > 0 && CONTROL_KEYS.includes(tok.slice(0, eq))) {
      out[tok.slice(0, eq)] = tok.slice(eq + 1);
    } else {
      positional.push(tok);
    }
  }
  if (positional.length) out._ = positional;
  return out;
}
export function readArgs(args) {
  if (typeof args === 'string') return parseArgs(args);
  return args || {};
}
