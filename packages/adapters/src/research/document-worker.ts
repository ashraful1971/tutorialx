import { parentPort, workerData } from 'node:worker_threads';
import { docxText, htmlText } from './extraction.js';

async function extract(input: {
  format: 'pdf' | 'docx' | 'html';
  bytes: Uint8Array;
  maxPages: number;
  maxOutputBytes: number;
}) {
  if (input.format === 'docx')
    return {
      chunks: [{ page: null, text: docxText(input.bytes, input.maxOutputBytes) }],
      truncated: false,
    };
  if (input.format === 'html')
    return { chunks: [{ page: null, text: htmlText(input.bytes) }], truncated: false };
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({
    data: input.bytes,
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    stopAtErrors: true,
    maxImageSize: 1,
    verbosity: 0,
  });
  try {
    const pdf = await task.promise;
    const chunks: { page: number; text: string }[] = [];
    let used = 0;
    let truncated = pdf.numPages > input.maxPages;
    for (let page = 1; page <= Math.min(pdf.numPages, input.maxPages); page++) {
      const content = await (await pdf.getPage(page)).getTextContent();
      const text = content.items
        .map((item) => ('str' in item ? `${item.str}${item.hasEOL ? '\n' : ' '}` : ''))
        .join('')
        .trim();
      const remaining = Math.max(0, input.maxOutputBytes - used);
      const bounded = new TextDecoder('utf-8').decode(Buffer.from(text).subarray(0, remaining), {
        stream: true,
      });
      chunks.push({ page, text: bounded });
      used += Buffer.byteLength(bounded);
      if (Buffer.byteLength(text) > remaining || used >= input.maxOutputBytes) {
        truncated = true;
        break;
      }
    }
    return { chunks, truncated };
  } finally {
    await task.destroy();
  }
}
if (parentPort)
  void extract(workerData).then(
    (result) => parentPort!.postMessage({ result }),
    (error: unknown) =>
      parentPort!.postMessage({
        error:
          error instanceof Error && /password|encrypt/i.test(error.message)
            ? 'PDF requires a password or unsupported encryption.'
            : 'Document could not be decoded by the selected bounded reader.',
      }),
  );
