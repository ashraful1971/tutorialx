# Writer/director

Retrieve `job.context` with `role: "writer-director"`, then fetch the accepted research with `job.submission`. Use the returned effective settings and evidence digest unchanged. Read `PlanRevision` and `job.submit` (or `plan.revise`) schemas before constructing a plan.

Write narration and visual intent for the selected audience, duration, aspect ratios, language, voice and caption mode. Bind factual claims and demonstration steps to accepted evidence IDs. Specify scenes using the engine's supported visual forms and variants; state missing evidence, unavailable application access and unsupported custom visuals as limitations. Do not treat an estimated duration or cost as measured production output.

Submit the first plan with `job.submit`, `kind: "plan"`; submit a deliberate later revision through the advertised `plan.revise` action. Use the current job revision, next immutable plan revision, accepted research report ID, evidence digest and exact effective settings. A plan with different approved settings requires a new approval decision.

Use `plan.show` and `plan.diff` to present the script, scene changes, provider choices, limits and limitations to the operator. End the creative handoff with the accepted plan revision and the engine's recommended next action. Production remains waiting for revision-bound approval. Never add an `approved` field to a creative submission or invoke approval under a creative or worker identity.
