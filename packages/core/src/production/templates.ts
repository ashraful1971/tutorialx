import type { TrustedTemplate, VideoSettings } from '@tutorialx/contracts';

export type BrandedTemplateFamily = 'tutorial' | 'explainer' | 'reel';
export type VariantShape = 'landscape' | 'vertical' | 'square';

export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrandedTemplateDefinition {
  family: BrandedTemplateFamily;
  template: TrustedTemplate;
  brandSlots: readonly ['name', 'primaryColor', 'logo'];
}

export interface BrandedLayoutInput {
  templateId: string;
  variant: { id: string; width: number; height: number };
  brand: { name: string; primaryColor: string; logoArtifactId: string | null };
  source: { width: number; height: number } | null;
  focus: NormalizedRect | null;
  caption: {
    position: 'top' | 'center' | 'bottom';
    fontSize: number;
    maxLines: number;
  } | null;
}

export interface BrandedLayout {
  templateId: string;
  family: BrandedTemplateFamily;
  shape: VariantShape;
  brand: BrandedLayoutInput['brand'];
  safeRegion: PixelRect;
  titleRegion: PixelRect;
  contentRegion: PixelRect;
  captionRegion: PixelRect | null;
  platformControlExclusion: PixelRect;
  crop: NormalizedRect | null;
  focusTransform: { scale: number; translateX: number; translateY: number } | null;
}

const allPrimitives = [
  'title',
  'text',
  'image',
  'video',
  'capture',
  'focus',
  'diagram',
  'callout',
  'transition',
  'audio',
  'captions',
] as const;

export const brandedTemplates: readonly BrandedTemplateDefinition[] = [
  {
    family: 'tutorial',
    template: {
      id: 'tutorial_branded',
      version: '1.0.0',
      digest: '73b4571d0ef66c32905bfbdd91af288cf508279a7b07d0a5c7d3b20374090adf',
      trusted: true,
      source: { kind: 'builtin', path: 'templates/tutorial-branded.json' },
      supportedPrimitives: [...allPrimitives],
      allowedFontFamilies: ['Inter'],
      maxNodes: 10_000,
    },
    brandSlots: ['name', 'primaryColor', 'logo'],
  },
  {
    family: 'explainer',
    template: {
      id: 'explainer_branded',
      version: '1.0.0',
      digest: '12a76337eacc9ae4f8d16711bb18e3ff922e52213fff57900983ac6426989a08',
      trusted: true,
      source: { kind: 'builtin', path: 'templates/explainer-branded.json' },
      supportedPrimitives: [...allPrimitives],
      allowedFontFamilies: ['Inter'],
      maxNodes: 10_000,
    },
    brandSlots: ['name', 'primaryColor', 'logo'],
  },
  {
    family: 'reel',
    template: {
      id: 'reel_branded',
      version: '1.0.0',
      digest: 'eb4b89685026c42bde460f4906124ea217e4727ece20a81d65474d75b108bff6',
      trusted: true,
      source: { kind: 'builtin', path: 'templates/reel-branded.json' },
      supportedPrimitives: [...allPrimitives],
      allowedFontFamilies: ['Inter'],
      maxNodes: 10_000,
    },
    brandSlots: ['name', 'primaryColor', 'logo'],
  },
];

const recipeTemplates: Readonly<Record<VideoSettings['recipe'], BrandedTemplateFamily>> = {
  tutorial: 'tutorial',
  explainer: 'explainer',
  'asset-video': 'explainer',
  reel: 'reel',
  mixed: 'tutorial',
};

/** Selects maintained common templates without generating or editing renderer source. */
export function templateForRecipe(recipe: VideoSettings['recipe']): BrandedTemplateDefinition {
  const family = recipeTemplates[recipe];
  const definition = brandedTemplates.find((entry) => entry.family === family);
  if (!definition) throw new Error('TEMPLATE_RECIPE_UNSUPPORTED');
  return structuredClone(definition);
}

function finitePositive(value: number, code: string) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(code);
}

function shape(width: number, height: number): VariantShape {
  const ratio = width / height;
  if (ratio >= 1.2) return 'landscape';
  if (ratio <= 0.85) return 'vertical';
  return 'square';
}

function pixels(rect: NormalizedRect, width: number, height: number): PixelRect {
  return {
    x: Math.round(rect.x * width),
    y: Math.round(rect.y * height),
    width: Math.round(rect.width * width),
    height: Math.round(rect.height * height),
  };
}

