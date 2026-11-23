import {
  type CaptionTrack,
  captionTrackSchema,
  type QualityProfile,
  qualityProfileSchema,
  type TechnicalQualityThresholds,
  type Timeline,
  type TimeRange,
  technicalQualityThresholdsSchema,
  timelineSchema,
} from '@tutorialx/contracts';

export const TECHNICAL_QUALITY_CHECKS = [
  'decode',
  'streams',
  'duration',
  'variant_metadata',
  'intervals',
  'loudness',
  'captions',
] as const;

export type TechnicalQualityCheckId = (typeof TECHNICAL_QUALITY_CHECKS)[number];
export type DetectedIntervalKind = 'blank' | 'frozen' | 'silent';

export interface DetectedMediaInterval {
  kind: DetectedIntervalKind;
  range: TimeRange;
}

export interface TechnicalMediaObservation {
  decodable: boolean;
  fullyDecoded: boolean;
  durationUs: number | null;
  videoDurationUs: number | null;
  audioDurationUs: number | null;
  width: number | null;
  height: number | null;
  frameRate: { numerator: number; denominator: number } | null;
  videoStreamCount: number;
  audioStreamCount: number;
  videoCodec: string | null;
  audioCodec: string | null;
  sampleRate: number | null;
  channels: number | null;
  loudnessLufs: number | null;
  truePeakDbtp: number | null;
  intervals: readonly DetectedMediaInterval[];
}

export interface TechnicalVariantExpectation {
  width: number;
  height: number;
  frameRate: { numerator: number; denominator: number };
  audioRequired: boolean;
}

export interface TechnicalQualityFinding {
  code: string;
  message: string;
  sceneId: string | null;
  range: TimeRange | null;
}

export interface TechnicalQualityCheck {
  id: TechnicalQualityCheckId;
  outcome: 'pass' | 'fail';
  findings: readonly TechnicalQualityFinding[];
}

export interface TechnicalQualityReport {
  passed: boolean;
  checks: readonly TechnicalQualityCheck[];
  findings: readonly TechnicalQualityFinding[];
}

const DEFAULT_TECHNICAL_THRESHOLDS: TechnicalQualityThresholds = {
  blankMinDurationUs: 500_000,
  frozenMinDurationUs: 750_000,
  silentMinDurationUs: 750_000,
  blackPixelRatio: 0.98,
  silenceNoiseDb: -50,
  freezeNoiseDb: -60,
};

export function resolveTechnicalQualityThresholds(
  profileValue: QualityProfile,
): TechnicalQualityThresholds {
  const profile = qualityProfileSchema.parse(profileValue);
  return technicalQualityThresholdsSchema.parse(profile.technical ?? DEFAULT_TECHNICAL_THRESHOLDS);
}

export function createNarrationQualityProfile(input: {
  id: string;
  createdAt: string;
  revision?: number;
  channels: 1 | 2;
}): QualityProfile {
  return qualityProfileSchema.parse({
    schemaVersion: 1,
    id: input.id,
    createdAt: input.createdAt,
    revision: input.revision ?? 1,
    requiredChecks: [...TECHNICAL_QUALITY_CHECKS, 'readability', 'editorial'],
    requiredModalities: ['image', 'audio', 'video'],
    maxSyncErrorUs: 250_000,
    targetLoudnessLufs: input.channels === 1 ? -19 : -16,
    loudnessToleranceLu: 1,
    maxTruePeakDbtp: -1,
    minTextHeightRatio: 0.03,
    maxRepairs: 2,
    technical: DEFAULT_TECHNICAL_THRESHOLDS,
  });
}

function finding(
  code: string,
  message: string,
  timeline: Timeline,
  range: TimeRange | null = null,
): TechnicalQualityFinding {
  const scenes = new Set(
    timeline.clips
      .filter(
        (clip) =>
          range !== null && clip.range.startUs < range.endUs && clip.range.endUs > range.startUs,
      )
      .map((clip) => clip.sceneId),
  );
  if (range !== null)
    for (const interval of timeline.intentionalIntervals)
      if (interval.range.startUs < range.endUs && interval.range.endUs > range.startUs)
        scenes.add(interval.sceneId);
  return { code, message, sceneId: scenes.size === 1 ? [...scenes][0]! : null, range };
}

function uncoveredSegments(range: TimeRange, allowed: readonly TimeRange[]): TimeRange[] {
  let cursor = range.startUs;
  const uncovered: TimeRange[] = [];
  for (const candidate of [...allowed].sort((left, right) => left.startUs - right.startUs)) {
    if (candidate.endUs <= cursor || candidate.startUs >= range.endUs) continue;
    if (candidate.startUs > cursor)
      uncovered.push({ startUs: cursor, endUs: Math.min(candidate.startUs, range.endUs) });
    cursor = Math.max(cursor, candidate.endUs);
    if (cursor >= range.endUs) break;
  }
  if (cursor < range.endUs) uncovered.push({ startUs: cursor, endUs: range.endUs });
  return uncovered;
}

