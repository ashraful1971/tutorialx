import { z } from 'zod';

export const CONTRACT_VERSION = 1 as const;
export type ContractVersion = typeof CONTRACT_VERSION;
export const idSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,127}$/);
export const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const timestampSchema = z.iso.datetime();
export const nonnegativeIntegerSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const microsecondsSchema = nonnegativeIntegerSchema;
export const usdMicrosSchema = nonnegativeIntegerSchema;
export const positiveIntegerSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const languageSchema = z.string().regex(/^[a-zA-Z]{2,8}(-[a-zA-Z0-9]{1,8})*$/);
export const jsonObjectSchema = z.record(z.string(), z.json());

export const recordShape = {
  schemaVersion: z.literal(CONTRACT_VERSION),
  id: idSchema,
  createdAt: timestampSchema,
};

export const frameRateSchema = z.strictObject({
  numerator: positiveIntegerSchema.max(240_000),
  denominator: positiveIntegerSchema.max(100_000),
});

export const providerSelectionSchema = z.strictObject({
  id: idSchema,
  version: z.string().min(1).max(100),
  config: jsonObjectSchema,
  credentialRef: idSchema.nullable(),
});

export const profileReferenceSchema = z.strictObject({
  id: idSchema,
  revision: positiveIntegerSchema,
  digest: digestSchema,
});

export type ProviderSelection = z.infer<typeof providerSelectionSchema>;
export type ProfileReference = z.infer<typeof profileReferenceSchema>;
export type FrameRate = z.infer<typeof frameRateSchema>;

export function hasUniqueIds(values: readonly { id: string }[]): boolean {
  return new Set(values.map((value) => value.id)).size === values.length;
}

/** Project canonical JSON v1: sorted UTF-16 object keys, ordered arrays, JSON scalar encoding. */
export function canonicalJson(value: z.infer<typeof jsonObjectSchema>): string {
  const encode = (entry: unknown): string => {
    if (Array.isArray(entry)) return `[${entry.map(encode).join(',')}]`;
    if (entry !== null && typeof entry === 'object')
      return `{${Object.keys(entry)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${encode((entry as Record<string, unknown>)[key])}`)
        .join(',')}}`;
    if (
      entry === null ||
      typeof entry === 'string' ||
      typeof entry === 'boolean' ||
      (typeof entry === 'number' && Number.isFinite(entry))
    )
      return JSON.stringify(entry);
    throw new TypeError('Canonical fingerprints require JSON values.');
  };
  return encode(value);
}
