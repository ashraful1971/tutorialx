import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import type { OperationContext } from '@tutorialx/contracts';

export class ReaderAccessError extends Error {}
export function privateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [first = 0, second = 0] = address.split('.').map(Number);
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      first >= 224 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && (second === 168 || second === 0)) ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 198 && (second === 18 || second === 19))
    );
  }
  // Deny mapped, local, documentation, and non-global IPv6 addresses by default.
  return (
    isIP(address) !== 6 || !/^[23]/i.test(address) || address.toLowerCase().startsWith('2001:db8:')
  );
}
async function withCancellation<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  let stop!: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    stop = () =>
      reject(new ReaderAccessError('Source DNS lookup was cancelled or exceeded its deadline.'));
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
  });
  try {
    return await Promise.race([operation, cancelled]);
  } finally {
    signal.removeEventListener('abort', stop);
  }
}

export async function readBoundedUrl(input: {
  url: string;
  allowedOrigins: readonly string[];
  trustedPrivateOrigins: readonly string[];
  maximumBytes: number;
  context: OperationContext;
  localOnly: boolean;
  resolveHostname?: (hostname: string) => Promise<readonly { address: string; family: number }[]>;
}): Promise<{ bytes: Buffer; contentType: string; finalUrl: string }> {
  if (input.localOnly)
    throw new ReaderAccessError('Local-only policy forbids network source retrieval.');
  let url = new URL(input.url);
  for (let redirect = 0; redirect <= 3; redirect++) {
    input.context.signal.throwIfAborted();
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      !input.allowedOrigins.includes(url.origin)
    )
      throw new ReaderAccessError(
        'URL origin or embedded credentials are outside the authorized network scope.',
      );
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = isIP(hostname)
      ? [{ address: hostname, family: isIP(hostname) }]
      : await withCancellation(
          input.resolveHostname
            ? input.resolveHostname(hostname)
            : lookup(hostname, { all: true, verbatim: true }),
          input.context.signal,
        );
    if (
      !addresses.length ||
      (!input.trustedPrivateOrigins.includes(url.origin) &&
        addresses.some(({ address }) => privateAddress(address)))
    )
      throw new ReaderAccessError(
        'Private or unresolved network destinations require explicit trusted-origin authorization.',
      );
    const address = addresses[0]!;
    const response = await new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
      const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
      const request = send(
        url,
        {
          method: 'GET',
          agent: false,
          maxHeaderSize: 16_384,
          signal: input.context.signal,
          headers: {
            accept:
              'text/html,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document;q=0.9',
            'accept-encoding': 'identity',
            'user-agent': 'TutorialX-Reader/0.1',
          },
          lookup: (_hostname, _options, callback) => {
            if (_options.all)
              callback(null, [{ address: address.address, family: address.family }]);
            else callback(null, address.address, address.family);
          },
        },
        resolve,
      );
      request.on('error', reject);
      request.end();
    });
    if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
      response.destroy();
      if (!response.headers.location || redirect === 3)
        throw new ReaderAccessError('URL redirect limit exceeded or redirect target is missing.');
      const next = new URL(response.headers.location, url);
      if (url.protocol === 'https:' && next.protocol !== 'https:')
        throw new ReaderAccessError('HTTPS source redirects cannot downgrade transport.');
      url = next;
      continue;
    }
    if ((response.statusCode ?? 500) < 200 || (response.statusCode ?? 500) >= 300) {
      response.destroy();
      throw new ReaderAccessError(
        `URL could not be read (HTTP ${response.statusCode ?? 0}); supply accessible source content.`,
      );
    }
    if (
      response.headers['content-encoding'] &&
      response.headers['content-encoding'] !== 'identity'
    ) {
      response.destroy();
      throw new ReaderAccessError(
        'Compressed network responses are unsupported; supply an uncompressed source.',
      );
    }
    const declared = response.headers['content-length'];
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > input.maximumBytes)) {
      response.destroy();
      throw new ReaderAccessError('URL source exceeds the configured byte limit.');
    }
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for await (const part of response) {
        input.context.signal.throwIfAborted();
        const bytes = Buffer.from(part as Uint8Array);
        size += bytes.length;
        if (size > input.maximumBytes)
          throw new ReaderAccessError('URL source exceeds the configured byte limit.');
        chunks.push(bytes);
      }
    } finally {
      response.destroy();
    }
    return {
      bytes: Buffer.concat(chunks, size),
      contentType: String(response.headers['content-type'] ?? '')
        .split(';')[0]!
        .trim()
        .toLowerCase(),
      finalUrl: url.href,
    };
  }
  throw new ReaderAccessError('URL redirect limit exceeded.');
}
