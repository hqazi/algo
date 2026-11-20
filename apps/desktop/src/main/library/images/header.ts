/**
 * An image's type and size read from its header bytes only (T23, SPEC
 * §15.4). Nothing is decoded: the main process checks magic bytes and the
 * stated width and height, and the sandboxed renderer decodes.
 */
import { sniffImage, type ImageType } from '../assets';

export interface ImageInfo {
  type: ImageType;
  width: number;
  height: number;
}

/** At most this many pixels (width × height from the header). */
export const MAX_PIXELS = 100_000_000;

const u16be = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!;
const u16le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8);
const u24le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);
const u32be = (b: Uint8Array, i: number) =>
  ((b[i]! << 24) >>> 0) + (b[i + 1]! << 16) + u16be(b, i + 2);
const ascii = (b: Uint8Array, i: number, s: string) =>
  [...s].every((c, k) => b[i + k] === c.charCodeAt(0));

function jpegSize(b: Uint8Array): [number, number] | null {
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    while (b[i] === 0xff && i < b.length) i += 1;
    const m = b[i++];
    if (m === undefined) return null;
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) continue;
    if (m === 0xd9 || m === 0xda) return null; // end, or scan data before a frame header
    if (i + 2 > b.length) return null;
    const len = u16be(b, i);
    if (len < 2) return null;
    const sof = m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;
    if (sof) return i + 7 <= b.length ? [u16be(b, i + 5), u16be(b, i + 3)] : null;
    i += len;
  }
  return null;
}

function webpSize(b: Uint8Array): [number, number] | null {
  if (b.length < 30) return null;
  if (ascii(b, 12, 'VP8 ')) {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return [u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff];
  }
  if (ascii(b, 12, 'VP8L')) {
    if (b[20] !== 0x2f) return null;
    const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
    return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
  }
  if (ascii(b, 12, 'VP8X')) return [u24le(b, 24) + 1, u24le(b, 27) + 1];
  return null;
}

/** Type and dimensions from the header, or `null` if it is not a readable PNG, JPEG, GIF or WebP. */
export function imageInfo(b: Uint8Array): ImageInfo | null {
  const type = sniffImage(b);
  let size: [number, number] | null = null;
  if (type === 'image/png')
    size = b.length >= 24 && ascii(b, 12, 'IHDR') ? [u32be(b, 16), u32be(b, 20)] : null;
  else if (type === 'image/gif') size = b.length >= 10 ? [u16le(b, 6), u16le(b, 8)] : null;
  else if (type === 'image/jpeg') size = jpegSize(b);
  else if (type === 'image/webp') size = webpSize(b);
  if (!type || !size || size[0] <= 0 || size[1] <= 0) return null;
  return { type, width: size[0], height: size[1] };
}
