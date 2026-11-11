import { fingerprintJson } from '@tutorialx/adapters';
import { canonicalJson, type StageInput } from '@tutorialx/contracts';
import {
  bindWorkflowLineage,
  computeStageLineage,
  diffStageLineage,
  validateStageLineage,
} from '@tutorialx/core';
import { expect, it } from 'vitest';
import { lineageGraph, lineageInputs, lineageModel, verticalVariant } from '../fixtures/lineage.js';

it('fingerprints canonical JSON independent of object insertion order and preserves array order', () => {
  expect(canonicalJson({ z: { b: 2, a: 1 }, a: ['é', true, null] })).toBe(
    '{"a":["é",true,null],"z":{"a":1,"b":2}}',
  );
  expect(fingerprintJson({ b: 2, a: 1 })).toBe(fingerprintJson({ a: 1, b: 2 }));
  expect(fingerprintJson({ values: [1, 2] })).not.toBe(fingerprintJson({ values: [2, 1] }));
});

it.each([
  [
    'caption style',
    (model: ReturnType<typeof lineageModel>) => {
      model.settings.captions.style.color = '#ff0000';
    },
    ['composition', 'delivery', 'quality', 'render'],
  ],
  [
    'narration',
    (model: ReturnType<typeof lineageModel>) => {
      model.narration = 'A revised explanation.';
    },
    ['alignment', 'composition', 'delivery', 'quality', 'render', 'timeline', 'voice'],
  ],
  [
    'source',
    (model: ReturnType<typeof lineageModel>) => {
      model.sourceId = 'narration_source_v2';
      model.sourceDigest = fingerprintJson({ content: 'Revised source' });
    },
    [
      'alignment',
      'composition',
      'delivery',
      'plan',
      'quality',
      'render',
      'research',
      'timeline',
      'voice',
    ],
  ],
  [
    'aspect ratio',
    (model: ReturnType<typeof lineageModel>) => {
      verticalVariant(model.settings);
    },
    ['composition', 'delivery', 'framing', 'quality', 'render'],
  ],
] as const)(
  'invalidates only consumed inputs and data descendants for a %s change',
  (_name, edit, expected) => {
    const original = lineageModel();
    const next = structuredClone(original);
    edit(next);
    const previous = computeStageLineage(lineageInputs(original), fingerprintJson);
    const changed = computeStageLineage(lineageInputs(next), fingerprintJson);
    const diff = diffStageLineage(previous, changed, fingerprintJson);
    expect(diff.changed).toEqual(expected);
    expect(diff.preserved).toContain('capture');
    if (_name === 'caption style' || _name === 'aspect ratio')
      expect(diff.preserved).toContain('voice');
    expect(
      bindWorkflowLineage(lineageGraph(), changed, fingerprintJson).stages.find(
        (stage) => stage.id === 'render',
      )?.inputDigest,
    ).toBe(changed.find((record) => record.stageId === 'render')?.inputDigest);
  },
);

it('binds provider implementation/configuration, templates, and actual artifact fingerprints', () => {
  const inputs = lineageInputs(lineageModel());
  const previous = computeStageLineage(inputs, fingerprintJson);
  const changed = structuredClone(inputs);
  changed.find((value) => value.stageId === 'voice')!.provider!.config = {
    model: 'other',
    privateParameter: 'synthetic-private-test-value',
  };
  const next = computeStageLineage(changed, fingerprintJson);
  expect(JSON.stringify(next)).not.toContain('synthetic-private-test-value');
  expect(JSON.stringify(next)).not.toContain('named_speech_key');
  expect(diffStageLineage(previous, next, fingerprintJson).changed).toContain('voice');
  const template = structuredClone(inputs);
  template.find((value) => value.stageId === 'render')!.templateDigests.template = 'b'.repeat(64);
  expect(
    diffStageLineage(previous, computeStageLineage(template, fingerprintJson), fingerprintJson)
      .changed,
  ).toEqual(['delivery', 'quality', 'render']);
  const artifact = structuredClone(inputs);
  artifact.find((value) => value.stageId === 'alignment')!.artifactDigests.audio = 'c'.repeat(64);
  expect(
    diffStageLineage(previous, computeStageLineage(artifact, fingerprintJson), fingerprintJson)
      .changed,
  ).toEqual(['alignment', 'composition', 'delivery', 'quality', 'render', 'timeline']);
});

it('rejects forged, cyclic, missing, duplicate, and unordered lineage dependencies', () => {
  const inputs = lineageInputs(lineageModel());
  const records = computeStageLineage(inputs, fingerprintJson);
  const forged = structuredClone(records);
  forged[0]!.settingsDigest = '0'.repeat(64);
  expect(() => validateStageLineage(forged, fingerprintJson)).toThrow('fingerprint');
  expect(() => computeStageLineage([...inputs, inputs[0]!], fingerprintJson)).toThrow('Duplicate');
  const missing = structuredClone(inputs);
  missing[0]!.dataDependencies = ['missing'];
  expect(() => computeStageLineage(missing, fingerprintJson)).toThrow('missing');
  const cycle = structuredClone(inputs);
  cycle[0]!.dataDependencies = ['delivery'];
  expect(() => computeStageLineage(cycle, fingerprintJson)).toThrow('cycle');
  const unordered = structuredClone(inputs);
  unordered.find((input) => input.stageId === 'capture')!.dataDependencies = ['voice'];
  expect(() =>
    bindWorkflowLineage(
      lineageGraph(),
      computeStageLineage(unordered, fingerprintJson),
      fingerprintJson,
    ),
  ).toThrow('ordered');
  const unknown = { ...inputs[0], unexpected: true } as StageInput;
  expect(() => computeStageLineage([unknown], fingerprintJson)).toThrow();
});

it('retains determinism across stage/map order and reports removed stages explicitly', () => {
  const inputs = lineageInputs(lineageModel());
  const original = structuredClone(inputs);
  expect(computeStageLineage([...inputs].reverse(), fingerprintJson)).toEqual(
    computeStageLineage(inputs, fingerprintJson),
  );
  expect(inputs).toEqual(original);
  const previous = computeStageLineage(inputs, fingerprintJson);
  const next = computeStageLineage(
    inputs.filter((value) => value.stageId !== 'delivery'),
    fingerprintJson,
  );
  expect(diffStageLineage(previous, next, fingerprintJson).removed).toEqual(['delivery']);
});
