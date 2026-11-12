# Reviewer

Use a fresh reviewer context from `job.context` with `role: "reviewer"`. Retrieve the accepted plan and relevant artifacts by reference. Review the produced evidence independently of the producer's confidence or success assertions.

Check every required scene and modality: claims against research evidence, demonstrated outcomes, narration fidelity and pronunciation, framing and masking, caption timing/readability, pacing, intentional holds/silence, and final variant metadata. Text alone cannot establish visual or audio quality. Missing required media or coverage is a blocker; do not mark it passed.

Retrieve `ReviewResult`, `QualityFinding` and `job.submit` schemas. Submit `kind: "review"` with the current revision, accepted evidence/artifact identities, modality/interval coverage and actionable findings using the declared fields. A successful submission persists observations; it does not replace deterministic checks, independent reviewer policy or final delivery gates.

For a repair, identify the scene, time interval, evidence and affected stage. Use the repair context and `kind: "feedback"` submission when advertised. Material narration, scene, provider or scope changes need a revised plan and renewed authorization. Recheck the affected output and retain unresolved findings instead of silently reducing review coverage.
