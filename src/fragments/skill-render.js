// src/fragments/skill-render.js
// Renders selected_skills[] from research output into agent prompt text.
// Fixes the silent gap: researcher selects skills but downstream agents never receive them.
//
// Usage in workflow:
//   const skillsBlock = await renderSkills(research.out.selected_skills);
//   // Then include skillsBlock in the designer/impl agent prompt.
//
// The agent call is haiku-tier (file reads only). Returns empty string if no skills or ZK_ARTIFACTS_DIR unset.

export function buildSkillRenderPrompt(selectedSkills) {
  if (!selectedSkills || selectedSkills.length === 0) return null;
  const dir = process.env.ZK_ARTIFACTS_DIR;
  if (!dir) return null;
  const paths = selectedSkills.map(s => `${dir}/skills/${s}/SKILL.md`).join(' ');
  return `Read and concatenate these skill files, then return their combined content as a single JSON string field "skills_content". Skip any file that does not exist. Files: ${paths}. Emit: {"skills_content": "<combined text>"}`;
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
    if (result && result.skills_content) {
      return `\n\n## Selected Skills (loaded by researcher)\n\n${result.skills_content}`;
    }
  } catch (e) {
    console.warn(`[skill-render] Failed to render skills: ${e.message}. Proceeding without skill context.`);
  }
  return '';
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
      'Skill IDs must be relative paths like "general/infrastructure/clickhouse/SKILL.md".'
    );
  }
}
