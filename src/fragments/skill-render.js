// src/fragments/skill-render.js
// Renders selected_skills[] from research output into agent prompt text.
// Fixes the silent gap: researcher selects skills but downstream agents never receive them.
//
// Usage in workflow:
//   const skillsBlock = await renderSkills(research.out.selected_skills);
//   // Then include skillsBlock in the designer/impl agent prompt.
//
// Workflows WITHOUT a discover phase (debug, test, review, investigate, ...) have
// no selected_skills to render at all. They use selectAndRenderSkills(), which
// does catalog prefilter + selection + file read in ONE fast-tier agent call.
//
// The agent call is fast-tier (file reads only). Returns empty string if no skills or ZK_ARTIFACTS_DIR unset.
import { buildDiscoverCatalogCommand } from './args.js';

export function buildSkillRenderPrompt(selectedSkills) {
  if (!selectedSkills || selectedSkills.length === 0) return null;
  // Sandbox-safe: when process is unavailable, pass the literal env var and let
  // the render agent's shell expand it.
  const dir = (typeof process !== 'undefined' && process.env && process.env.ZK_ARTIFACTS_DIR) || '$ZK_ARTIFACTS_DIR';
  // Accept ids with or without trailing /SKILL.md (discover.json convention is without).
  const paths = selectedSkills.map(s => `${dir}/skills/${s.replace(/\/SKILL\.md$/, '')}/SKILL.md`).join(' ');
  return `Read and concatenate these skill files (expand $ZK_ARTIFACTS_DIR via shell, e.g. cat). For each file that does NOT exist, record its path in a "missing" array instead of failing. Files: ${paths}. Emit: {"skills_content": "<combined text of files that exist>", "missing": ["<paths that did not exist>"]}`;
}

// Builds a skills context block for injection into agent prompts.
// Call after research phase, pass result into designer/impl prompt.
export async function renderSkills(selectedSkills, modelTier) {
  if (!selectedSkills || selectedSkills.length === 0) return '';
  const prompt = buildSkillRenderPrompt(selectedSkills);
  if (!prompt) return '';
  try {
    const result = await agent(prompt, {
      label: 'render-skills',
      agentType: 'researcher',
      model: modelTier || MODEL_TIERS.fast
    });
    const missing = (result && result.missing) || [];
    if (missing.length === selectedSkills.length && selectedSkills.length > 0) {
      // Every selected skill was hallucinated/nonexistent — fail loud, the
      // discover output is wrong and downstream phases would run blind.
      throw new Error(`[skill-render] ALL ${selectedSkills.length} selected skills do not exist: ${missing.join(', ')}. Discover selected invalid skill ids.`);
    }
    if (result && result.skills_content) {
      const warn = missing.length
        ? `\n\nWARNING: ${missing.length} selected skill(s) do not exist and were skipped: ${missing.join(', ')}`
        : '';
      return `\n\n## Selected Skills (loaded by researcher)\n\n${result.skills_content}${warn}`;
    }
  } catch (e) {
    const dir = (typeof process !== 'undefined' && process.env) ? process.env.ZK_ARTIFACTS_DIR : '$ZK_ARTIFACTS_DIR';
    if (dir && selectedSkills && selectedSkills.length > 0) {
      throw new Error(
        `[skill-render] Failed to render ${selectedSkills.length} selected skills: ${e.message}. ` +
        'ZK_ARTIFACTS_DIR is set but skills could not be loaded. ' +
        'Check that skill paths are valid relative paths under $ZK_ARTIFACTS_DIR/skills/.'
      );
    }
    console.warn(`[skill-render] Failed to render skills (ZK_ARTIFACTS_DIR unset): ${e.message}`);
  }
  return '';
}

// Schema for the one-call select+render path. Keeps the agent from returning prose.
export const SKILL_SELECT_SCHEMA = {
  type: 'object',
  required: ['skills', 'skills_content'],
  properties: {
    skills: { type: 'array', items: { type: 'string' } },
    skills_content: { type: 'string' },
    missing: { type: 'array', items: { type: 'string' } },
  },
};