function check(
  id: TechnicalQualityCheckId,
  findings: readonly TechnicalQualityFinding[],
): TechnicalQualityCheck {
  return { id, outcome: findings.length === 0 ? 'pass' : 'fail', findings };
}

function sameRate(
  actual: TechnicalMediaObservation['frameRate'],
  expected: TechnicalVariantExpectation['frameRate'],
) {
  return (
    actual !== null &&
    BigInt(actual.numerator) * BigInt(expected.denominator) ===
      BigInt(expected.numerator) * BigInt(actual.denominator)
  );
}

export function evaluateTechnicalQuality(input: {
  profile: QualityProfile;
  timeline: Timeline;
  captions: CaptionTrack | null;
  expectation: TechnicalVariantExpectation;
  observation: TechnicalMediaObservation;
}): TechnicalQualityReport {
  const profile = qualityProfileSchema.parse(input.profile);
  const timeline = timelineSchema.parse(input.timeline);
  const observation = input.observation;
  const checks: TechnicalQualityCheck[] = [];

  const decodeFindings: TechnicalQualityFinding[] = [];
  if (!observation.decodable)
    decodeFindings.push(
      finding('MEDIA_PROBE_FAILED', 'Final media could not be probed.', timeline),
    );
  if (!observation.fullyDecoded)
    decodeFindings.push(
      finding('MEDIA_DECODE_FAILED', 'Final media did not decode completely.', timeline),
    );
  checks.push(check('decode', decodeFindings));

  const streamFindings: TechnicalQualityFinding[] = [];
  if (observation.videoStreamCount !== 1)
    streamFindings.push(
      finding(
        'VIDEO_STREAM_COUNT_INVALID',
        `Expected exactly one video stream; measured ${observation.videoStreamCount}.`,
        timeline,
      ),
    );
  else if (observation.videoCodec === null)
    streamFindings.push(
      finding('VIDEO_CODEC_MISSING', 'The video stream codec could not be identified.', timeline),
    );
  if (input.expectation.audioRequired && observation.audioStreamCount < 1)
    streamFindings.push(
      finding('AUDIO_STREAM_MISSING', 'The approved timeline requires audio.', timeline),
    );
  else if (
    observation.audioStreamCount > 0 &&
    (observation.audioCodec === null ||
      observation.sampleRate === null ||
      observation.channels === null)
  )
    streamFindings.push(
      finding(
        'AUDIO_STREAM_METADATA_MISSING',
        'Audio codec, sample rate, or channel metadata is unavailable.',
        timeline,
      ),
    );
  checks.push(check('streams', streamFindings));

  const durationFindings: TechnicalQualityFinding[] = [];
  if (observation.durationUs === null)
    durationFindings.push(
      finding('MEDIA_DURATION_MISSING', 'Media duration is unavailable.', timeline),
    );
  else {
    const delta = observation.durationUs - timeline.durationUs;
    if (Math.abs(delta) > profile.maxSyncErrorUs)
      durationFindings.push(
        finding(
          delta < 0 ? 'MEDIA_TRUNCATED' : 'MEDIA_DURATION_MISMATCH',
          `Measured duration differs from the approved timeline by ${Math.abs(delta)} microseconds.`,
          timeline,
          delta < 0 ? { startUs: observation.durationUs, endUs: timeline.durationUs } : null,
        ),
      );
  }
  if (observation.videoStreamCount > 0 && observation.videoDurationUs === null)
    durationFindings.push(
      finding('VIDEO_DURATION_MISSING', 'Video stream duration is unavailable.', timeline),
    );
  else if (
    observation.videoDurationUs !== null &&
    timeline.durationUs - observation.videoDurationUs > profile.maxSyncErrorUs
  )
    durationFindings.push(
      finding('VIDEO_TRUNCATED', 'The video stream ends before the approved timeline.', timeline, {
        startUs: observation.videoDurationUs,
        endUs: timeline.durationUs,
      }),
    );
  if (
    input.expectation.audioRequired &&
    observation.audioStreamCount > 0 &&
    observation.audioDurationUs === null
  )
    durationFindings.push(
      finding('AUDIO_DURATION_MISSING', 'Audio stream duration is unavailable.', timeline),
    );
  else if (
    input.expectation.audioRequired &&
    observation.audioDurationUs !== null &&
    timeline.durationUs - observation.audioDurationUs > profile.maxSyncErrorUs
  )
    durationFindings.push(
      finding('AUDIO_TRUNCATED', 'The audio stream ends before the approved timeline.', timeline, {
        startUs: observation.audioDurationUs,
        endUs: timeline.durationUs,
      }),
    );
  checks.push(check('duration', durationFindings));

  const variantFindings: TechnicalQualityFinding[] = [];
  if (
    observation.width !== input.expectation.width ||
    observation.height !== input.expectation.height
  )
    variantFindings.push(
      finding(
        'VARIANT_DIMENSIONS_MISMATCH',
        `Expected ${input.expectation.width}x${input.expectation.height}; measured ${observation.width ?? 'unknown'}x${observation.height ?? 'unknown'}.`,
        timeline,
      ),
    );
  if (!sameRate(observation.frameRate, input.expectation.frameRate))
    variantFindings.push(
      finding(
        'VARIANT_FRAME_RATE_MISMATCH',
        'Measured frame rate does not match the variant.',
        timeline,
      ),
    );
  checks.push(check('variant_metadata', variantFindings));

  const intervalFindings: TechnicalQualityFinding[] = [];
  const intendedKind: Record<DetectedIntervalKind, 'blank' | 'hold' | 'silence'> = {
    blank: 'blank',
    frozen: 'hold',
    silent: 'silence',
  };
  for (const interval of observation.intervals) {
    const allowed = timeline.intentionalIntervals
      .filter((entry) => entry.kind === intendedKind[interval.kind])
      .map((entry) => entry.range);
    for (const range of uncoveredSegments(interval.range, allowed))
      intervalFindings.push(
        finding(
          `UNEXPECTED_${interval.kind.toUpperCase()}_INTERVAL`,
          `Detected an unplanned ${interval.kind} interval.`,
          timeline,
          range,
        ),
      );
  }
  checks.push(check('intervals', intervalFindings));

  const loudnessFindings: TechnicalQualityFinding[] = [];
  if (observation.audioStreamCount > 0) {
    if (observation.loudnessLufs === null)
      loudnessFindings.push(
        finding('AUDIO_LOUDNESS_MISSING', 'Integrated loudness could not be measured.', timeline),
      );
    else if (
      Math.abs(observation.loudnessLufs - profile.targetLoudnessLufs) > profile.loudnessToleranceLu
    )
      loudnessFindings.push(
        finding(
          'AUDIO_LOUDNESS_OUT_OF_RANGE',
          `Measured loudness ${observation.loudnessLufs} LUFS is outside the profile target.`,
          timeline,
        ),
      );
    if (observation.truePeakDbtp === null)
      loudnessFindings.push(
        finding('AUDIO_TRUE_PEAK_MISSING', 'True peak could not be measured.', timeline),
      );
    else if (observation.truePeakDbtp > profile.maxTruePeakDbtp)
      loudnessFindings.push(
        finding(
          'AUDIO_TRUE_PEAK_EXCEEDED',
          `Measured true peak ${observation.truePeakDbtp} dBTP exceeds the profile ceiling.`,
          timeline,
        ),
      );
  }
  checks.push(check('loudness', loudnessFindings));

  const captionFindings: TechnicalQualityFinding[] = [];
  if (timeline.captionTrackId === null && input.captions !== null)
    captionFindings.push(
      finding(
        'CAPTION_TRACK_UNEXPECTED',
        'Captions are not bound to the approved timeline.',
        timeline,
      ),
    );
  if (timeline.captionTrackId !== null && input.captions === null)
    captionFindings.push(
      finding('CAPTION_TRACK_MISSING', 'The approved caption track is missing.', timeline),
    );
  if (input.captions !== null) {
    const parsed = captionTrackSchema.safeParse(input.captions);
    if (!parsed.success)
      captionFindings.push(
        finding('CAPTION_CUES_INVALID', 'Caption cues are invalid or overlap.', timeline),
      );
    else if (
      parsed.data.id !== timeline.captionTrackId ||
      parsed.data.jobId !== timeline.jobId ||
      parsed.data.planRevision !== timeline.planRevision ||
      parsed.data.durationUs !== timeline.durationUs
    )
      captionFindings.push(
        finding(
          'CAPTION_TIMELINE_MISMATCH',
          'Captions do not match the accepted timeline.',
          timeline,
        ),
      );
  }
  checks.push(check('captions', captionFindings));

  const required = new Set(profile.requiredChecks);
  const requiredChecks = checks.filter((entry) => required.has(entry.id));
  const findings = checks.flatMap((entry) => entry.findings);
  return {
    passed: requiredChecks.length > 0 && requiredChecks.every((entry) => entry.outcome === 'pass'),
    checks,
    findings,
  };
}
