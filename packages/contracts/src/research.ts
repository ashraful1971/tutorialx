import { z } from 'zod';
import { digestSchema, idSchema, positiveIntegerSchema, recordShape } from './common.js';
import { executionPolicySchema } from './settings.js';
import { evidenceLocatorSchema, evidenceRecordSchema, researchReportSchema } from './sources.js';

/** Sidecar records preserve the existing strict v1 source/evidence/report schemas. */
export const researchEvidenceObservationSchema = z.strictObject({
  ...recordShape,
  jobId: idSchema,
  evidenceId: idSchema,
  subjectId: idSchema,
  origin: z.enum(['supplied', 'inferred', 'observed']),
  contradictsEvidenceIds: z.array(idSchema).max(100),
  appStep: z
    .strictObject({
      target: z.httpUrl(),
      stepId: idSchema,
      action: z.string().min(1).max(1000),
      expectedResult: z.string().min(1).max(2000),
      observedResult: z.string().min(1).max(2000),
    })
    .nullable(),
});

export const researchConflictSchema = z.strictObject({
  ...recordShape,
  jobId: idSchema,
  subjectId: idSchema,
  evidenceIds: z.array(idSchema).min(2).max(100),
  material: z.boolean(),
  resolution: z
    .strictObject({
      kind: z.enum(['corrected', 'removed', 'uncertainty']),
      acceptedEvidenceIds: z.array(idSchema).max(100),
      reason: z.string().min(1).max(2000),
    })
    .nullable(),
});

export const researchClaimUseSchema = z.strictObject({
  id: idSchema,
  subjectId: idSchema,
  kind: z.enum(['fact', 'explanation', 'procedure']),
  framing: z.enum(['asserted', 'uncertain']),
  evidenceIds: z.array(idSchema).min(1).max(100),
});

export const externalResearchSubmissionSchema = z.strictObject({
  jobId: idSchema,
  kind: z.literal('research'),
  report: researchReportSchema,
  evidence: z.array(evidenceRecordSchema).max(1000),
  observations: z.array(researchEvidenceObservationSchema).max(1000),
  conflicts: z.array(researchConflictSchema).max(100),
});

export const researchAssessmentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  jobId: idSchema,
  reportId: idSchema,
  ready: z.boolean(),
  issues: z
    .array(
      z.strictObject({
        code: z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/),
        evidenceIds: z.array(idSchema).max(100),
        claimId: idSchema.nullable(),
        conflictId: idSchema.nullable(),
        message: z.string().min(1).max(2000),
      }),
    )
    .max(1000),
});

export const researchTaskPackSchema = z.strictObject({
  schemaVersion: z.literal(1),
  jobId: idSchema,
  basedOnRevision: positiveIntegerSchema,
  topic: z.string().min(1).max(20_000),
  audience: z.string().min(1).max(1000),
  instructionAuthority: z.literal('engine-only'),
  sourceContentAuthority: z.literal('untrusted-data'),
  policySnapshot: executionPolicySchema,
  allowedActions: z
    .array(
      z.enum(['job.inspect', 'job.submit', 'research.submit', 'source.inspect', 'source.list']),
    )
    .max(5),
  outputSchemaId: z.literal('urn:tutorialx:schema:1:ExternalResearchSubmission'),
  limits: z.strictObject({
    maxOutputBytes: positiveIntegerSchema.max(1024 * 1024),
    maxTaskBytes: positiveIntegerSchema.max(256 * 1024),
    remainingResearchBudgetUsdMicros: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    deadlineAt: z.iso.datetime().nullable(),
  }),
  sources: z
    .array(
      z.strictObject({
        sourceId: idSchema,
        status: z.enum(['pending', 'available', 'inaccessible', 'unsupported', 'missing']),
        reason: z.string().max(2000).nullable(),
      }),
    )
    .max(100),
  sourceData: z
    .array(
      z.strictObject({
        sourceId: idSchema,
        sourceHash: digestSchema,
        locator: evidenceLocatorSchema,
        text: z.string().max(4000),
        authority: z.literal('untrusted-data'),
      }),
    )
    .max(100),
  truncated: z.boolean(),
});

export type ResearchEvidenceObservation = z.infer<typeof researchEvidenceObservationSchema>;
export type ResearchConflict = z.infer<typeof researchConflictSchema>;
export type ResearchClaimUse = z.infer<typeof researchClaimUseSchema>;
export type ExternalResearchSubmission = z.infer<typeof externalResearchSubmissionSchema>;
export type ResearchAssessment = z.infer<typeof researchAssessmentSchema>;
export type ResearchTaskPack = z.infer<typeof researchTaskPackSchema>;
