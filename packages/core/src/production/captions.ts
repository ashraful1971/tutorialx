import {
  type CaptionTrack,
  captionTrackSchema,
  idSchema,
  languageSchema,
  type TimedWord,
  type Timeline,
  timedWordSchema,
  timelineSchema,
} from '@tutorialx/contracts';

export interface CaptionWord extends TimedWord {
  sceneId: string;
}

export interface CaptionTrackInput {
  id: string;
  createdAt: string;
  jobId: string;
  planRevision: number;
  audioArtifactIds: readonly string[];
  language: string;
  durationUs: number;
  words: readonly CaptionWord[];
  maxCharactersPerLine: number;
  maxLines: number;
  maxCueDurationUs: number;
}

function length(value: string): number {
  return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].length;
}

function wrap(values: readonly string[], maximum: number, maxLines: number): string[] | null {
  const lines: string[] = [];
  for (const word of values) {
    if (length(word) > maximum) return null;
    const current = lines.at(-1);
    if (current === undefined) lines.push(word);
    else if (length(`${current} ${word}`) <= maximum)
      lines[lines.length - 1] = `${current} ${word}`;
    else if (lines.length < maxLines) lines.push(word);
    else return null;
  }
  return lines;
}

function validateWords(words: readonly CaptionWord[], durationUs: number) {
  if (words.length === 0 || words.length > 100_000) throw new Error('CAPTION_WORDS_INVALID');
  for (const [index, word] of words.entries()) {
    idSchema.parse(word.sceneId);
    timedWordSchema.parse({ text: word.text, range: word.range });
    if (
      word.range.endUs > durationUs ||
      (index > 0 && word.range.startUs < words[index - 1]!.range.endUs)
    )
      throw new Error('CAPTION_WORD_RANGES_INVALID');
  }
}

export function buildFinalCaptionTrack(input: CaptionTrackInput): CaptionTrack {
  idSchema.parse(input.id);
  idSchema.parse(input.jobId);
  languageSchema.parse(input.language);
  if (
    !Number.isSafeInteger(input.maxCharactersPerLine) ||
    input.maxCharactersPerLine < 1 ||
    input.maxCharactersPerLine > 500 ||
    !Number.isSafeInteger(input.maxLines) ||
    input.maxLines < 1 ||
    input.maxLines > 10 ||
    !Number.isSafeInteger(input.maxCueDurationUs) ||
    input.maxCueDurationUs < 1
  )
    throw new Error('CAPTION_LAYOUT_INVALID');
  validateWords(input.words, input.durationUs);

  const groups: CaptionWord[][] = [];
  for (const word of input.words) {
    const group = groups.at(-1);
    if (!group) {
      groups.push([word]);
      continue;
    }
    const candidate = [...group, word];
    const candidateDurationUs = word.range.endUs - group[0]!.range.startUs;
    if (
      word.sceneId === group[0]!.sceneId &&
      candidateDurationUs <= input.maxCueDurationUs &&
      wrap(
        candidate.map((entry) => entry.text),
        input.maxCharactersPerLine,
        input.maxLines,
      ) !== null
    )
      group.push(word);
    else groups.push([word]);
  }

  return captionTrackSchema.parse({
    schemaVersion: 1,
    id: input.id,
    createdAt: input.createdAt,
    jobId: input.jobId,
    planRevision: input.planRevision,
    audioArtifactIds: input.audioArtifactIds,
    language: input.language,
    durationUs: input.durationUs,
    cues: groups.map((group, index) => ({
      id: `cue_${index + 1}`,
      sceneId: group[0]!.sceneId,
      text: wrap(
        group.map((word) => word.text),
        input.maxCharactersPerLine,
        input.maxLines,
      )!.join('\n'),
      range: { startUs: group[0]!.range.startUs, endUs: group.at(-1)!.range.endUs },
      words: group.map(({ text, range }) => ({ text, range })),
    })),
  });
}

function timestamp(timeUs: number, separator: ',' | '.'): string {
  const milliseconds = Math.floor(timeUs / 1_000);
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1_000);
  const remainder = milliseconds % 1_000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}${separator}${String(remainder).padStart(3, '0')}`;
}

function serializedRange(range: { startUs: number; endUs: number }, separator: ',' | '.') {
  const startUs = Math.floor(range.startUs / 1_000) * 1_000;
  const endUs = Math.ceil(range.endUs / 1_000) * 1_000;
  return `${timestamp(startUs, separator)} --> ${timestamp(endUs, separator)}`;
}

export function serializeSrt(trackValue: CaptionTrack): string {
  const track = captionTrackSchema.parse(trackValue);
  return `${track.cues
    .map((cue, index) => `${index + 1}\n${serializedRange(cue.range, ',')}\n${cue.text}`)
    .join('\n\n')}\n`;
}

export function serializeWebVtt(trackValue: CaptionTrack): string {
  const track = captionTrackSchema.parse(trackValue);
  return `WEBVTT\nLanguage: ${track.language}\n\n${track.cues
    .map((cue) => `${cue.id}\n${serializedRange(cue.range, '.')}\n${cue.text}`)
    .join('\n\n')}\n`;
}

export function attachCaptionTrack(timelineValue: Timeline, trackValue: CaptionTrack): Timeline {
  const timeline = timelineSchema.parse(timelineValue);
  const track = captionTrackSchema.parse(trackValue);
  if (
    timeline.jobId !== track.jobId ||
    timeline.planRevision !== track.planRevision ||
    timeline.durationUs !== track.durationUs
  )
    throw new Error('CAPTION_TIMELINE_REVISION_MISMATCH');
  return timelineSchema.parse({ ...timeline, captionTrackId: track.id });
}
