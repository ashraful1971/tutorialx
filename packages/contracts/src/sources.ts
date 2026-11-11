import { z } from 'zod';
import {
  digestSchema,
  idSchema,
  microsecondsSchema,
  positiveIntegerSchema,
  recordShape,
} from './common.js';

export const inputReferenceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('text'), text: z.string().min(1).max(100_000) }),
  z.strictObject({ kind: z.literal('url'), url: z.httpUrl() }),
  z.strictObject({
    kind: z.enum(['file', 'directory', 'codebase', 'media']),
    path: z.string().min(1).max(4096),
    copy: z.boolean(),
  }),
]);

export const sourceManifestSchema = z.strictObject({
  ...recordShape,
  jobId: idSchema,
  input: inputReferenceSchema,
  contentHash: digestSchema.nullable(),
  sourceRevision: z.string().max(500).nullable(),
  status: z.enum(['pending', 'available', 'inaccessible', 'unsupported', 'missing']),
  snapshotArtifactId: idSchema.nullable(),
  reason: z.string().max(2000).nullable(),
  attribution: z.strictObject({
    origin: z.string().max(4096),
    license: z.string().max(500).nullable(),
    requiredText: z.string().max(2000).nullable(),
    usage: z.enum(['permitted', 'unknown', 'restricted']),
  }),
});

export const sourceRegistrationSchema = sourceManifestSchema
  .pick({ input: true, attribution: true, sourceRevision: true })
  .partial({ sourceRevision: true });

export const evidenceLocatorSchema = z
  .discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('whole') }),
    z.strictObject({
      kind: z.literal('lines'),
      start: positiveIntegerSchema,
      end: positiveIntegerSchema,
    }),
    z.strictObject({ kind: z.literal('page'), page: positiveIntegerSchema }),
    z.strictObject({ kind: z.literal('selector'), selector: z.string().min(1).max(1000) }),
    z.strictObject({
      kind: z.literal('time'),
      startUs: microsecondsSchema,
      endUs: microsecondsSchema,
    }),
  ])
  .refine((value) => {
    if (value.kind === 'lines') return value.end >= value.start;
    if (value.kind === 'time') return value.endUs > value.startUs;
    return true;
  }, 'Evidence range is invalid.');

export const evidenceRecordSchema = z.strictObject({
  ...recordShape,
  jobId: idSchema,
  sourceId: idSchema,
  sourceHash: digestSchema,
  locator: evidenceLocatorSchema,
  claim: z.string().min(1).max(2000),
  extract: z.string().max(4000),
  status: z.enum(['supplied', 'inferred', 'observed', 'contradicted', 'unverified']),
  artifactIds: z.array(idSchema).max(100),
  limitations: z.array(z.string().min(1).max(1000)).max(100),
});

export const researchReportSchema = z.strictObject({
  ...recordShape,
  jobId: idSchema,
  basedOnRevision: positiveIntegerSchema,
  sourceIds: z.array(idSchema).max(1000),
  evidenceIds: z.array(idSchema).max(5000),
  summary: z.string().min(1).max(30_000),
  blockers: z.array(z.string().min(1).max(2000)).max(100),
});

export type InputReference = z.infer<typeof inputReferenceSchema>;
export type SourceManifest = z.infer<typeof sourceManifestSchema>;
export type SourceRegistration = z.infer<typeof sourceRegistrationSchema>;
export type EvidenceRecord = z.infer<typeof evidenceRecordSchema>;
export type ResearchReport = z.infer<typeof researchReportSchema>;
