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
import {
  jobContextInputSchema,
  jobIdentityInputSchema,
  jobInspectInputSchema,
  jobSubmitInputSchema,
  listInputSchema,
  planApproveInputSchema,
  planDiffInputSchema,
  planReviseInputSchema,
  planShowInputSchema,
  revisionFeedbackSchema,
  schemaInputSchema,
  sourceCreateInputSchema,
  sourceInspectInputSchema,
  sourceListInputSchema,
  submissionInspectInputSchema,
  workspaceInitInputSchema,
} from './cli-actions.js';
import { CONTRACT_VERSION } from './common.js';
import { deliveryManifestSchema } from './delivery.js';
import { doctorInputSchema, doctorReportSchema } from './doctor.js';
import {
  executionEventSchema,
  jobStatusSchema,
  operationRecordSchema,
  stageAttemptSchema,
} from './execution.js';
import {
  artifactListInputSchema,
  artifactReadInputSchema,
  eventsInputSchema,
} from './inspection.js';
import {
  currentDeliveryPointerSchema,
  stageInputSchema,
  stageLineageSchema,
  workflowSnapshotSchema,
} from './lineage.js';
import { operationReceiptSchema, operationRetryPolicySchema } from './operations.js';
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
import {
  readerFormatCapabilitySchema,
  sourceMediaMetadataSchema,
  sourceReadReportSchema,
} from './readers.js';
import { recipeDefinitionSchema, resolvedProductionBriefSchema } from './recipes.js';
import {
  externalResearchSubmissionSchema,
  researchAssessmentSchema,
  researchClaimUseSchema,
  researchConflictSchema,
  researchEvidenceObservationSchema,
  researchTaskPackSchema,
} from './research.js';
import { productionScriptSchema, scriptSceneSchema } from './script.js';
import { effectiveSettingsSchema, settingsOverridesSchema, settingsSchema } from './settings.js';
import { skillCommandInputSchema } from './skill-actions.js';
import { managedSkillManifestSchema } from './skill-installation.js';
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
  ScriptScene: scriptSceneSchema,
  ProductionScript: productionScriptSchema,
  RecipeDefinition: recipeDefinitionSchema,
  ResolvedProductionBrief: resolvedProductionBriefSchema,
  JobInspectInput: jobInspectInputSchema,
  PlanShowInput: planShowInputSchema,
  PlanDiffInput: planDiffInputSchema,
  PlanApproveInput: planApproveInputSchema,
  PlanReviseInput: planReviseInputSchema,
  ArtifactListInput: artifactListInputSchema,
  ArtifactReadInput: artifactReadInputSchema,
  EventsInput: eventsInputSchema,
  WorkspaceInitInput: workspaceInitInputSchema,
  JobIdentityInput: jobIdentityInputSchema,
  ListInput: listInputSchema,
  SourceCreateInput: sourceCreateInputSchema,
  SourceInspectInput: sourceInspectInputSchema,
  SourceListInput: sourceListInputSchema,
  JobContextInput: jobContextInputSchema,
  RevisionFeedback: revisionFeedbackSchema,
  JobSubmitInput: jobSubmitInputSchema,
  SubmissionInspectInput: submissionInspectInputSchema,
  SchemaInput: schemaInputSchema,
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
  DoctorInput: doctorInputSchema,
  DoctorReport: doctorReportSchema,
  EffectiveSettings: effectiveSettingsSchema,
  EvidenceRecord: evidenceRecordSchema,
  ExecutionEvent: executionEventSchema,
  JobBrief: jobBriefSchema,
  JobCreation: jobCreationSchema,
  JobProjection: jobProjectionSchema,
  JobStatus: jobStatusSchema,
  ManagedSkillManifest: managedSkillManifestSchema,
  SkillCommandInput: skillCommandInputSchema,
  OperationRecord: operationRecordSchema,
  OperationReceipt: operationReceiptSchema,
  OperationRetryPolicy: operationRetryPolicySchema,
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
  ReaderFormatCapability: readerFormatCapabilitySchema,
  SourceMediaMetadata: sourceMediaMetadataSchema,
  SourceReadReport: sourceReadReportSchema,
  RenderResult: renderResultSchema,
  ResearchReport: researchReportSchema,
  ExternalResearchSubmission: externalResearchSubmissionSchema,
  ResearchAssessment: researchAssessmentSchema,
  ResearchClaimUse: researchClaimUseSchema,
  ResearchConflict: researchConflictSchema,
  ResearchEvidenceObservation: researchEvidenceObservationSchema,
  ResearchTaskPack: researchTaskPackSchema,
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
