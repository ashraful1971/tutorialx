import type { PlanRevision, ProviderKind, ProviderRequirements } from '@tutorialx/contracts';

export function requirementsForPlan(
  plan: PlanRevision,
): Partial<Record<ProviderKind, ProviderRequirements>> {
  const { settings } = plan.effective;
  const result: Partial<Record<ProviderKind, ProviderRequirements>> = {};
  const empty = (): ProviderRequirements => ({
    languages: [],
    features: [],
    formats: [],
    modalities: [],
    customScenes: [],
  });
  const render = empty();
  result.renderer = render;
  for (const scene of plan.scenes) {
    render.features.push(`visual:${scene.visual.kind}`, `transition:${scene.transition}`);
    if (scene.visual.kind === 'custom') {
      render.customScenes.push({
        sceneId: scene.id,
        providerId: scene.visual.providerId,
        templateId: scene.visual.templateId,
      });
      render.features.push(
        `template:${scene.visual.templateId}`,
        ...scene.visual.requiredCapabilities,
      );
    }
    if (scene.visual.kind === 'browser') result.capture = empty();
  }
  for (const variant of settings.variants) {
    render.formats.push(`codec:${variant.codec}`, `container:${variant.container}`);
    let a = variant.frameRate.numerator;
    let b = variant.frameRate.denominator;
    while (b !== 0) [a, b] = [b, a % b];
    render.features.push(
      `aspect-ratio:${variant.aspectRatio}`,
      `resolution:${variant.width}x${variant.height}`,
      `frame-rate:${variant.frameRate.numerator / a}/${variant.frameRate.denominator / a}`,
    );
    if (variant.thumbnail) render.features.push('thumbnail');
  }
  if (['embedded', 'both'].includes(settings.captions.mode))
    render.features.push('captions:embedded');
  if (settings.audio.music.enabled) render.features.push('audio:music');
  if (settings.audio.effects) render.features.push('audio:effects');
  if (settings.audio.ducking) render.features.push('audio:ducking');
  if (settings.voice.mode === 'synthesize') {
    const voice = empty();
    voice.languages.push(settings.language);
    if (settings.voice.pace !== 1) voice.features.push('voice:pace');
    if (settings.voice.tone !== '') voice.features.push('voice:tone');
    if (Object.keys(settings.voice.pronunciations).length)
      voice.features.push('voice:pronunciations');
    if (settings.captions.mode !== 'none' && settings.providers.alignment === null)
      voice.features.push('timing:word');
    result.voice = voice;
  }
  if (settings.captions.mode !== 'none' && settings.providers.alignment !== null) {
    result.alignment = { ...empty(), languages: [settings.language], features: ['timing:word'] };
  }
  for (const requirements of Object.values(result)) {
    requirements.features = [...new Set(requirements.features)];
    requirements.formats = [...new Set(requirements.formats)];
  }
  return result;
}
