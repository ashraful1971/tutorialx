import {
  type CompositionGraph,
  compositionGraphSchema,
  type TrustedTemplate,
  trustedTemplateSchema,
} from '@tutorialx/contracts';

export type CompositionGraphInput = Omit<CompositionGraph, 'template'>;

/** Compiles declarative data only; trusted template source is selected by the composition root. */
export function compileTrustedTemplate(
  templateValue: TrustedTemplate,
  graphValue: CompositionGraphInput,
): CompositionGraph {
  const template = trustedTemplateSchema.parse(templateValue);
  const kinds = new Set(template.supportedPrimitives);
  if (graphValue.nodes.length > template.maxNodes) throw new Error('TEMPLATE_NODE_LIMIT_EXCEEDED');
  for (const node of graphValue.nodes) {
    if (!kinds.has(node.kind)) throw new Error(`TEMPLATE_PRIMITIVE_UNSUPPORTED:${node.kind}`);
    if (
      node.kind === 'captions' &&
      !template.allowedFontFamilies.some((font) => font === node.fontFamily)
    )
      throw new Error(`TEMPLATE_FONT_UNTRUSTED:${node.fontFamily}`);
  }
  return compositionGraphSchema.parse({
    ...graphValue,
    template: { id: template.id, version: template.version, digest: template.digest },
  });
}
