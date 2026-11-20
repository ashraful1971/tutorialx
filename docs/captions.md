# Final caption tracks

`buildFinalCaptionTrack` creates the single validated caption track used by embedded captions and
sidecar files. Inputs are final-audio word timings in integer microseconds plus scene identities,
language, audio artifact identities, and the exact plan revision. Words must be ordered,
nonoverlapping, and inside the measured track duration.

The line breaker preserves complete Unicode words and greedily fills configured line and line-count
limits. It starts a new cue at scene boundaries, when adding a word would exceed the cue-duration
limit, or when the text no longer fits. A single word longer than the configured line limit is an
explicit layout error; it is never split at an arbitrary code unit.

`serializeSrt` and `serializeWebVtt` consume the same track. Start boundaries round down and end
boundaries round up to the nearest millisecond, preventing sidecar conversion from trimming spoken
content. WebVTT includes the BCP 47 language metadata. `attachCaptionTrack` requires matching job,
plan revision, and duration, so a retimed revision cannot silently attach to an obsolete render
timeline.

`createVariantExporter` enforces that same accepted timeline binding for every output mode. `none`
and `embedded` produce no sidecars; `sidecar` leaves the accepted video unburned; `both` burns the
accepted track and writes only the selected SRT/VTT formats. Temporary burn-in subtitles are
removed. Thumbnail extraction runs only for variants whose `thumbnail` setting is true, and every
returned file records the accepted timeline identity.
