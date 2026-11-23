# Final-media technical quality

TutorialX evaluates the accepted encoded variant, not the renderer's success message. A versioned
`QualityProfile` selects required checks and production targets. Maintained narration profiles use
revision 1 detector calibration and a maximum 250 ms timeline mismatch:

| Measurement | Stereo profile | Mono profile |
| --- | ---: | ---: |
| Integrated loudness | -16 LUFS ±1 LU | -19 LUFS ±1 LU |
| True-peak ceiling | -1 dBTP | -1 dBTP |
| Blank interval | 500 ms, 98% black pixels | same |
| Frozen interval | 750 ms at -60 dB frame difference | same |
| Silent interval | 750 ms below -50 dB | same |

These are configurable TutorialX production targets, not universal publishing-platform rules.
Legacy version-one profile records without the additive `technical` section resolve to the same
calibrated values; newly maintained profiles persist the values explicitly.

`analyzeFinalMedia` accepts only a regular, non-symlink media file and invokes FFprobe and FFmpeg
with argument arrays. FFprobe measures streams, duration, dimensions, rational frame rate, codecs,
sample rate, and channels. FFmpeg performs a complete decode with errors promoted to failure, then
runs black, freeze, silence, EBU R128 integrated-loudness, and true-peak analysis. Diagnostic output
and runtime are bounded.

`evaluateTechnicalQuality` compares those observations with the accepted timeline and variant. It
requires one video stream, required audio, container and per-stream duration within the profile
tolerance, exact dimensions and equivalent rational frame rate, valid cue ordering/binding, and
compliant loudness/peak values.
A short result is reported as truncation. Detected intervals are subtracted from matching timeline
annotations (`blank`, `hold`, or `silence`); only the uncovered portion becomes a finding, so an
approved teaching pause does not hide a longer accidental freeze.

## Detector limits

Black, freeze, and silence detection is heuristic. Dark slides, static diagrams, and quiet speech
can resemble defects, while motion or background noise can hide one. Timeline annotations provide
policy context but do not prove editorial correctness. Technical success therefore cannot replace
the separate final-frame, content, accessibility, and evidence review. A detector execution failure
is an analysis failure, never an inferred pass.
