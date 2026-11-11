import { z } from 'zod';
import {
  actionDescriptorSchema,
  actionRequestSchema,
  actionResponseSchema,
  paginationSchema,
} from './actions.js';
import { approvalRecordSchema } from './approval.js';
import { artifactLineageSchema, stagedArtifactSchema } from './artifact-staging.js';
import { artifactManifestSchema } from './artifacts.js';
import { batchManifestSchema } from './batch.js';
import { CONTRACT_VERSION } from './common.js';
import { deliveryManifestSchema } from './delivery.js';
import {
  executionEventSchema,
  jobStatusSchema,
  operationRecordSchema,
  stageAttemptSchema,
} from './execution.js';
import {
  currentDeliveryPointerSchema,
  stageInputSchema,
  stageLineageSchema,
  workflowSnapshotSchema,
} from './lineage.js';
import {
  jobBriefSchema,
  jobCreationSchema,
  planRevisionSchema,
  scenePlanSchema,
} from './planning.js';
import { jobProjectionSchema, planProjectionSchema } from './projections.js';
import { costEstimateSchema, providerDescriptorSchema } from './providers/descriptor.js';
import {
  agentTaskResultSchema,
  alignmentResultSchema,
  assetResultSchema,
  captureResultSchema,
  readerResultSchema,
  renderResultSchema,
  voiceResultSchema,
} from './providers/responses.js';
import {
  providerCandidateSchema,
  providerFallbackPolicySchema,
  providerRequirementsSchema,
} from './providers/selection.js';
import { qualityFindingSchema, qualityProfileSchema, reviewResultSchema } from './quality.js';
import { effectiveSettingsSchema, settingsOverridesSchema, settingsSchema } from './settings.js';
import {
  evidenceRecordSchema,
  researchReportSchema,
  sourceManifestSchema,
  sourceRegistrationSchema,
} from './sources.js';
import { captionTrackSchema, timelineSchema } from './timeline.js';
import { stageDefinitionSchema, workflowGraphSchema } from './workflow.js';
import { profileSchema, workspaceConfigSchema } from './workspace.js';

export const PUBLIC_SCHEMAS = {
  ActionDescriptor: actionDescriptorSchema,
  ActionRequest: actionRequestSchema,
  ActionResponse: actionResponseSchema,
  AgentTaskResult: agentTaskResultSchema,
  AlignmentResult: alignmentResultSchema,
  ApprovalRecord: approvalRecordSchema,
  ArtifactManifest: artifactManifestSchema,
  ArtifactLineage: artifactLineageSchema,
  AssetResult: assetResultSchema,
  BatchManifest: batchManifestSchema,
  CaptionTrack: captionTrackSchema,
  CaptureResult: captureResultSchema,
  CostEstimate: costEstimateSchema,
  CurrentDeliveryPointer: currentDeliveryPointerSchema,
  DeliveryManifest: deliveryManifestSchema,
  EffectiveSettings: effectiveSettingsSchema,
  EvidenceRecord: evidenceRecordSchema,
  ExecutionEvent: executionEventSchema,
  JobBrief: jobBriefSchema,
  JobCreation: jobCreationSchema,
  JobProjection: jobProjectionSchema,
  JobStatus: jobStatusSchema,
  OperationRecord: operationRecordSchema,
  Pagination: paginationSchema,
  PlanRevision: planRevisionSchema,
  PlanProjection: planProjectionSchema,
  Profile: profileSchema,
  ProviderDescriptor: providerDescriptorSchema,
  ProviderCandidate: providerCandidateSchema,
  ProviderFallbackPolicy: providerFallbackPolicySchema,
  ProviderRequirements: providerRequirementsSchema,
  QualityFinding: qualityFindingSchema,
  QualityProfile: qualityProfileSchema,
  ReaderResult: readerResultSchema,
  RenderResult: renderResultSchema,
  ResearchReport: researchReportSchema,
  ReviewResult: reviewResultSchema,
  ScenePlan: scenePlanSchema,
  Settings: settingsSchema,
  SettingsOverrides: settingsOverridesSchema,
  SourceManifest: sourceManifestSchema,
  SourceRegistration: sourceRegistrationSchema,
  StageAttempt: stageAttemptSchema,
  StageInput: stageInputSchema,
  StageLineage: stageLineageSchema,
  StagedArtifact: stagedArtifactSchema,
  StageDefinition: stageDefinitionSchema,
  Timeline: timelineSchema,
  VoiceResult: voiceResultSchema,
  WorkspaceConfig: workspaceConfigSchema,
  WorkflowGraph: workflowGraphSchema,
  WorkflowSnapshot: workflowSnapshotSchema,
} as const;

export type PublicSchemaName = keyof typeof PUBLIC_SCHEMAS;

export function publicSchema(name: PublicSchemaName) {
  return {
    $id: `urn:tutorialx:schema:${CONTRACT_VERSION}:${name}`,
    ...z.toJSONSchema(PUBLIC_SCHEMAS[name], { target: 'draft-2020-12', io: 'input' }),
  };
}

export function schemaCatalog() {
  return {
    contractVersion: CONTRACT_VERSION,
    schemas: Object.fromEntries(
      (Object.keys(PUBLIC_SCHEMAS) as PublicSchemaName[])
        .sort()
        .map((name) => [name, publicSchema(name)]),
    ),
  };
}
