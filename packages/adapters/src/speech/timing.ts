import { type TimedWord, timedWordSchema } from '@tutorialx/contracts';

export type ProviderTimingUnit = 'seconds' | 'milliseconds' | 'microseconds';

export interface ProviderWordTiming {
  text: string;
  start: number;
  end?: number;
  unit: ProviderTimingUnit;
}

function toMicroseconds(value: number, unit: ProviderTimingUnit): number {
  if (!Number.isFinite(value) || value < 0) throw new Error('SUPPLIED_TIMING_OFFSET_INVALID');
  const multiplier = unit === 'seconds' ? 1_000_000 : unit === 'milliseconds' ? 1_000 : 1;
  const result = Math.round(value * multiplier);
  if (!Number.isSafeInteger(result)) throw new Error('SUPPLIED_TIMING_OFFSET_INVALID');
  return result;
}

/** Converts provider-native offsets into ordered half-open microsecond ranges. */
export function normalizeProviderWordTimings(
  values: readonly ProviderWordTiming[],
  durationUs: number,
): TimedWord[] {
  if (!Number.isSafeInteger(durationUs) || durationUs <= 0)
    throw new Error('SUPPLIED_TIMING_DURATION_INVALID');
  if (values.length === 0 || values.length > 100_000)
    throw new Error('SUPPLIED_TIMING_COUNT_INVALID');
  const points = values.map((value) => ({
    text: value.text,
    startUs: toMicroseconds(value.start, value.unit),
    endUs: value.end === undefined ? undefined : toMicroseconds(value.end, value.unit),
  }));
  return points.map((point, index) => {
    const endUs = point.endUs ?? points[index + 1]?.startUs ?? durationUs;
    if (
      point.startUs >= durationUs ||
      endUs > durationUs ||
      endUs <= point.startUs ||
      (index > 0 && point.startUs < (points[index - 1]!.endUs ?? point.startUs)) ||
      (index > 0 && point.startUs < points[index - 1]!.startUs)
    )
      throw new Error('SUPPLIED_TIMING_RANGE_INVALID');
    return timedWordSchema.parse({
      text: point.text,
      range: { startUs: point.startUs, endUs },
    });
  });
}
