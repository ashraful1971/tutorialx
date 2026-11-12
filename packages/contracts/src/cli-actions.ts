import { z } from 'zod';
import { cursorSchema } from './actions.js';
import { idSchema, positiveIntegerSchema, recordShape } from './common.js';
import { doctorInputSchema } from './doctor.js';
import { INSPECTION_ACTION_SCHEMAS } from './inspection.js';
import { jobCreationSchema, planRevisionSchema } from './planning.js';
import { qualityFindingSchema, reviewResultSchema } from './quality.js';
import { SKILL_ACTION_SCHEMAS } from './skill-actions.js';
import { evidenceRecordSchema, researchReportSchema, sourceRegistrationSchema } from './sources.js';

export const workspaceInitInputSchema = z.strictObject({
  contentRoot: z.string().min(1).max(4096).optional(),
  sourceRoots: z.array(z.string().min(1).max(4096)).min(1).max(100).optional(),
});
export const jobIdentityInputSchema = z.strictObject({ jobId: idSchema });
const rangeShape = {
  offset: z
    .number()
    .int()
    .min(0)
    .max(1024 * 1024)
    .optional(),
  length: z.number().int().min(1).max(65_536).optional(),
};
export const jobInspectInputSchema = jobIdentityInputSchema.extend(rangeShape);
export const listInputSchema = z.strictObject({
  cursor: cursorSchema.nullable().default(null),
  limit: z.number().int().min(1).max(100).default(10),
});
export const sourceCreateInputSchema = z.strictObject({
  jobId: idSchema,
  source: sourceRegistrationSchema,
});
export const sourceInspectInputSchema = z.strictObject({ jobId: idSchema, sourceId: idSchema });
export const sourceListInputSchema = listInputSchema.extend({ jobId: idSchema });
export const jobContextInputSchema = z.strictObject({
  jobId: idSchema,
  role: z.enum(['researcher', 'writer-director', 'reviewer', 'repair']).default('researcher'),
  ...rangeShape,
});
export const revisionFeedbackSchema = z.strictObject({
  ...recordShape,
  jobId: idSchema,
  basedOnRevision: positiveIntegerSchema,
  planRevision: positiveIntegerSchema,
  sceneIds: z.array(idSchema).max(100),
  feedback: z.string().min(1).max(20_000),
  evidenceIds: z.array(idSchema).max(100),
});
export const jobSubmitInputSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    jobId: idSchema,
    kind: z.literal('research'),
    report: researchReportSchema,
    evidence: z.array(evidenceRecordSchema).max(1000),
  }),
  z.strictObject({ jobId: idSchema, kind: z.literal('plan'), plan: planRevisionSchema }),
  z.strictObject({
    jobId: idSchema,
    kind: z.literal('review'),
    review: reviewResultSchema,
    findings: z.array(qualityFindingSchema).max(1000),
  }),
  z.strictObject({
    jobId: idSchema,
    kind: z.literal('feedback'),
    feedback: revisionFeedbackSchema,
  }),
]);
export const submissionInspectInputSchema = z.strictObject({
  jobId: idSchema,
  submissionId: idSchema,
  ...rangeShape,
});
export const schemaInputSchema = z.strictObject({ name: z.string().min(1).max(200) });
export const planShowInputSchema = z.strictObject({
  jobId: idSchema,
  revision: positiveIntegerSchema.optional(),
  ...rangeShape,
});
export const planDiffInputSchema = z.strictObject({
  jobId: idSchema,
  beforeRevision: positiveIntegerSchema,
  afterRevision: positiveIntegerSchema,
});
export const planApproveInputSchema = z.strictObject({
  jobId: idSchema,
  planRevision: positiveIntegerSchema,
  decision: z.literal('approve'),
  expiresAt: z.iso.datetime().nullable().default(null),
});
export const planReviseInputSchema = z.strictObject({ jobId: idSchema, plan: planRevisionSchema });

/** Transport-independent action inputs; all transports use this exact registry. */
export const FOUNDATION_ACTION_SCHEMAS = {
  ...INSPECTION_ACTION_SCHEMAS,
  ...SKILL_ACTION_SCHEMAS,
  'workspace.init': workspaceInitInputSchema,
  'job.create': jobCreationSchema,
  'job.inspect': jobInspectInputSchema,
  'job.list': listInputSchema,
  'job.context': jobContextInputSchema,
  'job.submit': jobSubmitInputSchema,
  'job.submission': submissionInspectInputSchema,
  'source.create': sourceCreateInputSchema,
  'source.inspect': sourceInspectInputSchema,
  'source.list': sourceListInputSchema,
  capabilities: z.strictObject({}),
  schema: schemaInputSchema,
  doctor: doctorInputSchema,
  'plan.show': planShowInputSchema,
  'plan.diff': planDiffInputSchema,
  'plan.approve': planApproveInputSchema,
  'plan.revise': planReviseInputSchema,
  'job.run': jobIdentityInputSchema,
  'job.pause': jobIdentityInputSchema,
  'job.resume': jobIdentityInputSchema,
  'job.cancel': jobIdentityInputSchema,
  'job.retry': jobIdentityInputSchema,
  'job.check': jobIdentityInputSchema,
  'job.export': jobIdentityInputSchema,
} as const;

export type JobSubmission = z.infer<typeof jobSubmitInputSchema>;

export function foundationActionSchema(name: keyof typeof FOUNDATION_ACTION_SCHEMAS) {
  return {
    $id: `urn:tutorialx:action:1:${name}:input`,
    ...z.toJSONSchema(FOUNDATION_ACTION_SCHEMAS[name], { target: 'draft-2020-12', io: 'input' }),
  };
}
