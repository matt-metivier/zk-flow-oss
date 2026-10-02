// src/fragments/backtrack.js
// Backtrack-on-failure gate recovery (issue #41, lifted from Arnold eval — INSPIRE).
//
// runPhase escalates the MODEL on a stuck phase but can't revisit a sibling phase.
// When a phase exhausts iterations + escalation (returns { ok:false, backtrackEligible:true }),
// the cause is often the PRIOR phase (e.g. impl keeps failing because the design was wrong).
// runWithBacktrack re-runs the prior phase once with the failure as feedback, then retries
// the current phase — bounded by `budget`, opt-in, default OFF.
//
// budget=0  -> pure pass-through: calls curRunner() once and returns it. Byte-identical
//              to not using the helper. This is the default everywhere.
// budget=N  -> on cur ok:false && backtrackEligible: re-run prevRunner(feedback), then
//              curRunner(), decrementing budget, until cur.ok or budget exhausted. Then
//              return the last (failed) cur result so the caller's existing needs_human
//              handoff fires exactly as today.
//
// prevRunner(feedback) and curRunner() are thunks the workflow already has (closures over
// its runPhase({...}) configs), so this helper needs no per-phase knowledge.

export async function runWithBacktrack(prevRunner, curRunner, opts = {}) {
  const budget = Number.isInteger(opts.budget) && opts.budget > 0 ? opts.budget : 0;

  let cur = await curRunner();
  if (budget === 0) return cur; // OFF: pass-through, no extra field churn

  let backtracks = 0;
  while (!cur.ok && cur.backtrackEligible && backtracks < budget) {
    const feedback = JSON.stringify((cur.grade && cur.grade.findings) || cur.grade || {});
    const prev = await prevRunner(feedback);
    backtracks++;
    // If re-running the prior phase itself fails, stop masking it — hand off.
    if (!prev || prev.ok === false) break;
    cur = await curRunner();
  }

  return { ...cur, backtracks };
}
