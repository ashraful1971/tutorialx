import {
  type CompositionNode,
  compositionGraphSchema,
  compositionNodeSchema,
  type TrustedTemplate,
} from '@tutorialx/contracts';
import { compileTrustedTemplate } from '@tutorialx/core';
import { expect, it } from 'vitest';
import { digest } from '../fixtures/contracts.js';

const range = { startUs: 0, endUs: 1_000_000 };
const base = { sceneId: 'intro', layer: 1, range };
const focus = { x: 0.1, y: 0.1, width: 0.5, height: 0.5 };

const nodes: CompositionNode[] = [
  { ...base, id: 'title', kind: 'title', text: 'TutorialX', subtitle: null, align: 'center' },
  { ...base, id: 'text', kind: 'text', text: 'Renderer neutral', align: 'start' },
  { ...base, id: 'image', kind: 'image', artifactId: 'image_asset', fit: 'contain', crop: null },
  {
    ...base,
    id: 'video',
    kind: 'video',
    artifactId: 'video_asset',
    fit: 'cover',
    crop: null,
    sourceStartUs: 0,
    playbackRate: 1,
  },
  {
    ...base,
    id: 'capture',
    kind: 'capture',
    artifactId: 'capture_asset',
    fit: 'contain',
    crop: focus,
    sourceStartUs: 0,
    playbackRate: 1,
    masks: [focus],
  },
  { ...base, id: 'focus', kind: 'focus', sourceNodeId: 'capture', region: focus, zoom: 2 },
  {
    ...base,
    id: 'diagram',
    kind: 'diagram',
    nodes: [
      { id: 'node_a', label: 'Input' },
      { id: 'node_b', label: 'Output' },
    ],
    edges: [{ from: 'node_a', to: 'node_b', label: 'produces' }],
  },
  { ...base, id: 'callout', kind: 'callout', sourceNodeId: 'capture', text: 'Save', region: focus },
  {
    ...base,
    id: 'transition',
    kind: 'transition',
    fromSceneId: 'intro',
    toSceneId: 'outro',
    style: 'fade',
    durationUs: 250_000,
  },
  {
    ...base,
    id: 'audio',
    kind: 'audio',
    artifactId: 'audio_asset',
    role: 'voice',
    sourceStartUs: 0,
    gainDb: 0,
  },
  {
    ...base,
    id: 'captions',
    kind: 'captions',
    captionTrackId: 'captions_final',
    fontFamily: 'Inter',
    fontSize: 48,
    color: '#ffffff',
    backgroundColor: '#000000cc',
    position: 'bottom',
  },
];

const template: TrustedTemplate = {
  id: 'tutorial_clean',
  version: '1.0.0',
  digest,
  trusted: true,
  source: { kind: 'builtin', path: 'templates/tutorial-clean.json' },
  supportedPrimitives: nodes.map((node) => node.kind),
  allowedFontFamilies: ['Inter'],
  maxNodes: 100,
};

function graph() {
  return {
    schemaVersion: 1 as const,
    id: 'composition_fixture',
    createdAt: '2026-11-20T00:00:00.000Z',
    jobId: 'job_composition',
    planId: 'plan_composition',
    planRevision: 1,
    settingsDigest: digest,
    variant: {
      id: 'landscape',
      width: 1920,
      height: 1080,
      frameRate: { numerator: 30, denominator: 1 },
    },
    durationUs: 1_000_000,
    assetIds: ['image_asset', 'video_asset', 'capture_asset', 'audio_asset'],
    captionTrackId: 'captions_final',
    nodes,
  };
}

it.each(nodes.map((node) => [node.kind, node] as const))(
  'validates the %s primitive independently of renderer source',
  (_kind, node) => {
    expect(compositionNodeSchema.parse(node)).toEqual(node);
  },
);

it('compiles a trusted declarative template into a renderer-neutral graph', () => {
  const compiled = compileTrustedTemplate(template, graph());
  expect(compositionGraphSchema.parse(compiled)).toEqual(compiled);
  expect(compiled.template).toEqual({ id: 'tutorial_clean', version: '1.0.0', digest });
  expect(compiled.nodes.map((node) => node.kind)).toEqual(nodes.map((node) => node.kind));
});

it('rejects unstaged assets, unknown references, unsupported primitives, and untrusted fonts', () => {
  expect(() =>
    compileTrustedTemplate(template, { ...graph(), assetIds: ['image_asset'] }),
  ).toThrow();
  const missingSource = structuredClone(nodes);
  missingSource.find((node) => node.kind === 'callout')!.sourceNodeId = 'missing';
  expect(() => compileTrustedTemplate(template, { ...graph(), nodes: missingSource })).toThrow();
  expect(() =>
    compileTrustedTemplate({ ...template, supportedPrimitives: ['title'] }, graph()),
  ).toThrow('TEMPLATE_PRIMITIVE_UNSUPPORTED');
  const wrongFont = structuredClone(nodes);
  wrongFont.find((node) => node.kind === 'captions')!.fontFamily = 'Remote Font';
  expect(() => compileTrustedTemplate(template, { ...graph(), nodes: wrongFont })).toThrow(
    'TEMPLATE_FONT_UNTRUSTED',
  );
});
