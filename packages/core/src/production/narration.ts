import { type VoiceResult, voiceResultSchema } from '@tutorialx/contracts';

export type NarrationTimingDecision =
  | { status: 'native-timing'; words: NonNullable<VoiceResult['words']> }
  | {
      status: 'alignment-required';
      reason: 'word-timing-unavailable';
      audioArtifactId: string;
    };

/** Keeps missing provider timing explicit so downstream code cannot invent caption cues. */
export function decideNarrationTiming(resultValue: VoiceResult): NarrationTimingDecision {
  const result = voiceResultSchema.parse(resultValue);
  return result.words === null
    ? {
        status: 'alignment-required',
        reason: 'word-timing-unavailable',
        audioArtifactId: result.audio.id,
      }
    : { status: 'native-timing', words: result.words };
}
