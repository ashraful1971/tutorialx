import {
  type EffectiveSettings,
  type EvidenceRecord,
  effectiveSettingsSchema,
  type JobBrief,
  jobBriefSchema,
  type ResearchTaskPack,
  researchTaskPackSchema,
  type SourceManifest,
  sourceManifestSchema,
} from '@tutorialx/contracts';
import { ResearchPolicyError } from './evidence.js';

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
function boundedText(value: string, maximumBytes: number): string {
  let result = '';
  let used = 0;
  for (const character of value) {
    const length = new TextEncoder().encode(character).length;
    if (used + length > maximumBytes || result.length + character.length > 4000) break;
    result += character;
    used += length;
  }
  return result;
}

/** Pure task construction: caller retrieval ports enforce filesystem/network access before extraction. */
export function buildResearchTaskPack(input: {
  brief: JobBrief;
  currentRevision: number;
  effective: EffectiveSettings;
  sources: readonly SourceManifest[];
  extracts: readonly {
    sourceId: string;
    sourceHash: string;
    locator: EvidenceRecord['locator'];
    text: string;
  }[];
  maxTaskBytes?: number;
  maxOutputBytes?: number;
  remainingResearchBudgetUsdMicros?: number;
}): ResearchTaskPack {
  const brief = jobBriefSchema.parse(input.brief);
  const effective = effectiveSettingsSchema.parse(input.effective);
  const sources = input.sources.map((source) => sourceManifestSchema.parse(source));
  if (sources.some((source) => source.jobId !== brief.id))
    throw new ResearchPolicyError('INVALID_INPUT', 'Research sources belong to another job.');
  const policy = effective.settings.policy;
  const maxTaskBytes = input.maxTaskBytes ?? 64 * 1024;
  const maximum = input.remainingResearchBudgetUsdMicros ?? policy.researchBudgetUsdMicros;
  if (maximum > policy.researchBudgetUsdMicros || maximum < 0)
    throw new ResearchPolicyError(
      'POLICY_DENIED',
      'A task pack cannot increase the research budget.',
    );
  const pack = researchTaskPackSchema.parse({
    schemaVersion: 1,
    jobId: brief.id,
    basedOnRevision: input.currentRevision,
    topic: brief.topic,
    audience: brief.audience,
    instructionAuthority: 'engine-only',
    sourceContentAuthority: 'untrusted-data',
    policySnapshot: policy,
    allowedActions: ['job.inspect', 'research.submit', 'source.inspect', 'source.list'],
    outputSchemaId: 'urn:tutorialx:schema:1:ExternalResearchSubmission',
    limits: {
      maxOutputBytes: input.maxOutputBytes ?? 256 * 1024,
      maxTaskBytes,
      remainingResearchBudgetUsdMicros: maximum,
      deadlineAt: policy.deadlineAt,
    },
    sources: sources
      .slice(0, 100)
      .map((source) => ({ sourceId: source.id, status: source.status, reason: source.reason })),
    sourceData: [],
    truncated: sources.length > 100,
  });
  if (bytes(pack) > maxTaskBytes)
    throw new ResearchPolicyError(
      'INVALID_INPUT',
      'The research brief and policy exceed the task context limit.',
    );
  for (const extract of input.extracts) {
    if (pack.sourceData.length >= 100) {
      pack.truncated = true;
      break;
    }
    const source = sources.find((entry) => entry.id === extract.sourceId);
    if (!source || source.status !== 'available' || source.contentHash !== extract.sourceHash)
      throw new ResearchPolicyError(
        'REVISION_CONFLICT',
        'Research extract uses an unavailable or stale source.',
      );
    const text = boundedText(extract.text, Math.max(0, maxTaskBytes - bytes(pack) - 2048));
    if (text !== extract.text) pack.truncated = true;
    const item = { ...extract, text, authority: 'untrusted-data' as const };
    pack.sourceData.push(item);
    if (bytes(pack) > maxTaskBytes) {
      pack.sourceData.pop();
      pack.truncated = true;
      break;
    }
    if (text.length === 0 && extract.text.length > 0) break;
  }
  return researchTaskPackSchema.parse(pack);
}
