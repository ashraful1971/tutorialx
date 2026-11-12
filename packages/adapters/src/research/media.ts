import { type SourceMediaMetadata, sourceMediaMetadataSchema } from '@tutorialx/contracts';

const base = (
  kind: SourceMediaMetadata['kind'],
  format: string,
  sizeBytes: number,
): SourceMediaMetadata => ({
  kind,
  format,
  sizeBytes,
  durationUs: null,
  width: null,
  height: null,
  frameRate: null,
  sampleRate: null,
  channels: null,
  codecs: [],
});
export function imageMetadata(bytes: Buffer): SourceMediaMetadata | null {
  let format = '';
  let width = 0;
  let height = 0;
  if (
    bytes.length >= 24 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.toString('ascii', 12, 16) === 'IHDR'
  ) {
    format = 'png';
    width = bytes.readUInt32BE(16);
    height = bytes.readUInt32BE(20);
  } else if (bytes.length >= 10 && /^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6))) {
    format = 'gif';
    width = bytes.readUInt16LE(6);
    height = bytes.readUInt16LE(8);
  } else if (
    bytes.length >= 30 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    format = 'webp';
    const encoding = bytes.toString('ascii', 12, 16);
    if (encoding === 'VP8X') {
      width = bytes.readUIntLE(24, 3) + 1;
      height = bytes.readUIntLE(27, 3) + 1;
    } else if (encoding === 'VP8L' && bytes[20] === 47) {
      const packed = bytes.readUInt32LE(21);
      width = (packed & 0x3fff) + 1;
      height = ((packed >>> 14) & 0x3fff) + 1;
    } else if (encoding === 'VP8 ' && bytes.subarray(23, 26).equals(Buffer.from([157, 1, 42]))) {
      width = bytes.readUInt16LE(26) & 0x3fff;
      height = bytes.readUInt16LE(28) & 0x3fff;
    }
  } else if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
    format = 'jpeg';
    let offset = 2;
    let segments = 0;
    while (offset + 4 <= bytes.length && ++segments <= 1024) {
      if (bytes[offset++] !== 255) throw new Error('JPEG marker is malformed.');
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++]!;
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length)
        throw new Error('JPEG segment is truncated.');
      if (
        [192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) &&
        length >= 7
      ) {
        height = bytes.readUInt16BE(offset + 3);
        width = bytes.readUInt16BE(offset + 5);
        break;
      }
      offset += length;
    }
  }
  if (!format) return null;
  if (!width || !height) throw new Error('Image has no readable positive dimensions.');
  return sourceMediaMetadataSchema.parse({
    ...base('image', format, bytes.length),
    width,
    height,
    codecs: [format],
  });
}
export function waveMetadata(bytes: Buffer): SourceMediaMetadata | null {
  if (
    bytes.length < 12 ||
    bytes.toString('ascii', 0, 4) !== 'RIFF' ||
    bytes.toString('ascii', 8, 12) !== 'WAVE'
  )
    return null;
  let offset = 12;
  let channels = 0;
  let sampleRate = 0;
  let byteRate = 0;
  let dataBytes: number | null = null;
  let codec = '';
  while (offset + 8 <= bytes.length) {
    const kind = bytes.toString('ascii', offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    offset += 8;
    if (offset + length > bytes.length) throw new Error('WAV chunk is truncated.');
    if (kind === 'fmt ' && length >= 16) {
      const type = bytes.readUInt16LE(offset);
      channels = bytes.readUInt16LE(offset + 2);
      sampleRate = bytes.readUInt32LE(offset + 4);
      byteRate = bytes.readUInt32LE(offset + 8);
      const block = bytes.readUInt16LE(offset + 12);
      const bits = bytes.readUInt16LE(offset + 14);
      if (
        ![1, 3].includes(type) ||
        !block ||
        byteRate !== sampleRate * block ||
        block !== channels * Math.ceil(bits / 8)
      )
        throw new Error('WAV encoding requires the optional media probe.');
      codec = type === 1 ? `pcm_s${bits}le` : `pcm_f${bits}le`;
    }
    if (kind === 'data') dataBytes = length;
    offset += length + (length % 2);
  }
  if (!channels || !sampleRate || !byteRate || dataBytes === null)
    throw new Error('WAV has no valid format/data chunks.');
  return sourceMediaMetadataSchema.parse({
    ...base('audio', 'wav', bytes.length),
    channels,
    sampleRate,
    durationUs: Math.round((dataBytes * 1_000_000) / byteRate),
    codecs: [codec],
  });
}
function positive(value: unknown): number | null {
  const result = Number(value);
  return Number.isSafeInteger(result) && result > 0 ? result : null;
}
export function probeMetadata(value: unknown, sizeBytes: number): SourceMediaMetadata {
  if (!value || typeof value !== 'object') throw new Error('Media probe did not return an object.');
  const probe = value as { streams?: Record<string, unknown>[]; format?: Record<string, unknown> };
  if (!Array.isArray(probe.streams) || probe.streams.length > 1000)
    throw new Error('Media probe has invalid streams.');
  const video = probe.streams.find((stream) => stream.codec_type === 'video');
  const audio = probe.streams.find((stream) => stream.codec_type === 'audio');
  if (!video && !audio) throw new Error('Media contains no supported audio/video streams.');
  const seconds = Number(probe.format?.duration ?? video?.duration ?? audio?.duration);
  const rate =
    typeof video?.avg_frame_rate === 'string' ? video.avg_frame_rate.split('/').map(Number) : [];
  return sourceMediaMetadataSchema.parse({
    ...base(
      video ? 'video' : 'audio',
      String(probe.format?.format_name ?? 'unknown').slice(0, 100),
      sizeBytes,
    ),
    durationUs: Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1_000_000) : null,
    width: positive(video?.width),
    height: positive(video?.height),
    frameRate:
      rate.length === 2 && positive(rate[0]) && positive(rate[1])
        ? { numerator: rate[0], denominator: rate[1] }
        : null,
    channels: positive(audio?.channels),
    sampleRate: positive(audio?.sample_rate),
    codecs: [
      ...new Set(probe.streams.map((stream) => String(stream.codec_name ?? 'unknown'))),
    ].slice(0, 20),
  });
}
