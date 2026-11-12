# Resolved briefs and reviewable scripts

The core `recipeDefinition` and `resolveProductionBrief` APIs support tutorial,
explainer, asset-video, reel, and mixed production. Recipe purpose is independent
of aspect ratio. Brief resolution uses the existing settings precedence, policy
ceilings, detached profile snapshots, and origins; unknown settings, contradictory
dimensions, foreign sources, and missing material registrations are rejected.

`validatePlanSubmission` moves semantic plan acceptance into core so CLI and
future transports share revision, research, evidence, policy, scene, navigation,
and variant checks. Existing version-one plan schemas are preserved. The stricter
`validateProductionPlan` additionally checks feasible demonstrations, observed
capture evidence, accepted media and durations, declared provider selection,
explicit variant layouts, interaction scope, readability, and requested final
conclusion/call-to-action scenes. Passing schema validation alone is not a
production authorization.

`compileProductionScript` produces the additive `ProductionScript` record:
ordered narration/visual scenes, evidence, estimated timeline positions, asset
needs, voice/caption settings, and output variants. Estimates are always labeled;
they do not substitute for measured audio or recorded actions. The readable
storyboard places narration beside intended actions, expected results, evidence,
timing, and framing notes. Workspace projections now use that renderer.

`tests/core/planning.test.ts` covers every recipe, aspect-ratio independence,
policy/settings/material failures, readable review, stale/evidence-incomplete
submissions, multiple-variant layouts, accepted media, and blocked topic-only
demonstrations. Estimates/allowances/preflight/autonomous-policy evaluation and
production execution remain separately tracked tasks. See [approval](approval.md)
for explicit operator authority and revision binding.
