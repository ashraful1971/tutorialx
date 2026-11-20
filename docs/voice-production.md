# Voice selection, supplied audio, and alignment

## Select and audition a generated voice

Voice selection belongs to the approved plan. Discover voices through the selected provider and
filter by the requested BCP 47 language plus required pace, tone, pronunciation, and timing
capabilities. Before approving a long paid run, synthesize a short representative excerpt that
contains product names, numbers, abbreviations, and the intended delivery style. Record the exact
provider/version, voice ID, language, controls, pronunciation map, processing location, receipt,
and measured cost. An audition is production evidence, not permission to change voice later; a
voice-changing fallback needs renewed authorization.

Google speech requires an OAuth access token supplied at composition time. Fixture tests and a
voice catalog response do not establish live compatibility. The separately tagged smoke test in
[Google speech](google-speech.md) remains required before describing that integration as live
verified.

## Use supplied narration without a paid account

Use `createSuppliedNarrationProvider` for an explicitly selected WAV recording. Bind each scene to
its exact approved transcript, language, and optional native word offsets. The adapter copies bytes
to the authorized attempt directory, measures duration/sample metadata, records provenance, and
rejects changes to words or delivery controls. Follow the runnable
[no-paid-account example](../examples/narration/README.md) to produce valid SRT and WebVTT from one
shared final caption track without hosted credentials or Python.

Supplied word timing is accepted only when it is ordered, nonoverlapping, and inside measured audio.
Missing timing returns `alignment-required`; it never creates evenly distributed cues. For a real
recording without trusted word offsets, configure the optional local aligner.

## Install local WhisperX alignment

The optional runtime is isolated from the base Node installation and frozen at WhisperX 3.8.6.
From `runtimes/speech/whisperx`:

```sh
uv sync --frozen --python 3.12
```

Select CPU mode with `device: "cpu"` and `computeType: "int8"`. CPU alignment is supported but can
be slow. The chosen transcription and language-specific alignment models may download only on the
first explicit alignment run; review their size, license, origin, and network policy first. CUDA is
a separate explicit configuration and is not implied by an installed GPU. See the
[runtime instructions](../runtimes/speech/whisperx/README.md) and
[alignment behavior](whisperx-alignment.md).

## Timing limits

- Provider-native offsets are normalized to integer microseconds and must describe complete,
  ordered ranges. Missing or one-sided offsets become findings, not guessed timestamps.
- Transcription is compared with approved narration but never becomes new script authority.
  Omissions, additions, product-term changes, numbers, and unalignable words remain explicit.
- Narration/action reconciliation shifts whole tracks. It does not truncate media or speed essential
  actions; declared anchors must fit the default 250 ms tolerance.
- Measured gaps require an authorized silence, hold, or supplied cutaway. These annotations allow
  later quality checks to distinguish intentional pacing from defects.
- SRT/VTT millisecond conversion rounds start times down and end times up. Embedded captions and
  sidecars consume the same revision-bound track, so styling edits cannot silently retime text.
