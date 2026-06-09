# Model Tiers

zk-flow assigns a model to each phase via `src/fragments/model-tiers.js`. The tier determines cost vs. quality tradeoff per phase.

## Tiers

| Tier | Alias | Current model | Use for |
|---|---|---|---|
| `fast` | haiku | claude-haiku-4-5 | Lightweight: persist, verify, grade output, CI checks |
| `mid` | sonnet | claude-sonnet-4-6 | Standard: research, review perspectives |
| `deep` | opus | claude-opus-4-8 | Expensive: design, grading (high judgment), impl |

## Phase defaults

| Phase | Model tier | Reasoning |
|---|---|---|
| discover | `mid` (sonnet) | Skill/vault selection — needs context understanding |
| research | `mid` (sonnet) | Investigation — balanced speed/quality |
| design | `deep` (opus) | Most consequential phase — highest judgment |
| impl | `mid` (sonnet) | Code generation — speed matters for iteration |
| grade | `deep` (opus) | Rubric evaluation — needs strong reasoning |
| review (perspectives) | `mid` (sonnet) | Pattern matching — sonnet sufficient |
| testing | `mid` (sonnet) | Test strategy — moderate judgment |
| persist | `fast` (haiku) | Writes bead memory — no judgment needed |
| verify | `fast` (haiku) | Simple checks — fast enough |
| ci | `fast` (haiku) | CI status reads — cheapest tier |
| grill | `deep` (opus) | Adversarial reasoning — needs strong model |

## Overrides

Pass `model=fast|mid|deep` or raw model ID to override globally:
```
/feature add OAuth model=fast        # all phases use haiku
/feature add OAuth models=impl:deep  # only impl uses opus
```

Per-phase override: `models=research:deep,impl:fast`

## Posture profiles

Each phase also has a posture: `exploration` (divergent, creative) or `precision` (convergent, focused).

| Phase | Default posture |
|---|---|
| research | exploration |
| discover | exploration |
| design | exploration |
| impl | precision |
| grade | precision |
| testing | precision |
| ci | precision |

Override: `posture=precision` (force precision on exploration phases) or `postures=design:precision`.
