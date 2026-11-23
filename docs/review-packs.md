# Final review packs

A TutorialX review pack is immutable context for one job revision, output variant, quality-profile
revision, and accepted final-video artifact. It is not a renderer report and it does not itself mark
delivery ready.

`buildReviewPack` derives every scene's half-open time range from the accepted timeline. Each scene
must have:

- a representative frame extracted from the final encoded video;
- a final-video clip covering the scene range;
- an audio reference when the quality profile requires audio review;
- a transcript reference when the approved scene contains narration; and
- capture checkpoint evidence when the scene demonstrates a browser flow.

Evidence records declare their artifact, scene, time range, kind, and modalities. The public schema
prevents a text transcript from advertising video capability and prevents coverage from extending
beyond either its scene or its referenced evidence. Missing or duplicate scene material rejects the
pack rather than producing partial review context.

`createFfmpegReviewMediaMaterializer` extracts a midpoint JPEG and an exact-duration H.264/AAC clip
for each scene using bounded argument-array subprocesses. Outputs are linked into place only after a
nonempty temporary result exists. If any later extraction fails, earlier files from the same call
are removed, so an incomplete materialization is not returned as a pack.

Before dispatch, `assessReviewPackCoverage` compares the complete scene ranges and required
modalities with both available evidence and the selected reviewer's declared modalities. Every
required modality must cover every scene and the reviewer must be able to inspect it. A text-only
reviewer therefore cannot pass a profile requiring image, audio, or video inspection. Human review
can satisfy the same capability declaration; unavailable capability remains an attention-required
condition.

Representative frames are samples, not proof that every frame is readable. Clips, capture
checkpoints, transcript/audio references, and the technical report remain separate evidence. The
fresh editorial decision and its actually inspected coverage are recorded in `ReviewResult`, not
inferred from pack construction.
