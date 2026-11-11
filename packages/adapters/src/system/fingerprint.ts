import { createHash } from 'node:crypto';
import { canonicalJson, type JsonObject, jsonObjectSchema } from '@tutorialx/contracts';

export function fingerprintJson(value: JsonObject): string {
  return createHash('sha256')
    .update(canonicalJson(jsonObjectSchema.parse(value)))
    .digest('hex');
}
