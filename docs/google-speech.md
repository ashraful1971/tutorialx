# Google Cloud speech provider

`createGoogleSpeechProvider` implements the `VoiceProvider` port using Google Cloud Text-to-Speech v1 without placing credentials in provider configuration. Composition code supplies a short-lived access-token callback (or a test transport), workspace identity, and the approved settings digest.

Configuration declares allowed languages, output sample rate, an explicit map from approved tone names to Google pitch semitones, and the current account-specific price in USD micros per million characters. Keeping the rate explicit avoids silently treating changing vendor pricing as code truth. The adapter supports bounded speaking pace, SSML `sub` pronunciation aliases, SSML word marks, LINEAR16 WAV measurement, provider request receipts when Google returns one, and character-based usage accounting.

Readiness fails with `GOOGLE_SPEECH_CREDENTIAL_MISSING` when no credential supplier exists. API errors retain the HTTP status without exposing the access token. Cancellation combines the operation signal with the earlier of its deadline and the provider's two-minute request ceiling. A successful operation writes only measured WAV output and manifest metadata into the authorized attempt directory.

## Separately tagged live smoke

Deterministic tests use an injected transport and do not claim Google compatibility. The live test is separately named `live Google speech` and runs only when `GOOGLE_SPEECH_ACCESS_TOKEN` is present:

```sh
GOOGLE_SPEECH_ACCESS_TOKEN='<short-lived token>' pnpm vitest run tests/conformance/google-speech.test.ts
```

Use a project where Text-to-Speech is enabled and the token principal has only the required permission. Do not save the token in `.env`, shell history, fixtures, logs, or commits. A task is not considered live-verified until that test returns real audio plus a non-null provider request receipt.
