// src/fragments/schemas.js
// Re-export raw JSON schemas as JS consts. At workflow build, build.js inlines the
// resolved object literals (see build.js: JSON imports are inlined as literals).
import research from '../../schemas/research.json' with { type: 'json' };
import design from '../../schemas/design.json' with { type: 'json' };
import implementation from '../../schemas/implementation.json' with { type: 'json' };
import review from '../../schemas/review.json' with { type: 'json' };
import testing from '../../schemas/testing.json' with { type: 'json' };
import discover from '../../schemas/discover.json' with { type: 'json' };
import proposal from '../../schemas/proposal.json' with { type: 'json' };
export const SCHEMAS = { research, design, implementation, review, testing, discover, proposal };
