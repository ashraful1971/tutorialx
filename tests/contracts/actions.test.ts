import {
  actionExitCode,
  actionRequestSchema,
  actionResponseSchema,
  ERROR_EXIT_CODES,
  mutationPreconditionSchema,
  PUBLIC_SCHEMAS,
  paginationSchema,
  publicSchema,
  schemaCatalog,
} from '@tutorialx/contracts';
import { describe, expect, it } from 'vitest';
import { digest } from '../fixtures/contracts.js';

describe('mechanical action protocol', () => {
  it('validates read and revision-bound mutation envelopes', () => {
    const request = {
      apiVersion: 1,
      requestId: 'request',
      action: 'job.show',
      params: { jobId: 'job' },
      expectedRevision: null,
      idempotencyKey: null,
    };
    expect(actionRequestSchema.parse(request)).toEqual(request);
    expect(
      mutationPreconditionSchema.safeParse({ expectedRevision: 1, idempotencyKey: digest }).success,
    ).toBe(true);
    expect(
      mutationPreconditionSchema.safeParse({ expectedRevision: null, idempotencyKey: null })
        .success,
    ).toBe(false);
    expect(actionRequestSchema.safeParse({ ...request, actor: 'operator' }).success).toBe(false);
    expect(actionRequestSchema.safeParse({ ...request, apiVersion: 2 }).success).toBe(false);
  });

  it('distinguishes accepted operations from completed actions', () => {
    const accepted = actionResponseSchema.parse({
      apiVersion: 1,
      requestId: 'request',
      status: 'accepted',
      operationId: 'operation',
      data: { jobId: 'job' },
      nextActions: [],
    });
    expect(actionExitCode(accepted)).toBe(0);
    expect(accepted.status).toBe('accepted');
    expect(
      actionResponseSchema.safeParse({
        apiVersion: 1,
        requestId: 'request',
        status: 'accepted',
        data: {},
        nextActions: [],
      }).success,
    ).toBe(false);
  });

  it('maps each stable error and wait to a distinct exit code', () => {
    expect(new Set(Object.values(ERROR_EXIT_CODES)).size).toBe(
      Object.keys(ERROR_EXIT_CODES).length,
    );
    for (const [code, exitCode] of Object.entries(ERROR_EXIT_CODES)) {
      const response = actionResponseSchema.parse({
        apiVersion: 1,
        requestId: 'request',
        status: 'error',
        error: { code, message: 'Action failed', retryable: false, details: {} },
        nextActions: [],
      });
      expect(actionExitCode(response)).toBe(exitCode);
    }
    const waiting = actionResponseSchema.parse({
      apiVersion: 1,
      requestId: 'request',
      status: 'waiting',
      reason: 'approval',
      code: 'NEEDS_APPROVAL',
      jobId: 'job',
      data: {},
      nextActions: [],
    });
    expect(actionExitCode(waiting)).toBe(ERROR_EXIT_CODES.NEEDS_APPROVAL);
  });

  it('bounds pagination and rejects filesystem paths masquerading as cursors', () => {
    expect(paginationSchema.safeParse({ cursor: null, limit: 100 }).success).toBe(true);
    expect(paginationSchema.safeParse({ cursor: '../private', limit: 1 }).success).toBe(false);
    expect(paginationSchema.safeParse({ cursor: null, limit: 1000 }).success).toBe(false);
  });

  it('exports deterministic JSON schemas for every public record', () => {
    const first = schemaCatalog();
    expect(JSON.stringify(first)).toBe(JSON.stringify(schemaCatalog()));
    expect(Object.keys(first.schemas).length).toBe(Object.keys(PUBLIC_SCHEMAS).length);
    expect(publicSchema('JobBrief')).toMatchObject({
      $id: 'urn:tutorialx:schema:1:JobBrief',
      type: 'object',
      additionalProperties: false,
    });
    expect(publicSchema('ActionRequest')).toMatchObject({ type: 'object' });
  });
});
