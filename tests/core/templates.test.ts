import {
  brandedTemplates,
  mapFocusToCrop,
  resolveBrandedLayout,
  validateBrandedLayout,
} from '@tutorialx/core';
import { describe, expect, it } from 'vitest';

const variants = [
  { id: 'landscape', width: 1920, height: 1080, expected: 'landscape' },
  { id: 'vertical', width: 1080, height: 1920, expected: 'vertical' },
  { id: 'square', width: 1080, height: 1080, expected: 'square' },
] as const;

describe.each(brandedTemplates)('$family branded template', (definition) => {
  it('binds its trusted digest to packaged template bytes', async () => {
    const bytes = await readFile(
      join(process.cwd(), 'packages/core', definition.template.source.path),
    );
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(definition.template.digest);
  });

  it.each(variants)('keeps required text and controls safe in $id', (variant) => {
    const layout = resolveBrandedLayout({
      templateId: definition.template.id,
      variant,
      brand: { name: 'TutorialX', primaryColor: '#176bff', logoArtifactId: 'logo' },
      source: { width: 1920, height: 1080 },
      focus: { x: 0.72, y: 0.62, width: 0.2, height: 0.2 },
      caption: { position: 'bottom', fontSize: 48, maxLines: 2 },
    });
    expect(layout.shape).toBe(variant.expected);
    expect(validateBrandedLayout(layout)).toBe(layout);
    expect(layout.titleRegion.height).toBeGreaterThan(0);
    expect(layout.contentRegion.height).toBeGreaterThan(0);
    expect(layout.captionRegion?.height).toBeGreaterThanOrEqual(80);
    expect(layout.contentRegion.y + layout.contentRegion.height).toBeLessThanOrEqual(
      layout.platformControlExclusion.y,
    );
  });
});

it.each(variants)('maps focus to an aspect-correct crop for $id', (variant) => {
  const focus = { x: 0.72, y: 0.62, width: 0.2, height: 0.2 };
  const crop = mapFocusToCrop(focus, { width: 1920, height: 1080 }, variant);
  expect(crop.x).toBeLessThanOrEqual(focus.x);
  expect(crop.y).toBeLessThanOrEqual(focus.y);
  expect(crop.x + crop.width).toBeGreaterThanOrEqual(focus.x + focus.width);
  expect(crop.y + crop.height).toBeGreaterThanOrEqual(focus.y + focus.height);
  expect((crop.width * 1920) / (crop.height * 1080)).toBeCloseTo(variant.width / variant.height, 8);
});

it('rejects layouts that place required material under platform controls', () => {
  const layout = resolveBrandedLayout({
    templateId: 'tutorial_branded',
    variant: variants[0],
    brand: { name: 'TutorialX', primaryColor: '#176bff', logoArtifactId: null },
    source: null,
    focus: null,
    caption: null,
  });
  expect(() =>
    validateBrandedLayout({
      ...layout,
      titleRegion: { ...layout.titleRegion, y: layout.platformControlExclusion.y },
    }),
  ).toThrow('TEMPLATE_REQUIRED_CONTENT_OUTSIDE_SAFE_REGION');
});

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
