# Recorded voice provider example

[`recorded-voice.ts`](recorded-voice.ts) is a complete small `VoiceProvider` using Node built-ins and `@tutorialx/contracts`. It returns an explicitly supplied recording for one exact English phrase and rejects requests for other words, voices, languages, pace, tone, or pronunciations. This narrow capability makes registration, configuration validation, readiness, zero-cost estimates, cancellation, measured artifact output, and missing word timing easy to inspect. It has no speech service or model dependency.

The adapter expects a canonical 44-byte-header PCM WAV: mono, signed 16-bit little-endian, 16 kHz, at most 5 MiB. Other WAV layouts are explicitly unsupported. Supply a recording whose spoken words match the configured transcript. The adapter validates encoding and copies bytes; editorial review must verify what is actually spoken. It reports `words: null`, so captions require an alignment provider. It does not advertise general text-to-speech or word timing.

## Run the extension checks

From the repository root with dependencies installed:

```sh
pnpm build
pnpm exec vitest run tests/conformance/recorded-voice.test.ts
pnpm check
```

The suite registers the provider through `wireProviders`, selects it through `selectProvider`, and runs `inspectProviderConformance` through package-root exports. It then writes and reads actual WAV fixture bytes, validates the response and checksum, checks measured duration/provenance, preserves the original, and rejects invalid requests, overwrites, malformed audio, cancellation, expired operations, and unsafe operation identities. The provider implementation imports no core internals and changes no stage logic.

The test creates one second of silent PCM in a temporary directory. It verifies file/contract behavior, not speech quality, a live synthesis backend, or alignment. The fixture generator is authored for TutorialX, contains no third-party audio, and removes its generated files after each test. No recordings or personal media are committed or packaged.

## Wire it at a composition root

Use the resolved settings and a trusted, contained attempt output directory from the engine. The private recording path and exact transcript are supplied explicitly by the operator. A factory must not discover/install an extension or resolve credentials from source-content instructions.

```ts
import { wireProviders } from '@tutorialx/core';
import { createRecordedVoiceProvider, recordedVoiceDescriptor } from './recorded-voice.js';

const wiring = wireProviders([
  {
    descriptor: recordedVoiceDescriptor,
    create: (selection) =>
      createRecordedVoiceProvider(selection.config, {
        path: operatorRecordingPath,
        text: approvedExactTranscript,
        workspaceId,
        settingsDigest: approvedSettingsDigest,
      }),
  },
]);

const candidate = {
  selection: {
    id: 'example-recorded-voice',
    version: '1.0.0',
    config: { voiceId: 'recorded', language: 'en-US' },
    credentialRef: null,
  },
  voiceId: 'recorded',
  visualIdentity: null,
};
```

The snippet is composition code: the named operator/approval values come from your application. The executable tests contain a full setup with temporary directories and operation context. Select using requirements `{ languages: ['en-US'], features: [], formats: ['audio/wav'], modalities: ['audio'], customScenes: [] }`, an empty fallback policy, and a zero cost ceiling. `synthesize` returns a path relative to the supplied attempt output directory; the stage's artifact acceptance layer must validate/materialize it into accepted job storage. Merely receiving a manifest does not commit a successful production stage.

The example source is checked and tested in this repository, and excluded from package distributions by their existing allowlists. When adding a real backend, keep SDK/filesystem work in its adapter, report capabilities and unknown costs truthfully, validate output bytes, and pass the same common harness plus backend-specific tests. See [provider selection](../../docs/providers.md) and [contract evolution](../../docs/contract-evolution.md).
