import {
  canonicalJson,
  type EvidenceRecord,
  type ExternalResearchSubmission,
  evidenceRecordSchema,
  externalResearchSubmissionSchema,
  type ResearchAssessment,
  type ResearchClaimUse,
  type ResearchConflict,
  type ResearchEvidenceObservation,
  type ResearchReport,
  researchAssessmentSchema,
  researchClaimUseSchema,
  researchConflictSchema,
  researchEvidenceObservationSchema,
  researchReportSchema,
  type SourceManifest,
  sourceManifestSchema,
} from '@tutorialx/contracts';

export class ResearchPolicyError extends Error {
  constructor(
    readonly code: 'INVALID_INPUT' | 'REVISION_CONFLICT' | 'POLICY_DENIED',
    message: string,
  ) {
    super(message);
  }
}
const assert = (
  condition: unknown,
  message: string,
  code: ResearchPolicyError['code'] = 'INVALID_INPUT',
) => {
  if (!condition) throw new ResearchPolicyError(code, message);
};
const unique = (ids: readonly string[]) => new Set(ids).size === ids.length;

/** Validate an external handoff without executing any source instructions or provider calls. */
export function validateResearchSubmission(
  raw: unknown,
  context: {
    jobId: string;
    currentRevision: number;
    sources: readonly SourceManifest[];
    existingEvidence: readonly EvidenceRecord[];
    acceptedArtifactIds: readonly string[];
    /** Legacy job.submit has no sidecars; its original wire shape remains unchanged. */
    legacy?: boolean;
  },
): ExternalResearchSubmission {
  let submission: ExternalResearchSubmission;
  if (context.legacy) {
    const value = raw as Record<string, unknown>;
    // Parse the original shape first so authority-looking extra keys cannot enter the engine.
    const keys = Object.keys(value ?? {});
    assert(
      keys.every((key) => ['jobId', 'kind', 'report', 'evidence'].includes(key)),
      'Research submission contains unknown fields.',
    );
    submission = externalResearchSubmissionSchema.parse({
      ...value,
      observations: [],
      conflicts: [],
    });
  } else submission = externalResearchSubmissionSchema.parse(raw);
  const { report, evidence, observations, conflicts } = submission;
  assert(
    submission.jobId === context.jobId && report.jobId === context.jobId,
    'Research belongs to another job.',
  );
  assert(
    report.basedOnRevision === context.currentRevision,
    'Research is based on a stale job revision.',
    'REVISION_CONFLICT',
  );
  assert(unique(evidence.map((item) => item.id)), 'Duplicate evidence identity.');
  assert(unique(report.sourceIds) && unique(report.evidenceIds), 'Duplicate research references.');
  const sources = context.sources.map((source) => sourceManifestSchema.parse(source));
  for (const item of evidence) {
    assert(item.jobId === context.jobId, 'Evidence belongs to another job.');
    assert(
      sources.some(
        (source) =>
          source.jobId === context.jobId &&
          source.id === item.sourceId &&
          source.status === 'available' &&
          source.contentHash === item.sourceHash,
      ),
      'Evidence references an unavailable or stale source.',
    );
    assert(
      item.artifactIds.every((id) => context.acceptedArtifactIds.includes(id)),
      'Evidence references an unaccepted artifact.',
    );
    const existing = context.existingEvidence.find((old) => old.id === item.id);
    assert(
      !existing || canonicalJson(existing) === canonicalJson(item),
      'Accepted evidence is immutable; submit a new identity.',
    );
  }
  const all = [...context.existingEvidence, ...evidence];
  assert(
    report.sourceIds.every((id) =>
      sources.some((source) => source.id === id && source.jobId === context.jobId),
    ),
    'Research references an unregistered source.',
  );
  assert(
    report.evidenceIds.every((id) =>
      all.some(
        (item) =>
          item.id === id &&
          item.jobId === context.jobId &&
          report.sourceIds.includes(item.sourceId),
      ),
    ),
    'Research references missing evidence or an undeclared source.',
  );
  assert(
    report.evidenceIds.length > 0 || report.blockers.length > 0,
    'Research requires evidence or an explicit blocker.',
  );
  assert(
    unique(observations.map((item) => item.id)) &&
      unique(observations.map((item) => item.evidenceId)),
    'Duplicate evidence observation.',
  );
  for (const observation of observations) {
    const item = all.find((candidate) => candidate.id === observation.evidenceId);
    assert(
      observation.jobId === context.jobId && item,
      'Observation references another job or missing evidence.',
    );
    assert(
      !['supplied', 'inferred', 'observed'].includes(item!.status) ||
        item!.status === observation.origin,
      'Observation origin differs from the evidence status.',
    );
    assert(
      unique(observation.contradictsEvidenceIds) &&
        observation.contradictsEvidenceIds.every(
          (id) =>
            id !== observation.evidenceId &&
            all.some((candidate) => candidate.id === id && candidate.jobId === context.jobId),
        ),
      'Contradiction references missing or identical evidence.',
    );
    if (observation.appStep)
      assert(
        observation.origin === 'observed' && item!.artifactIds.length > 0,
        'Observed app steps require accepted artifact evidence.',
      );
  }
  assert(unique(conflicts.map((item) => item.id)), 'Duplicate research conflict identity.');
  for (const conflict of conflicts) {
    assert(
      conflict.jobId === context.jobId &&
        unique(conflict.evidenceIds) &&
        conflict.evidenceIds.every((id) =>
          all.some((item) => item.id === id && item.jobId === context.jobId),
        ),
      'Conflict references another job, duplicate or missing evidence.',
    );
    if (conflict.resolution) {
      assert(
        unique(conflict.resolution.acceptedEvidenceIds) &&
          conflict.resolution.acceptedEvidenceIds.every((id) => conflict.evidenceIds.includes(id)),
        'Conflict resolution references evidence outside its conflict.',
      );
      assert(
        conflict.resolution.kind !== 'corrected' ||
          conflict.resolution.acceptedEvidenceIds.length > 0,
        'A corrected conflict needs supporting evidence.',
      );
      assert(
        conflict.resolution.kind !== 'removed' ||
          conflict.resolution.acceptedEvidenceIds.length === 0,
        'A removed claim cannot retain asserted evidence.',
      );
    }
  }
  return submission;
}

