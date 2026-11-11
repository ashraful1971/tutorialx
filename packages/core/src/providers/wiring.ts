import {
  type AgentRunner,
  type AlignmentProvider,
  type AssetProvider,
  type CaptureProvider,
  type IsolationProvider,
  type JobRepository,
  type ProviderDescriptor,
  type ProviderKind,
  type ProviderSelection,
  providerDescriptorSchema,
  providerReadinessSchema,
  providerSelectionSchema,
  type QueueProvider,
  type RendererProvider,
  type ResearchReader,
  type StorageProvider,
  type VoiceProvider,
} from '@tutorialx/contracts';

export interface ProviderPorts {
  agent: AgentRunner;
  research: ResearchReader;
  capture: CaptureProvider;
  voice: VoiceProvider;
  alignment: AlignmentProvider;
  assets: AssetProvider;
  renderer: RendererProvider;
  storage: StorageProvider;
  persistence: JobRepository;
  queue: QueueProvider;
  isolation: IsolationProvider;
}

export type ProviderRegistration<K extends ProviderKind = ProviderKind> = {
  [P in K]: {
    descriptor: ProviderDescriptor & { kind: P };
    create(selection: ProviderSelection): ProviderPorts[P];
  };
}[K];

/** Structural JSON equality, independent of object insertion order. */
export function sameJson(left: unknown, right: unknown): boolean {
  function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value !== null && typeof value === 'object') {
      return `{${Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
        .join(',')}}`;
    }
    return JSON.stringify(value) ?? 'undefined';
  }
  return canonical(left) === canonical(right);
}

/** Local assembly only: no module discovery, installation, environment reads, or singleton. */
export interface ProviderWiring {
  descriptors(): ProviderDescriptor[];
  describe(kind: ProviderKind, selection: ProviderSelection): ProviderDescriptor | null;
  instantiate<K extends ProviderKind>(kind: K, selection: ProviderSelection): ProviderPorts[K];
}

export function wireProviders(registrations: readonly ProviderRegistration[]): ProviderWiring {
  const entries = registrations.map((registration) => ({
    descriptor: providerDescriptorSchema.parse(registration.descriptor),
    create: registration.create,
  }));
  const keys = entries.map(({ descriptor: d }) => `${d.kind}:${d.id}:${d.version}`);
  if (new Set(keys).size !== keys.length) throw new Error('Duplicate provider registration.');

  function find(kind: ProviderKind, selection: ProviderSelection) {
    return entries.find(
      ({ descriptor: d }) =>
        d.kind === kind && d.id === selection.id && d.version === selection.version,
    );
  }

  return {
    descriptors: () => entries.map(({ descriptor }) => structuredClone(descriptor)),
    describe: (kind: ProviderKind, selection: ProviderSelection) => {
      const entry = find(kind, providerSelectionSchema.parse(selection));
      return entry ? structuredClone(entry.descriptor) : null;
    },
    instantiate<K extends ProviderKind>(kind: K, selection: ProviderSelection): ProviderPorts[K] {
      const parsed = providerSelectionSchema.parse(selection);
      const entry = find(kind, parsed);
      if (!entry) throw new Error('Provider is not explicitly registered at the selected version.');
      const provider = entry.create(structuredClone(parsed));
      if (!sameJson(providerDescriptorSchema.parse(provider.descriptor), entry.descriptor))
        throw new Error('Provider instance does not match its registered descriptor.');
      const config = providerReadinessSchema.parse(provider.validateConfiguration(parsed.config));
      if (!config.ready) throw new Error('Selected provider configuration is invalid.');
      // The registration union and matching descriptor establish this responsibility.
      return provider as ProviderPorts[K];
    },
  };
}