function inset(shapeValue: VariantShape): NormalizedRect {
  if (shapeValue === 'vertical') return { x: 0.06, y: 0.08, width: 0.88, height: 0.76 };
  if (shapeValue === 'square') return { x: 0.06, y: 0.07, width: 0.88, height: 0.81 };
  return { x: 0.05, y: 0.06, width: 0.9, height: 0.84 };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function validateNormalized(rect: NormalizedRect, code: string) {
  if (
    ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ||
    rect.x < 0 ||
    rect.y < 0 ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    rect.x + rect.width > 1 ||
    rect.y + rect.height > 1
  )
    throw new Error(code);
}

/** Expands the requested focus just enough to match the output region without losing it. */
export function mapFocusToCrop(
  focus: NormalizedRect,
  source: { width: number; height: number },
  output: { width: number; height: number },
) {
  validateNormalized(focus, 'TEMPLATE_FOCUS_INVALID');
  for (const value of [source.width, source.height, output.width, output.height])
    finitePositive(value, 'TEMPLATE_DIMENSIONS_INVALID');
  const normalizedRatio = output.width / output.height / (source.width / source.height);
  let width = focus.width;
  let height = focus.height;
  if (width / height > normalizedRatio) height = width / normalizedRatio;
  else width = height * normalizedRatio;
  if (width > 1) {
    width = 1;
    height = 1 / normalizedRatio;
  }
  if (height > 1) {
    height = 1;
    width = normalizedRatio;
  }
  const centerX = focus.x + focus.width / 2;
  const centerY = focus.y + focus.height / 2;
  const crop = {
    x: clamp(centerX - width / 2, 0, 1 - width),
    y: clamp(centerY - height / 2, 0, 1 - height),
    width,
    height,
  };
  const tolerance = 1e-9;
  if (
    crop.x > focus.x + tolerance ||
    crop.y > focus.y + tolerance ||
    crop.x + crop.width < focus.x + focus.width - tolerance ||
    crop.y + crop.height < focus.y + focus.height - tolerance
  )
    throw new Error('TEMPLATE_FOCUS_CANNOT_FIT_OUTPUT');
  return crop;
}

function inside(inner: PixelRect, outer: PixelRect) {
  const tolerance = 1;
  return (
    inner.x >= outer.x - tolerance &&
    inner.y >= outer.y - tolerance &&
    inner.x + inner.width <= outer.x + outer.width + tolerance &&
    inner.y + inner.height <= outer.y + outer.height + tolerance
  );
}

export function validateBrandedLayout(layout: BrandedLayout) {
  const required = [layout.titleRegion, layout.contentRegion];
  if (layout.captionRegion) required.push(layout.captionRegion);
  if (!required.every((rect) => inside(rect, layout.safeRegion)))
    throw new Error('TEMPLATE_REQUIRED_CONTENT_OUTSIDE_SAFE_REGION');
  const controlTop = layout.platformControlExclusion.y;
  if (required.some((rect) => rect.y + rect.height > controlTop + 1))
    throw new Error('TEMPLATE_REQUIRED_CONTENT_OBSCURED_BY_CONTROLS');
  return layout;
}

export function resolveBrandedLayout(input: BrandedLayoutInput): BrandedLayout {
  const definition = brandedTemplates.find((entry) => entry.template.id === input.templateId);
  if (!definition) throw new Error('TEMPLATE_UNKNOWN');
  finitePositive(input.variant.width, 'TEMPLATE_DIMENSIONS_INVALID');
  finitePositive(input.variant.height, 'TEMPLATE_DIMENSIONS_INVALID');
  if (!input.brand.name.trim() || !/^#[0-9a-fA-F]{6}$/.test(input.brand.primaryColor))
    throw new Error('TEMPLATE_BRAND_INVALID');
  const variantShape = shape(input.variant.width, input.variant.height);
  const safe = inset(variantShape);
  const titleHeight =
    definition.family === 'reel' ? 0.11 : definition.family === 'explainer' ? 0.15 : 0.12;
  const gap = 0.025;
  const captionHeight = input.caption
    ? Math.max(
        (input.caption.maxLines * input.caption.fontSize * 1.25) / input.variant.height + 0.025,
        variantShape === 'vertical' ? 0.09 : 0.075,
      )
    : 0;
  if (input.caption) finitePositive(input.caption.fontSize, 'TEMPLATE_CAPTION_LAYOUT_INVALID');
  if (
    input.caption &&
    (!Number.isInteger(input.caption.maxLines) ||
      input.caption.maxLines < 1 ||
      input.caption.maxLines > 4)
  )
    throw new Error('TEMPLATE_CAPTION_LAYOUT_INVALID');
  const title = { x: safe.x, y: safe.y, width: safe.width, height: titleHeight };
  const contentTop = title.y + title.height + gap;
  const contentBottom = safe.y + safe.height - (captionHeight ? captionHeight + gap : 0);
  const content = {
    x: safe.x,
    y: contentTop,
    width: safe.width,
    height: contentBottom - contentTop,
  };
  if (content.height <= 0) throw new Error('TEMPLATE_CONTENT_REGION_EMPTY');
  let caption: NormalizedRect | null = null;
  if (input.caption) {
    const y =
      input.caption.position === 'top'
        ? safe.y
        : input.caption.position === 'center'
          ? safe.y + (safe.height - captionHeight) / 2
          : safe.y + safe.height - captionHeight;
    caption = { x: safe.x, y, width: safe.width, height: captionHeight };
    if (input.caption.position === 'top') {
      title.y += captionHeight + gap;
      content.y += captionHeight + gap;
      content.height -= captionHeight + gap;
    }
  }
  const crop =
    input.focus && input.source
      ? mapFocusToCrop(input.focus, input.source, {
          width: content.width * input.variant.width,
          height: content.height * input.variant.height,
        })
      : null;
  const layout: BrandedLayout = {
    templateId: definition.template.id,
    family: definition.family,
    shape: variantShape,
    brand: structuredClone(input.brand),
    safeRegion: pixels(safe, input.variant.width, input.variant.height),
    titleRegion: pixels(title, input.variant.width, input.variant.height),
    contentRegion: pixels(content, input.variant.width, input.variant.height),
    captionRegion: caption ? pixels(caption, input.variant.width, input.variant.height) : null,
    platformControlExclusion: pixels(
      {
        x: 0,
        y: safe.y + safe.height,
        width: 1,
        height: 1 - safe.y - safe.height,
      },
      input.variant.width,
      input.variant.height,
    ),
    crop,
    focusTransform: crop
      ? {
          scale: Math.min(8, Math.max(1, 1 / Math.max(crop.width, crop.height))),
          translateX: 0.5 - (crop.x + crop.width / 2),
          translateY: 0.5 - (crop.y + crop.height / 2),
        }
      : null,
  };
  return validateBrandedLayout(layout);
}
