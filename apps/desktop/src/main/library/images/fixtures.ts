/** Image bytes for the linked-image tests (headers only; never decoded). */

export function png(width: number, height: number, extra = 0): Uint8Array {
  const b = Buffer.alloc(33 + extra);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).copy(b, 0);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return new Uint8Array(b);
}

export function gif(width: number, height: number): Uint8Array {
  const b = Buffer.alloc(13);
  b.write('GIF89a', 0, 'latin1');
  b.writeUInt16LE(width, 6);
  b.writeUInt16LE(height, 8);
  return new Uint8Array(b);
}

/** A JPEG with an APP0 segment before the frame header. */
export function jpeg(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0,
    6,
    0x4a,
    0x46,
    0x49,
    0x46,
    0xff,
    0xc0,
    0,
    11,
    8,
    ...[height >> 8, height & 0xff, width >> 8, width & 0xff],
    1,
    1,
    0x11,
    0,
  ]);
}

export function webp(kind: 'VP8 ' | 'VP8L' | 'VP8X', width: number, height: number): Uint8Array {
  const b = Buffer.alloc(40);
  b.write('RIFF', 0, 'latin1');
  b.writeUInt32LE(32, 4);
  b.write('WEBP', 8, 'latin1');
  b.write(kind, 12, 'latin1');
  if (kind === 'VP8 ') {
    b.set([0x9d, 0x01, 0x2a], 23);
    b.writeUInt16LE(width, 26);
    b.writeUInt16LE(height, 28);
  } else if (kind === 'VP8L') {
    b[20] = 0x2f;
    b.writeUInt32LE(((width - 1) | ((height - 1) << 14)) >>> 0, 21);
  } else {
    b.writeUIntLE(width - 1, 24, 3);
    b.writeUIntLE(height - 1, 27, 3);
  }
  return new Uint8Array(b);
}
