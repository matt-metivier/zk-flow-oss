// src/fragments/depth-map.js
// Review depth thresholds and perspective sets.
// "Evaluate only the criteria for your depth and all shallower depths."
export const REVIEW_DEPTHS = {
  none: [],
  light: ['correctness', 'obvious-bugs'],
  standard: ['correctness', 'obvious-bugs', 'security', 'scope-alignment', 'error-handling', 'api-contract'],
  full: ['correctness', 'obvious-bugs', 'security', 'scope-alignment', 'error-handling', 'api-contract',
         'performance', 'deployment-risk', 'maintainability'],
};
export const DEFAULT_PERSPECTIVES = ['advocate', 'critic', 'security', 'performance', 'learning'];
export function validPerspectives(list) {
  const filtered = list.filter(p => DEFAULT_PERSPECTIVES.includes(p) || ['persona', 'repo-conventions'].includes(p));
  return filtered.length ? filtered : DEFAULT_PERSPECTIVES;
}
export function criteriaForDepth(depth) {
  if (!(depth in REVIEW_DEPTHS)) throw new Error(`unknown review depth: ${depth}`);
  return REVIEW_DEPTHS[depth];
}