// Select skills from CATALOG.md for a free-text request and render them, in ONE
// fast-tier agent call. For workflows with no discover phase — before this, those
// workflows sent domain-blind prompts to every phase agent.
//
// requestText: the task text (a.brief / positional args / PR title).
// context:     optional object (research output, diff summary, alert payload) used
//              to sharpen the catalog prefilter. Passed through JSON.stringify.
// Returns '' when there is nothing to select on, when ZK_ARTIFACTS_DIR is unset,
// or when the agent finds no relevant skill — never throws, so a workflow can
// never fail because skill selection was unlucky.
export async function selectAndRenderSkills(requestText, context, modelTier, topK) {
  const request = (requestText || '').toString().trim();
  if (!request && !context) return '';
  const catalogCommand = buildDiscoverCatalogCommand({ request, research: context || null, topK });
  const prompt = [
    'Select and load the zk-artifacts skills relevant to this task. Do NOT answer the task itself.',
    '',
    '1. Run this relevance-gated catalog prefilter command:',
    '```',
    catalogCommand,
    '```',
    '2. Choose the skill ids that genuinely apply — at most 5, fewer is better, and NONE is a valid answer.',
    '   Copy each id exactly as written between the backticks. If the command prints',
    '   PREFILTER_FALLBACK_FULL_CATALOG, select from that full catalog instead.',
    '3. For each selected id, cat "$ZK_ARTIFACTS_DIR/skills/<id>/SKILL.md". Record any path that',
    '   does not exist in missing[] instead of failing.',
    '',
    'Return: { "skills": ["<ids>"], "skills_content": "<concatenated text of the files that exist>", "missing": ["<paths>"] }',
    `Task: ${request || '(infer from the context object)'}`,
  ].join('\n');
  try {
    const result = await agent(prompt, {
      label: 'skills:select-render',
      agentType: 'researcher',
      schema: SKILL_SELECT_SCHEMA,
      model: modelTier || MODEL_TIERS.fast,
    });
    if (!result || !result.skills_content) return '';
    const missing = (result.missing || []).filter(Boolean);
    const warn = missing.length
      ? `\n\nWARNING: ${missing.length} selected skill(s) do not exist and were skipped: ${missing.join(', ')}`
      : '';
    return `\n\n## Selected Skills (auto-selected from skills/CATALOG.md)\n\n${result.skills_content}${warn}`;
  } catch (e) {
    // Non-fatal by design: a workflow with no discover phase had NO skills before,
    // so failing to add them must not break the run. Surfaced, not swallowed.
    console.warn(`[skill-render] selectAndRenderSkills failed (continuing without skills): ${e.message}`);
    return '';
  }
}

// Warn (non-fatal) if research selected skills but rendering is not wired in the calling workflow.
export function warnIfSkillsDropped(selectedSkills, contextLabel) {
  if (selectedSkills && selectedSkills.length > 0) {
    console.warn(`[skill-render:${contextLabel}] selected_skills has ${selectedSkills.length} entries but rendering is not wired. Skills will not reach downstream agents. Add: const skillsBlock = await renderSkills(research.out.selected_skills);`);
  }
}

// Validates that selected skill paths look like real skill IDs before sending to agent.
// Skill IDs are relative paths under $ZK_ARTIFACTS_DIR/skills/ (no leading slash).
export function assertSelectedSkillsValid(selectedSkills, phaseName) {
  if (!selectedSkills || selectedSkills.length === 0) return;
  const invalid = selectedSkills.filter(s => 
    !s || typeof s !== 'string' || s.startsWith('/') || s.includes('..') || !s.includes('/')
  );
  if (invalid.length > 0) {
    console.warn(
      `[skill-render:${phaseName}] ${invalid.length} invalid skill path(s): ${invalid.join(', ')}. ` +
      'Skill IDs must be relative dir paths under skills/ like "general/infrastructure/clickhouse" (SKILL.md is appended automatically).'
    );
  }
}
