import { z } from 'zod';
import { recipeSchema, settingsSchema } from './settings.js';

export const doctorInputSchema = z.strictObject({
  settings: settingsSchema,
  captureRequired: z.boolean().optional(),
  headless: z.boolean().optional(),
  generateAssets: z.boolean().optional(),
  suppliedCaptionTimings: z.boolean().optional(),
});

export const doctorCheckSchema = z.strictObject({
  kind: z.enum(['provider', 'dependency', 'runtime']),
  id: z.string().min(1).max(400),
  status: z.enum(['ready', 'missing', 'unsupported', 'error', 'skipped']),
  required: z.boolean(),
  message: z.string().min(1).max(2000),
  remedy: z.string().max(2000),
});

export const doctorReportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  recipe: recipeSchema,
  ready: z.boolean(),
  checks: z.array(doctorCheckSchema).max(1000),
  nextActions: z.array(z.string().min(1).max(2000)).max(100),
});

export type DoctorInput = z.infer<typeof doctorInputSchema>;
export type DoctorCheck = z.infer<typeof doctorCheckSchema>;
export type DoctorReport = z.infer<typeof doctorReportSchema>;
