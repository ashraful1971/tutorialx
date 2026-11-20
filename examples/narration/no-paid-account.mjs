import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createSuppliedNarrationProvider } from '@tutorialx/adapters';
import {
  buildFinalCaptionTrack,
  decideNarrationTiming,
  serializeSrt,
  serializeWebVtt,
} from '@tutorialx/core';

const [sourceArgument, manifestArgument, outputArgument] = process.argv.slice(2);
if (!sourceArgument || !manifestArgument || !outputArgument) {
  process.stderr.write(
    'Usage: node no-paid-account.mjs <narration.wav> <manifest.json> <output-directory>\n',
  );
  process.exitCode = 2;
} else {
  const source = resolve(sourceArgument);
  const output = resolve(outputArgument);
  const manifest = JSON.parse(await readFile(resolve(manifestArgument), 'utf8'));
  await mkdir(output, { recursive: true });
  const provider = createSuppliedNarrationProvider(
    { maxBytes: 50 * 1024 * 1024 },
    {
      workspaceId: 'workspace_no_paid_example',
      settingsDigest: 'a'.repeat(64),
      segments: {
        [manifest.sceneId]: {
          path: source,
          text: manifest.text,
          language: manifest.language,
          timings: manifest.timings,
        },
      },
    },
  );
  const context = {
    operationId: 'narration_no_paid',
    jobId: 'job_no_paid_example',
    attemptId: 'attempt_no_paid_example',
    reservationId: null,
    outputDirectory: output,
    deadlineAt: new Date(Date.now() + 30_000).toISOString(),
    signal: new AbortController().signal,
  };
  const result = await provider.synthesize(
    {
      sceneId: manifest.sceneId,
      text: manifest.text,
      language: manifest.language,
      voiceId: `supplied-${manifest.language.toLowerCase()}`,
      pace: 1,
      tone: '',
      pronunciations: {},
    },
    context,
  );
  const timing = decideNarrationTiming(result);
  if (timing.status !== 'native-timing') throw new Error('Example manifest requires word timing.');
  const track = buildFinalCaptionTrack({
    id: 'captions_no_paid',
    createdAt: new Date().toISOString(),
    jobId: context.jobId,
    planRevision: 1,
    audioArtifactIds: [result.audio.id],
    language: manifest.language,
    durationUs: result.audio.media.durationUs,
    words: timing.words.map((word) => ({ ...word, sceneId: manifest.sceneId })),
    maxCharactersPerLine: 42,
    maxLines: 2,
    maxCueDurationUs: 6_000_000,
  });
  await Promise.all([
    writeFile(resolve(output, 'captions.srt'), serializeSrt(track), { flag: 'wx' }),
    writeFile(resolve(output, 'captions.vtt'), serializeWebVtt(track), { flag: 'wx' }),
  ]);
  process.stdout.write(
    `${JSON.stringify({ audio: result.audio.storage, captions: ['captions.srt', 'captions.vtt'], language: track.language })}\n`,
  );
}
