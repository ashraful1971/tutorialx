import {
  canonicalJson,
  digestSchema,
  type JsonObject,
  type StageInput,
  type StageLineage,
  stageInputSchema,
  stageLineageSchema,
  type WorkflowGraph,
} from '@tutorialx/contracts';
import { validateWorkflowGraph } from './workflow.js';

export type InputFingerprinter = (value: JsonObject) => string;
const sorted = <Value>(values: Record<string, Value>) =>
  Object.fromEntries(Object.entries(values).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

export function computeStageLineage(
  inputs: readonly StageInput[],
  fingerprint: InputFingerprinter,
): StageLineage[] {
  if (!inputs.length || inputs.length > 10_000)
    throw new Error('Supply a bounded set of stage inputs.');
  const parsed = inputs.map((value) => stageInputSchema.parse(value));
  const nodes = new Map(parsed.map((input) => [input.stageId, input]));
  if (nodes.size !== parsed.length) throw new Error('Duplicate stage input identity.');
  const consumers = new Map<string, string[]>();
  const counts = new Map<string, number>();
  for (const input of parsed) {
    counts.set(input.stageId, input.dataDependencies.length);
    for (const dependency of input.dataDependencies) {
      if (!nodes.has(dependency)) throw new Error('Lineage references a missing stage.');
      const list = consumers.get(dependency) ?? [];
      list.push(input.stageId);
      consumers.set(dependency, list);
    }
  }
  const ready = parsed
    .filter((input) => input.dataDependencies.length === 0)
    .map((input) => input.stageId)
    .sort();
  const result = new Map<string, StageLineage>();
  const hash = (value: JsonObject) => digestSchema.parse(fingerprint(value));
  for (let index = 0; index < ready.length; index++) {
    const input = nodes.get(ready[index]!)!;
    const payload = {
      schemaVersion: 1 as const,
      stageId: input.stageId,
      kind: input.kind,
      implementationVersion: input.implementationVersion,
      settingsDigest: hash(input.settings),
      parametersDigest: hash(input.parameters),
      sourceDigests: sorted(input.sourceDigests),
      artifactDigests: sorted(input.artifactDigests),
      templateDigests: sorted(input.templateDigests),
      provider:
        input.provider === null
          ? null
          : {
              id: input.provider.id,
              version: input.provider.version,
              configurationDigest: hash({
                config: input.provider.config,
                credentialRef: input.provider.credentialRef,
              }),
            },
      dependencies: sorted(
        Object.fromEntries(input.dataDependencies.map((id) => [id, result.get(id)!.inputDigest])),
      ),
    };
    result.set(input.stageId, stageLineageSchema.parse({ ...payload, inputDigest: hash(payload) }));
    for (const child of (consumers.get(input.stageId) ?? []).sort()) {
      const left = counts.get(child)! - 1;
      counts.set(child, left);
      if (left === 0) ready.push(child);
    }
  }
  if (result.size !== parsed.length) throw new Error('Lineage contains a dependency cycle.');
  return [...result.values()].sort((a, b) =>
    a.stageId < b.stageId ? -1 : a.stageId > b.stageId ? 1 : 0,
  );
}

export function validateStageLineage(
  records: readonly StageLineage[],
  fingerprint: InputFingerprinter,
): StageLineage[] {
  const parsed = records.map((value) => stageLineageSchema.parse(value));
  const map = new Map(parsed.map((record) => [record.stageId, record]));
  if (map.size !== parsed.length) throw new Error('Duplicate lineage identity.');
  for (const record of parsed) {
    const { inputDigest, ...payload } = record;
    if (fingerprint(payload) !== inputDigest)
      throw new Error('Lineage fingerprint does not match its versioned inputs.');
    for (const [id, digest] of Object.entries(record.dependencies))
      if (map.get(id)?.inputDigest !== digest)
        throw new Error('Lineage dependency fingerprint is stale or missing.');
  }
  return parsed;
}

export function bindWorkflowLineage(
  graphInput: WorkflowGraph,
  records: readonly StageLineage[],
  fingerprint: InputFingerprinter,
): WorkflowGraph {
  const graph = validateWorkflowGraph(graphInput);
  const lineage = validateStageLineage(records, fingerprint);
  const nodes = new Map(graph.stages.map((stage) => [stage.id, stage]));
  if (lineage.length !== nodes.size)
    throw new Error('Every workflow stage requires exactly one input lineage.');
  for (const record of lineage) {
    const node = nodes.get(record.stageId);
    if (!node || node.kind !== record.kind)
      throw new Error('Lineage belongs to another workflow stage/kind.');
    const ancestors = new Set<string>();
    const remaining = new Set(Object.keys(record.dependencies));
    const queue = [...node.dependencies];
    for (let index = 0; index < queue.length && remaining.size > 0; index++) {
      const id = queue[index]!;
      if (ancestors.has(id)) continue;
      ancestors.add(id);
      remaining.delete(id);
      queue.push(...nodes.get(id)!.dependencies);
    }
    if (remaining.size) throw new Error('A data dependency is not ordered by the workflow graph.');
    node.inputDigest = record.inputDigest;
  }
  return graph;
}

export interface LineageChanges {
  changed: string[];
  added: string[];
  removed: string[];
  preserved: string[];
  reasons: Record<string, string[]>;
}
export function diffStageLineage(
  previousInput: readonly StageLineage[],
  nextInput: readonly StageLineage[],
  fingerprint: InputFingerprinter,
): LineageChanges {
  const previous = validateStageLineage(previousInput, fingerprint);
  const next = validateStageLineage(nextInput, fingerprint);
  const old = new Map(previous.map((record) => [record.stageId, record]));
  const changes: LineageChanges = {
    changed: [],
    added: [],
    removed: [],
    preserved: [],
    reasons: {},
  };
  for (const record of next) {
    const before = old.get(record.stageId);
    if (!before) {
      changes.added.push(record.stageId);
      changes.changed.push(record.stageId);
      changes.reasons[record.stageId] = ['added'];
    } else if (before.inputDigest === record.inputDigest) changes.preserved.push(record.stageId);
    else {
      changes.changed.push(record.stageId);
      const reasons: string[] = [];
      for (const key of [
        'kind',
        'implementationVersion',
        'settingsDigest',
        'parametersDigest',
        'sourceDigests',
        'artifactDigests',
        'templateDigests',
        'provider',
        'dependencies',
      ] as const) {
        if (canonicalJson({ value: before[key] }) !== canonicalJson({ value: record[key] }))
          reasons.push(key);
      }
      changes.reasons[record.stageId] = reasons;
    }
  }
  const current = new Set(next.map((record) => record.stageId));
  for (const record of previous)
    if (!current.has(record.stageId)) {
      changes.removed.push(record.stageId);
      changes.reasons[record.stageId] = ['removed'];
    }
  for (const values of [changes.changed, changes.added, changes.removed, changes.preserved])
    values.sort();
  return changes;
}
