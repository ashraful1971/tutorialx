# No-paid-account narration example

Build the workspace, then run the public package APIs with a mono or stereo WAV recording whose
spoken words match the example manifest:

```sh
pnpm build
node examples/narration/no-paid-account.mjs \
  /absolute/path/to/narration.wav \
  examples/narration/no-paid-account.json \
  /absolute/path/to/empty-output-directory
```

The example imports the supplied recording, normalizes the manifest's provider-native word timing,
builds one validated final caption track, and writes SRT and WebVTT sidecars. It uses no hosted TTS,
credentials, Python, or model download. Replace the transcript and timing manifest together when
using another recording; the example does not inspect speech quality or claim that text alone proves
the recording contains the approved words.
