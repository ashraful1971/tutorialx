# Supplied narration

`createSuppliedNarrationProvider` imports explicitly configured WAV narration segments without
requiring hosted speech credentials. Each scene binds an authorized source path to its exact
approved transcript and language. The adapter rejects changed words, pace, tone, pronunciation,
or voice controls, copies bytes into the attempt directory without overwriting prior output, and
records the source and request digests in artifact provenance.

Provider-native word offsets may be supplied in seconds, milliseconds, or microseconds.
`normalizeProviderWordTimings` converts them to ordered half-open microsecond ranges and rejects
overlap, invalid offsets, or ranges beyond the measured audio duration. It does not stretch or
guess malformed timing.

Word timing is optional. When it is absent, the voice result contains `words: null` and
`decideNarrationTiming` returns `alignment-required` with the audio artifact identity. Downstream
caption production must configure a compatible alignment provider; it must never manufacture
evenly spaced caption cues from the transcript. Current built-in ingestion accepts measured WAV
audio. Other formats require an explicit, verified normalization adapter rather than an implicit
conversion.
