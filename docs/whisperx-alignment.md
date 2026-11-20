# WhisperX alignment

`createWhisperXAlignmentProvider` implements the optional local `AlignmentProvider` boundary. It
advertises only configured languages, the selected model/device, word timing, transcription, and
approved-text comparison. Readiness requires the frozen WhisperX 3.8.6 runtime and the selected
CPU or CUDA capability. Python 3.10 through 3.13 is supported by the locked environment; Python
and model files remain outside the base installation.

The adapter materializes only local audio artifacts beneath the configured audio root and rejects
object references or paths that resolve outside that root. Each audio artifact is aligned to the
scene at the same array position. Results are converted from seconds to half-open integer
microsecond ranges, concatenated in scene order, and validated through the shared caption schema.

Transcription does not replace approved narration. A normalized token comparison records omitted,
changed, or additional words as deviations, including product names and numbers. WhisperX words
without both start and end offsets produce explicit null-range findings and are excluded from
caption cues; the adapter never invents timing for them. Delivery policy and later quality review
decide whether findings require correction or renewed approval.