/** Enforce recorded proof and conflicts; semantic conflict discovery remains a research/reviewer task. */
export function assessResearchEvidence(input: {
  jobId: string;
  report: ResearchReport;
  sources: readonly SourceManifest[];
  evidence: readonly EvidenceRecord[];
  observations?: readonly ResearchEvidenceObservation[];
  conflicts?: readonly ResearchConflict[];
  claims?: readonly ResearchClaimUse[];
}): ResearchAssessment {
  const report = researchReportSchema.parse(input.report);
  const evidence = input.evidence.map((item) => evidenceRecordSchema.parse(item));
  const sources = input.sources.map((item) => sourceManifestSchema.parse(item));
  const observations = (input.observations ?? []).map((item) =>
    researchEvidenceObservationSchema.parse(item),
  );
  const conflicts = (input.conflicts ?? []).map((item) => researchConflictSchema.parse(item));
  const claims = (input.claims ?? []).map((item) => researchClaimUseSchema.parse(item));
  const issues: ResearchAssessment['issues'] = [];
  const add = (
    code: string,
    message: string,
    evidenceIds: string[] = [],
    claimId: string | null = null,
    conflictId: string | null = null,
  ) => {
    if (issues.length < 1000)
      issues.push({ code, message, evidenceIds: evidenceIds.slice(0, 100), claimId, conflictId });
  };
  if (report.jobId !== input.jobId)
    add('RESEARCH_JOB_MISMATCH', 'Research belongs to another job.');
  if (report.blockers.length) add('RESEARCH_BLOCKED', 'Resolve the retained research blockers.');
  for (const id of report.evidenceIds) {
    const item = evidence.find((entry) => entry.id === id && entry.jobId === input.jobId);
    if (!item) {
      add('MISSING_EVIDENCE', 'Research evidence is missing.', [id]);
      continue;
    }
    const source = sources.find(
      (entry) => entry.id === item.sourceId && entry.jobId === input.jobId,
    );
    if (!source || source.status !== 'available' || source.contentHash !== item.sourceHash)
      add('STALE_EVIDENCE', 'Evidence no longer matches an available source.', [id]);
    if (!report.sourceIds.includes(item.sourceId))
      add('UNDECLARED_SOURCE', 'Evidence source is outside the report.', [id]);
  }
  for (const observation of observations) {
    if (observation.jobId !== input.jobId) {
      add('OBSERVATION_JOB_MISMATCH', 'Observation belongs to another job.');
      continue;
    }
    for (const other of observation.contradictsEvidenceIds) {
      if (
        !report.evidenceIds.includes(observation.evidenceId) &&
        !report.evidenceIds.includes(other)
      )
        continue;
      const conflict = conflicts.find(
        (entry) =>
          entry.subjectId === observation.subjectId &&
          entry.evidenceIds.includes(other) &&
          entry.evidenceIds.includes(observation.evidenceId),
      );
      if (!conflict)
        add(
          'UNRESOLVED_CONFLICT',
          'Contradictory evidence requires an explicit conflict and resolution.',
          [observation.evidenceId, other],
        );
    }
  }
  for (const conflict of conflicts) {
    if (conflict.jobId !== input.jobId) {
      add('CONFLICT_JOB_MISMATCH', 'Conflict belongs to another job.', [], null, conflict.id);
      continue;
    }
    if (!conflict.material) continue;
    const uses = claims.filter(
      (claim) =>
        claim.subjectId === conflict.subjectId ||
        claim.evidenceIds.some((id) => conflict.evidenceIds.includes(id)),
    );
    if (!conflict.resolution) {
      add(
        'UNRESOLVED_CONFLICT',
        'Material research conflict must be resolved before approval.',
        conflict.evidenceIds,
        null,
        conflict.id,
      );
      continue;
    }
    const resolution = conflict.resolution;
    if (resolution.kind === 'removed' && uses.length)
      add(
        'REMOVED_CLAIM_USED',
        'The plan still uses a removed conflicting claim.',
        conflict.evidenceIds,
        null,
        conflict.id,
      );
    if (
      resolution.kind === 'uncertainty' &&
      (!input.claims || uses.some((claim) => claim.framing !== 'uncertain'))
    )
      add(
        'UNCERTAINTY_NOT_FRAMED',
        'Conflicting claims must be explicitly framed as uncertainty.',
        conflict.evidenceIds,
        null,
        conflict.id,
      );
    if (
      resolution.kind === 'corrected' &&
      (!resolution.acceptedEvidenceIds.length ||
        uses.some((claim) =>
          claim.evidenceIds.some(
            (id) =>
              conflict.evidenceIds.includes(id) && !resolution.acceptedEvidenceIds.includes(id),
          ),
        ))
    )
      add(
        'OUTDATED_CONFLICT_CLAIM',
        'The plan retains unsupported evidence after correction.',
        conflict.evidenceIds,
        null,
        conflict.id,
      );
  }
  for (const claim of claims) {
    for (const id of claim.evidenceIds) {
      const item = evidence.find((entry) => entry.id === id && entry.jobId === input.jobId);
      if (!item || !report.evidenceIds.includes(id)) {
        add(
          'UNSUPPORTED_CLAIM',
          'Claim evidence is outside the accepted research.',
          [id],
          claim.id,
        );
        continue;
      }
      if (claim.framing === 'uncertain') continue;
      if (item.status === 'contradicted' || item.status === 'unverified')
        add(
          'UNSUPPORTED_CLAIM',
          'An asserted claim relies on contradicted or unverified evidence.',
          [id],
          claim.id,
        );
      if (item.status === 'inferred' && claim.kind !== 'explanation')
        add(
          'INFERENCE_AS_FACT',
          'Inference cannot establish an asserted fact or observed procedure.',
          [id],
          claim.id,
        );
      if (claim.kind === 'procedure') {
        const observation = observations.find(
          (entry) => entry.evidenceId === id && entry.jobId === input.jobId,
        );
        if (item.status !== 'observed' || !observation?.appStep || !item.artifactIds.length)
          add(
            'UNOBSERVED_PROCEDURE',
            'Tutorial steps require observed app actions and retained proof.',
            [id],
            claim.id,
          );
      }
    }
  }
  if (!input.claims)
    for (const id of report.evidenceIds) {
      const item = evidence.find((entry) => entry.id === id);
      if (item && ['contradicted', 'unverified'].includes(item.status))
        add(
          'UNSUPPORTED_EVIDENCE',
          'Research contains unsupported evidence without an explicit uncertainty claim.',
          [id],
        );
    }
  return researchAssessmentSchema.parse({
    schemaVersion: 1,
    jobId: input.jobId,
    reportId: report.id,
    ready: issues.length === 0,
    issues,
  });
}
