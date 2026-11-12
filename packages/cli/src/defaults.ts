import { settingsSchema, type VideoSettings } from '@tutorialx/contracts';

/** Explicit, silent-video defaults. No narration or paid integration is implied. */
export function builtInSettings(): VideoSettings {
  return settingsSchema.parse({
    recipe: 'explainer',
    language: 'en-US',
    targetDurationUs: null,
    variants: [
      {
        id: 'landscape',
        aspectRatio: '16:9',
        width: 1920,
        height: 1080,
        frameRate: { numerator: 30, denominator: 1 },
        codec: 'h264',
        container: 'mp4',
        thumbnail: true,
      },
    ],
    captions: {
      mode: 'none',
      formats: [],
      language: 'en-US',
      style: {
        fontFamily: 'sans-serif',
        fontSize: 48,
        color: '#ffffff',
        backgroundColor: '#000000cc',
        maxLines: 2,
        position: 'bottom',
      },
    },
    voice: { mode: 'none' },
    audio: { music: { enabled: false }, effects: false, ducking: false },
    brand: {
      name: '',
      logoAssetId: null,
      fontFamily: 'sans-serif',
      primaryColor: '#176bff',
      introTemplate: null,
      outroTemplate: null,
    },
    providers: {
      renderer: { id: 'hyperframes', version: '1', config: {}, credentialRef: null },
      voice: null,
      capture: null,
      alignment: null,
      agent: null,
      assets: null,
    },
    qualityProfileId: 'standard',
    policy: {
      mode: 'review',
      localOnly: true,
      budgetUsdMicros: 0,
      researchBudgetUsdMicros: 0,
      maxAttempts: 3,
      maxRepairs: 2,
      deadlineAt: null,
      allowedOrigins: [],
      mutationTargets: [],
      requiredReviewModalities: ['text', 'image', 'audio'],
    },
  });
}
