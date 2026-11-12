import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { extname, resolve } from 'node:path';
import {
  canonicalJson,
  type InspectableResearchReader,
  inputReferenceSchema,
  type OperationContext,
  type ReaderFormatCapability,
  type ResearchReader,
  readerResultSchema,
  type SourceReadReport,
  sourceManifestSchema,
  sourceReadReportSchema,
  timestampSchema,
} from '@tutorialx/contracts';
import { createSourceScope, readScopedFile } from '../workspace/source-scope.js';
import { imageMetadata, probeMetadata, waveMetadata } from './media.js';
import { ReaderAccessError, readBoundedUrl } from './network.js';
import { documentText, probeBytes, probeExecutable } from './runtime.js';

const textExtensions = new Set([
  '.txt',
  '.md',
  '.markdown',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.rs',
  '.go',
  '.java',
  '.c',
  '.cpp',
  '.h',
  '.css',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.sh',
  '.sql',
  '.rb',
  '.php',
  '.vue',
  '.svelte',
  '.csv',
  '.tsv',
  '.xml',
]);
const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const mediaExtensions = new Set([
  '.mp4',
  '.mov',
  '.m4v',
  '.mkv',
  '.webm',
  '.avi',
  '.mp3',
  '.m4a',
  '.aac',
  '.ogg',
  '.flac',
  '.wav',
]);
const defaults = [
  '.git',
  '.env',
  '.env.*',
  '*.pem',
  '*.key',
  'credentials',
  'node_modules',
  '.tutorialx',
  '.aws',
  '.ssh',
  '.codex',
  'id_rsa',
  '*.p12',
  '*.pfx',
];
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export interface LocalResearchReaderOptions {
  projectDirectory: string;
  /** Trusted application ceilings. Each request may further restrict roots/origins/bytes. */
  allowedRoots: readonly string[];
  allowedOrigins?: readonly string[];
  trustedPrivateOrigins?: readonly string[];
  exclusions?: readonly string[];
  privateRoots?: readonly string[];
  localOnly?: boolean;
  maxInputBytes?: number;
  maxOutputBytes?: number;
  maxPages?: number;
  timeoutMs?: number;
  ffprobePath?: string | null;
  pdf?: boolean;
  now?(): string;
  /** Trusted resolver injection for private networks and deterministic fixtures; origin/IP checks still apply. */
  resolveHostname?: (hostname: string) => Promise<readonly { address: string; family: number }[]>;
}
export async function createLocalResearchReader(
  options: LocalResearchReaderOptions,
): Promise<InspectableResearchReader> {
  const project = resolve(options.projectDirectory);
  const limits = {
    input: options.maxInputBytes ?? 16 * 1024 * 1024,
    output: options.maxOutputBytes ?? 200_000,
    pages: options.maxPages ?? 100,
    timeout: options.timeoutMs ?? 30_000,
  };
  if (
    Object.values(limits).some((value) => !Number.isSafeInteger(value) || value < 1) ||
    limits.input > 64 * 1024 * 1024 ||
    limits.output > 1_000_000 ||
    limits.pages > 1000 ||
    limits.timeout > 120_000
  )
    throw new Error('Reader limits exceed supported bounds.');
  const ffprobe = options.ffprobePath === null ? null : (options.ffprobePath ?? 'ffprobe');
  const probeAvailable = ffprobe !== null && (await probeExecutable(ffprobe));
  let pdfAvailable = false;
  if (options.pdf !== false) {
    try {
      createRequire(import.meta.url).resolve('pdfjs-dist/legacy/build/pdf.mjs');
      const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
      pdfAvailable = major > 22 || (major === 22 && minor >= 13);
    } catch {
      /* Optional format capability remains unavailable. */
    }
  }
  const formats: ReaderFormatCapability[] = [
    { format: 'text', available: true, extraction: 'text', dependency: null, limitations: [] },
    { format: 'markdown', available: true, extraction: 'text', dependency: null, limitations: [] },
    {
      format: 'code',
      available: true,
      extraction: 'text',
      dependency: null,
      limitations: ['Code is untrusted reference text and is never executed.'],
    },
    {
      format: 'html',
      available: true,
      extraction: 'text',
      dependency: null,
      limitations: [
        'Static HTML text only; scripts, styles, dynamic UI, and linked resources are not executed or fetched.',
      ],
    },
    {
      format: 'docx',
      available: true,
      extraction: 'text',
      dependency: null,
      limitations: [
        'Main document paragraphs only; images, comments, headers, footers, tracked changes, and layout are not interpreted.',
      ],
    },
    {
      format: 'pdf',
      available: pdfAvailable,
      extraction: 'text',
      dependency: 'pdfjs-dist@6.5.438; Node22.13+',
      limitations: [
        'Text layer extraction only; scanned pages require a separately selected OCR provider.',
      ],
    },
    {
      format: 'png,jpeg,gif,webp',
      available: true,
      extraction: 'metadata',
      dependency: null,
      limitations: [
        'Header dimensions only; pixels are not decoded or understood and image validity is not certified.',
      ],
    },
    {
      format: 'wav-pcm',
      available: true,
      extraction: 'metadata',
      dependency: null,
      limitations: ['PCM/IEEE-float WAV stream metadata only; no transcription or alignment.'],
    },
    {
      format: 'audio,video',
      available: probeAvailable,
      extraction: 'metadata',
      dependency: 'ffprobe',
      limitations: [
        'Stream/container metadata only; no transcription, visual interpretation, or final quality certification.',
      ],
    },
  ];
  const now = options.now ?? (() => new Date().toISOString());
  async function inspect(
    request: Parameters<ResearchReader['read']>[0],
    context: OperationContext,
  ): Promise<SourceReadReport> {
    const original = sourceManifestSchema.parse(request.source);
    const input = inputReferenceSchema.parse(request.input);
    if (
      original.jobId !== context.jobId ||
      canonicalJson({ input }) !== canonicalJson({ input: original.input })
    )
      throw new Error('Reader source/context identity differs from its input.');
    if (!Number.isSafeInteger(request.maxBytes) || request.maxBytes < 1)
      throw new Error('Reader maximum bytes must be a positive integer.');
    if (request.allowedRoots.length > 100 || request.allowedOrigins.length > 100)
      throw new Error('Reader scope exceeds configured bounds.');
    const source = structuredClone(original);
    let format = 'unknown';
    let bytesRead = 0;
    const limitations: string[] = [];
    const result: SourceReadReport = {
      result: { source, extracts: [], artifacts: [], truncated: false },
      format,
      bytesRead,
      media: null,
      limitations,
    };
    const remaining =
      Date.parse(timestampSchema.parse(context.deadlineAt)) -
      Date.parse(timestampSchema.parse(now()));
    if (context.signal.aborted || remaining <= 0) {
      source.status = 'inaccessible';
      source.reason = 'Source reading was cancelled or its deadline expired.';
      limitations.push(source.reason);
      return sourceReadReportSchema.parse(result);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(limits.timeout, remaining));
    const signal = AbortSignal.any([context.signal, controller.signal]);
    const boundedContext = { ...context, signal };
    try {
      let bytes: Buffer;
      let name = '';
      let contentType = '';
      const maxBytes = Math.min(request.maxBytes, limits.input);
      if (input.kind === 'directory' || input.kind === 'codebase') {
        source.status = 'unsupported';
        source.reason =
          'Directory/codebase sources require scoped bounded retrieval; select a relevant file for this reader.';
        limitations.push(source.reason);
        return sourceReadReportSchema.parse(result);
      }
      if (input.kind === 'text') {
        bytes = Buffer.from(input.text);
        format = 'text';
        if (bytes.length > maxBytes)
          throw new ReaderAccessError('Inline source exceeds the configured byte limit.');
      } else if (input.kind === 'url') {
        const allowed = request.allowedOrigins.filter((origin) =>
          (options.allowedOrigins ?? []).includes(origin),
        );
        const network = await readBoundedUrl({
          url: input.url,
          allowedOrigins: allowed,
          trustedPrivateOrigins: options.trustedPrivateOrigins ?? [],
          maximumBytes: maxBytes,
          context: boundedContext,
          localOnly: options.localOnly ?? false,
          ...(options.resolveHostname ? { resolveHostname: options.resolveHostname } : {}),
        });
        bytes = network.bytes;
        name = new URL(network.finalUrl).pathname;
        contentType = network.contentType;
        if (network.finalUrl !== input.url)
          limitations.push(
            'Source followed an authorized redirect; the original supplied URL remains its provenance.',
          );
      } else {
        const ceiling = createSourceScope(
          project,
          options.allowedRoots,
          [...defaults, ...(options.exclusions ?? [])],
          options.privateRoots ?? [resolve(project, '.tutorialx')],
        );
        const scope = createSourceScope(
          project,
          request.allowedRoots,
          [...defaults, ...(options.exclusions ?? [])],
          options.privateRoots ?? [resolve(project, '.tutorialx')],
        );
        const authorize = async (path: string) => {
          await ceiling.authorize(path);
          return scope.authorize(path);
        };
        const path = await authorize(input.path);
        name = path;
        bytes = await readScopedFile(path, maxBytes, authorize);
      }
      signal.throwIfAborted();
      bytesRead = bytes.length;
      result.bytesRead = bytesRead;
      const digest = hash(bytes);
      if (source.contentHash !== null && source.contentHash !== digest)
        limitations.push(
          'Source content differs from its prior fingerprint; review the changed source revision before reusing evidence.',
        );
      source.contentHash = digest;
      const extension = extname(name).toLowerCase();
      let chunks: { page: number | null; text: string }[] = [];
      const image = imageMetadata(bytes);
      const wav = image ? null : waveMetadata(bytes);
      if (image || wav) {
        result.media = image ?? wav;
        format = result.media!.format;
        limitations.push(
          'Metadata extraction does not verify media content or establish factual claims.',
        );
        chunks = [{ page: null, text: JSON.stringify(result.media) }];
      } else if (
        bytes.subarray(0, 5).toString() === '%PDF-' ||
        extension === '.pdf' ||
        contentType === 'application/pdf'
      ) {
        format = 'pdf';
        if (!pdfAvailable) {
          source.status = 'unsupported';
          source.reason =
            'PDF text reader requires optional pdfjs-dist@6.5.438 on Node22.13+; install optional dependencies or supply extracted text.';
          limitations.push(source.reason);
          result.format = format;
          return sourceReadReportSchema.parse(result);
        }
        const decoded = await documentText(
          'pdf',
          bytes,
          signal,
          Math.min(limits.timeout, remaining),
          limits.pages,
          limits.output,
        );
        chunks = decoded.chunks;
        result.result.truncated = decoded.truncated;
        limitations.push(
          'PDF text layers only; scanned images, visual layout, and figures are not interpreted.',
        );
      } else if (
        extension === '.docx' ||
        contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ) {
        format = 'docx';
        chunks = (
          await documentText(
            'docx',
            bytes,
            signal,
            Math.min(limits.timeout, remaining),
            limits.pages,
            Math.min(limits.input * 4, 16 * 1024 * 1024),
          )
        ).chunks;
        limitations.push(
          'DOCX main document text only; embedded media, headers, footers, comments, and layout are not interpreted.',
        );
      } else if (extension === '.html' || extension === '.htm' || contentType === 'text/html') {
        format = 'html';
        chunks = (
          await documentText(
            'html',
            bytes,
            signal,
            Math.min(limits.timeout, remaining),
            limits.pages,
            limits.output,
          )
        ).chunks;
        limitations.push(
          'Static HTML text only; scripts, hidden/template content, dynamic UI, and linked resources are not fetched or executed.',
        );
      } else if (
        format === 'text' ||
        textExtensions.has(extension) ||
        contentType === 'text/plain' ||
        contentType === 'text/markdown'
      ) {
        format = ['.md', '.markdown'].includes(extension)
          ? 'markdown'
          : extension && extension !== '.txt'
            ? 'code'
            : 'text';
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        if (text.includes('\0')) throw new Error('Binary content cannot be read as UTF-8 text.');
        chunks = [{ page: null, text }];
      } else if (imageExtensions.has(extension)) {
        throw new Error('Image header is malformed or unsupported.');
      } else if (mediaExtensions.has(extension)) {
        format = 'audio,video';
        if (!probeAvailable || !ffprobe) {
          source.status = 'unsupported';
          source.reason =
            'This audio/video format requires the optional ffprobe executable; install it or provide PCM WAV/PNG/JPEG/GIF/WebP.';
          limitations.push(source.reason);
          result.format = format;
          return sourceReadReportSchema.parse(result);
        }
        result.media = probeMetadata(
          await probeBytes(bytes, ffprobe, signal, Math.min(limits.timeout, remaining)),
          bytes.length,
        );
        format = result.media.format;
        chunks = [{ page: null, text: JSON.stringify(result.media) }];
        limitations.push(
          'Media stream metadata only; transcription, visual interpretation, and quality checking require separate providers.',
        );
      } else {
        source.status = 'unsupported';
        source.reason =
          'No selected reader supports this format; supply UTF-8 text, HTML, DOCX, PDF, or a declared media format.';
        limitations.push(source.reason);
        result.format = format;
        return sourceReadReportSchema.parse(result);
      }
      let outputBytes = 0;
      let line = 1;
      for (const chunk of chunks) {
        const available = Math.max(0, limits.output - outputBytes);
        const encoded = Buffer.from(chunk.text);
        const bounded = new TextDecoder('utf-8').decode(encoded.subarray(0, available), {
          stream: true,
        });
        if (encoded.length > available) result.result.truncated = true;
        if (!bounded) continue;
        // Per-extract byte cap also keeps strict ReaderResult text lengths within their bound.
        for (let offset = 0; offset < bounded.length; ) {
          let end = Math.min(bounded.length, offset + 50_000);
          if (
            end < bounded.length &&
            bounded.charCodeAt(end - 1) >= 0xd800 &&
            bounded.charCodeAt(end - 1) <= 0xdbff
          )
            end--;
          const text = bounded.slice(offset, end);
          offset = end;
          const count = text.split('\n').length;
          result.result.extracts.push({
            locator:
              chunk.page !== null
                ? { kind: 'page', page: chunk.page }
                : ['text', 'markdown', 'code'].includes(format)
                  ? { kind: 'lines', start: line, end: line + count - 1 }
                  : { kind: 'whole' },
            text,
          });
          line += count - 1;
        }
        outputBytes += Buffer.byteLength(bounded);
        if (outputBytes >= limits.output) break;
      }
      if (!result.result.extracts.length)
        limitations.push(
          'No readable text layer or nonempty extract was found; OCR or another source may be required.',
        );
      if (result.result.truncated)
        limitations.push('Extract output was truncated by the configured output/page limit.');
      source.status = 'available';
      source.reason = limitations.length ? limitations.join(' ').slice(0, 2000) : null;
      result.format = format;
      return sourceReadReportSchema.parse(result);
    } catch (error) {
      source.status =
        error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'
          ? 'missing'
          : error && typeof error === 'object' && 'code' in error && error.code === 'POLICY_DENIED'
            ? 'inaccessible'
            : 'inaccessible';
      source.reason =
        error instanceof ReaderAccessError
          ? error.message
          : signal.aborted
            ? 'Source reading was cancelled or exceeded its deadline.'
            : 'Source is unreadable, malformed, excluded, oversized, or requires an unavailable optional decoder.';
      limitations.push(source.reason);
      result.format = format;
      result.bytesRead = bytesRead;
      return sourceReadReportSchema.parse(result);
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    descriptor: {
      id: 'local-research-reader',
      kind: 'research',
      version: '1.0.0',
      contractVersion: 1,
      configurationSchema: { type: 'object', additionalProperties: false },
      capabilities: {
        features: [
          'sources:bounded',
          'sources:provenance',
          'sources:static-html',
          'sources:metadata',
        ],
        formats: formats.filter((entry) => entry.available).map((entry) => entry.format),
        languages: [],
        modalities: ['text', 'image', 'audio', 'video'],
      },
      runtime: {
        platforms: ['darwin', 'linux', 'win32'],
        dependencies: [
          { id: 'pdfjs-dist', versionRange: '6.5.438; Node22.13+', optional: true },
          { id: 'ffprobe', versionRange: '5+', optional: true },
        ],
        memoryMiB: 192,
        gpu: false,
      },
      execution: {
        location: 'local',
        maxDurationMs: limits.timeout,
        cancellation: 'cooperative',
        sideEffect: 'pure',
        idempotency: 'supported',
        permissions: ['read-assets', 'network', 'subprocess'],
      },
      pricing: 'free',
    },
    formats: () => structuredClone(formats),
    validateConfiguration: (config) => ({
      ready: Object.keys(config).length === 0,
      diagnostics: [],
    }),
    readiness: async () => ({ ready: true, diagnostics: [] }),
    estimate: async (_operation, _input, context) => {
      context.signal.throwIfAborted();
      return { expectedUsdMicros: 0, upperBoundUsdMicros: 0, validUntil: null, uncertainty: [] };
    },
    inspect,
    read: async (request, context) =>
      readerResultSchema.parse((await inspect(request, context)).result),
  };
}
