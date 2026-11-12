import {
  type PlanRevision,
  type ProductionScript,
  planRevisionSchema,
  productionScriptSchema,
} from '@tutorialx/contracts';

/** Deterministic review projection: estimates are never presented as measured final audio timing. */
export function compileProductionScript(input: PlanRevision): ProductionScript {
  const plan = planRevisionSchema.parse(input);
  const settings = plan.effective.settings;
  let position = 0;
  const assets = new Map<string, ProductionScript['assetNeeds'][number]>();
  const add = (
    assetId: string,
    kind: 'image' | 'video' | 'audio',
    use: 'visual' | 'voice' | 'music' | 'logo',
    sceneId?: string,
  ) => {
    const current = assets.get(assetId) ?? { assetId, kind, sceneIds: [], uses: [] };
    if (current.kind !== kind)
      throw new Error('One asset identity cannot have incompatible media kinds.');
    if (!current.uses.includes(use)) current.uses.push(use);
    if (sceneId && !current.sceneIds.includes(sceneId)) current.sceneIds.push(sceneId);
    assets.set(assetId, current);
  };
  const scenes = plan.scenes.map((scene, index) => {
    const startUs = position;
    position += scene.estimatedDurationUs;
    if (!Number.isSafeInteger(position))
      throw new Error('Storyboard timing exceeds safe integer microseconds.');
    if (scene.visual.kind === 'image') add(scene.visual.assetId, 'image', 'visual', scene.id);
    if (scene.visual.kind === 'video') add(scene.visual.assetId, 'video', 'visual', scene.id);
    return { order: index + 1, startUs, endUs: position, scene };
  });
  if (settings.voice.mode === 'supplied') add(settings.voice.assetId, 'audio', 'voice');
  if (settings.audio.music.enabled) add(settings.audio.music.assetId, 'audio', 'music');
  if (settings.brand.logoAssetId) add(settings.brand.logoAssetId, 'image', 'logo');
  return productionScriptSchema.parse({
    schemaVersion: 1,
    jobId: plan.jobId,
    planId: plan.id,
    planRevision: plan.revision,
    recipe: settings.recipe,
    language: settings.language,
    estimatedDurationUs: position,
    timingBasis: 'planning-estimate',
    variants: settings.variants,
    captions: settings.captions,
    voice: settings.voice,
    scenes,
    assetNeeds: [...assets.values()],
  });
}

const plain = (value: string) => value.replace(/[\\`*_{}[\]()#!|<>]/g, '\\$&');
const seconds = (microseconds: number) => `${(microseconds / 1_000_000).toFixed(2)} s`;

/** Spoken words, intended actions, timing and evidence appear together before any production call. */
export function renderStoryboardProjection(input: PlanRevision): string {
  const script = compileProductionScript(input);
  const lines = [
    `# Storyboard: revision ${script.planRevision}`,
    '',
    'Review projection. Submit edits through plan.json; this document cannot authorize production.',
    '',
    `Recipe: ${script.recipe}; language: ${script.language}; estimated duration: ${seconds(script.estimatedDurationUs)}.`,
    'All timings below are planning estimates, not final recorded or aligned timing.',
    '',
    `Captions: ${script.captions.mode}; sidecar formats: ${script.captions.formats.join(', ') || 'none'}; placement: ${script.captions.style.position}.`,
    `Voice: ${script.voice.mode}.`,
    '',
    '## Output variants',
    '',
    ...script.variants.map(
      (variant) =>
        `- ${plain(variant.id)}: ${variant.width} × ${variant.height}, ${variant.aspectRatio}, ${variant.frameRate.numerator}/${variant.frameRate.denominator} fps.`,
    ),
    '',
  ];
  for (const row of script.scenes) {
    const scene = row.scene;
    lines.push(
      `## ${row.order}. ${plain(scene.title)}`,
      '',
      `Estimated ${seconds(row.startUs)} – ${seconds(row.endUs)}; transition: ${scene.transition}.`,
      '',
      'Narration:',
      '',
      ...scene.narration.split('\n').map((line) => `> ${plain(line)}`),
      '',
      `Intent: ${plain(scene.intent)}`,
      '',
      `Evidence: ${scene.evidenceIds.map(plain).join(', ') || 'none declared'}.`,
      '',
      `Visual: ${scene.visual.kind}.`,
      '',
    );
    if (scene.visual.kind === 'browser') {
      lines.push(
        `Target: ${plain(scene.visual.target)}`,
        '',
        '| Step | Intended action beside narration | Expected result | Dwell estimate | Evidence |',
        '| --- | --- | --- | --- | --- |',
      );
      for (const step of scene.visual.steps)
        lines.push(
          `| ${plain(step.id)} | ${step.action}: ${plain(step.description)} | ${plain(JSON.stringify(step.expected))} | ${seconds(step.dwellUs)} | ${step.evidenceIds.map(plain).join(', ')} |`,
        );
      lines.push('');
    } else if (scene.visual.kind === 'text')
      lines.push(
        `Headline: ${plain(scene.visual.headline)}`,
        '',
        `Text: ${plain(scene.visual.body)}`,
        '',
      );
    else if (scene.visual.kind === 'image' || scene.visual.kind === 'video')
      lines.push(`Asset: ${plain(scene.visual.assetId)}; fit: ${scene.visual.fit}.`, '');
    else if (scene.visual.kind === 'diagram')
      lines.push(`Diagram: ${scene.visual.nodes.map((node) => plain(node.label)).join(', ')}.`, '');
    else
      lines.push(
        `Custom provider: ${plain(scene.visual.providerId)}; template: ${plain(scene.visual.templateId)}.`,
        '',
      );
    for (const variant of script.variants) {
      const framing = scene.variantFraming[variant.id];
      lines.push(
        `Variant ${plain(variant.id)}: ${framing ? `${plain(framing.notes)}; focus: ${plain(JSON.stringify(framing.focus))}` : 'No explicit framing notes declared.'}`,
        '',
      );
    }
  }
  lines.push(
    '## Asset needs',
    '',
    ...script.assetNeeds.map(
      (asset) =>
        `- ${plain(asset.assetId)} (${asset.kind}): ${asset.uses.join(', ')}${asset.sceneIds.length ? `; scenes ${asset.sceneIds.map(plain).join(', ')}` : ''}.`,
    ),
    '',
  );
  return `${lines.join('\n')}\n`;
}
