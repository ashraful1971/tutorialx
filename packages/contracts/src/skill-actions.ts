import { z } from 'zod';
import { digestSchema } from './common.js';
import { skillHostSchema } from './skill-installation.js';

export const skillCommandInputSchema = z
  .strictObject({
    host: skillHostSchema,
    rootDirectory: z.string().min(1).max(4096).optional(),
    packageRoot: z.string().min(1).max(4096).optional(),
    version: z.string().min(1).max(100).optional(),
    apply: z.boolean().default(false),
    fingerprint: digestSchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.apply && !value.fingerprint)
      context.addIssue({
        code: 'custom',
        path: ['fingerprint'],
        message: 'Apply requires the fingerprint of a reviewed preview.',
      });
    if (value.packageRoot && !value.version)
      context.addIssue({
        code: 'custom',
        path: ['version'],
        message: 'A supplied package requires its explicit version.',
      });
    if (value.host === 'generic' && !value.rootDirectory)
      context.addIssue({
        code: 'custom',
        path: ['rootDirectory'],
        message: 'Generic hosts require an explicit skills root.',
      });
  });

export const SKILL_ACTION_SCHEMAS = {
  'skill.install': skillCommandInputSchema,
  'skill.update': skillCommandInputSchema,
  'skill.remove': skillCommandInputSchema,
} as const;
export type SkillCommandInput = z.infer<typeof skillCommandInputSchema>;
