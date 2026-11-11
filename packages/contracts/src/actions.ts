import { z } from 'zod';
import { digestSchema, idSchema, jsonObjectSchema, positiveIntegerSchema } from './common.js';
import { waitReasonSchema } from './execution.js';

export const API_VERSION = 1 as const;
export const actionNameSchema = z
  .string()
  .max(200)
  .regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/);
export const cursorSchema = z
  .string()
  .min(1)
  .max(1024)
  .regex(/^[A-Za-z0-9_-]+$/);
export const paginationSchema = z.strictObject({
  cursor: cursorSchema.nullable(),
  limit: z.number().int().min(1).max(100),
});

export const ERROR_EXIT_CODES = {
  INVALID_INPUT: 2,
  MISSING_PREREQUISITE: 3,
  NEEDS_APPROVAL: 4,
  REVISION_CONFLICT: 5,
  POLICY_DENIED: 6,
  BUDGET_EXCEEDED: 7,
  PROVIDER_FAILED: 8,
  CANCELLED: 9,
  INTERNAL_ERROR: 10,
  NOT_FOUND: 11,
  NEEDS_INPUT: 12,
  AUTH_REQUIRED: 13,
  CAPABILITY_UNAVAILABLE: 14,
  UNCERTAIN_OUTCOME: 15,
} as const;

export type ActionErrorCode = keyof typeof ERROR_EXIT_CODES;
export const actionErrorCodeSchema = z.enum(
  Object.keys(ERROR_EXIT_CODES) as [ActionErrorCode, ...ActionErrorCode[]],
);
export const mutationPreconditionSchema = z.strictObject({
  expectedRevision: positiveIntegerSchema,
  idempotencyKey: digestSchema,
});

export const actionRequestSchema = z.strictObject({
  apiVersion: z.literal(API_VERSION),
  requestId: idSchema,
  action: actionNameSchema,
  params: jsonObjectSchema,
  expectedRevision: positiveIntegerSchema.nullable(),
  idempotencyKey: digestSchema.nullable(),
});

export const nextActionSchema = z.strictObject({
  action: actionNameSchema,
  description: z.string().min(1).max(1000),
  params: jsonObjectSchema,
  needsOperator: z.boolean(),
});

const responseShape = {
  apiVersion: z.literal(API_VERSION),
  requestId: idSchema,
  nextActions: z.array(nextActionSchema).max(50),
};

export const actionErrorSchema = z.strictObject({
  code: actionErrorCodeSchema,
  message: z.string().min(1).max(4000),
  retryable: z.boolean(),
  details: jsonObjectSchema,
});

export const actionResponseSchema = z.discriminatedUnion('status', [
  z.strictObject({ ...responseShape, status: z.literal('ok'), data: jsonObjectSchema }),
  z.strictObject({
    ...responseShape,
    status: z.literal('accepted'),
    operationId: idSchema,
    data: jsonObjectSchema,
  }),
  z.strictObject({
    ...responseShape,
    status: z.literal('waiting'),
    reason: waitReasonSchema,
    code: actionErrorCodeSchema,
    jobId: idSchema.nullable(),
    data: jsonObjectSchema,
  }),
  z.strictObject({ ...responseShape, status: z.literal('error'), error: actionErrorSchema }),
]);

export const actionDescriptorSchema = z.strictObject({
  name: actionNameSchema,
  description: z.string().min(1).max(2000),
  inputSchemaId: z.string().min(1).max(200),
  outputSchemaId: z.string().min(1).max(200),
  readOnly: z.boolean(),
  asynchronous: z.boolean(),
  requiredCapabilities: z.array(z.string().min(1).max(200)).max(100),
  requiresRevision: z.boolean(),
  requiresIdempotency: z.boolean(),
});

export function pageSchema<Item extends z.ZodType>(item: Item) {
  return z.strictObject({ items: z.array(item).max(100), nextCursor: cursorSchema.nullable() });
}

export type ActionRequest = z.infer<typeof actionRequestSchema>;
export type ActionResponse = z.infer<typeof actionResponseSchema>;
export type ActionDescriptor = z.infer<typeof actionDescriptorSchema>;
export type NextAction = z.infer<typeof nextActionSchema>;
export type Pagination = z.infer<typeof paginationSchema>;

export function actionExitCode(response: ActionResponse): number {
  if (response.status === 'error') return ERROR_EXIT_CODES[response.error.code];
  if (response.status === 'waiting') return ERROR_EXIT_CODES[response.code];
  return 0;
}
