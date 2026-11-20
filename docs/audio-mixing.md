# Audio mixing and ducking

The FFmpeg audio mixer accepts only explicitly selected voice, music, and effect clips. Every clip
has measured source/start/duration timing and an explicit dB gain. Tracks are combined with
`normalize=0`, so FFmpeg does not silently rewrite the approved relative levels.

When music and ducking are both selected, the voice bus drives a bounded side-chain compressor on
the music bus. Music may loop only when its input declares looping. Effects are independent timed
inputs. When music or effects are disabled, the corresponding files and filters are absent—not
silent placeholder tracks. A narration-only output therefore has exactly one input and no music,
effect, or side-chain filter.

Mixing observes the operation cancellation/deadline and diagnostic/output byte limits. FFmpeg
writes an attempt-scoped partial WAV; a successful, non-empty bounded result is linked to a new
final path without replacing an existing mix.

On 2026-11-20, the separately enabled real-FFmpeg test rendered a one-second 48 kHz PCM narration
WAV from a generated tone. The accepted command had exactly one input and no music, effect, or
side-chain filter; ordinary fixture runs keep that external executable check explicitly skipped.
