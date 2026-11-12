import type { JsonObject } from '@tutorialx/contracts';

const secretKey =
  /(?:password|passwd|secret|token|authorization|cookie|api[-_]?key|credential[-_]?value)/i;
const forbiddenKeys = new Set(['__proto__', 'constructor', 'prototype']);

/** Public diagnostics only. The caller supplies resolved known secrets without persisting them. */
export function redactPublicValue(value: unknown, knownSecrets: readonly string[] = []): unknown {
  const secrets = [...new Set(knownSecrets.filter((item) => item.length > 0))].sort(
    (a, b) => b.length - a.length,
  );
  function text(value: string): string {
    let result = value;
    for (const secret of secrets) result = result.split(secret).join('[REDACTED]');
    return result
      .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]')
      .replace(/([?&](?:token|api_key|key|password|secret)=)[^&#\s]*/gi, '$1[REDACTED]')
      .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@');
  }
  function visit(item: unknown, depth: number): unknown {
    if (depth > 30) return '[TRUNCATED]';
    if (typeof item === 'string') return text(item);
    if (Array.isArray(item)) return item.map((child) => visit(child, depth + 1));
    if (item !== null && typeof item === 'object') {
      const result: JsonObject = {};
      for (const [key, child] of Object.entries(item)) {
        if (forbiddenKeys.has(key)) continue;
        result[text(key)] = (
          secretKey.test(key) ? '[REDACTED]' : visit(child, depth + 1)
        ) as JsonObject[string];
      }
      return result;
    }
    return item;
  }
  return visit(value, 0);
}
