export const HERO_MAX_BYTES = 1048576;

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const APP1 = 0xe1;
const APP13 = 0xed;

function isFrameStart(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

// Accepts only a complete JPEG with no Exif/XMP (APP1) or IPTC (APP13) segment anywhere; browser canvas
// output never carries them, so their presence means the file was not re-encoded.
export function parseJpeg(bytes: Uint8Array): { width: number; height: number } | null {
  const length = bytes.byteLength;
  if (length < 4 || length > HERO_MAX_BYTES || bytes[0] !== 0xff || bytes[1] !== SOI) return null;
  let size: { width: number; height: number } | null = null;
  let scans = 0;
  let offset = 2;
  while (offset + 2 <= length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1]!;
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === EOI) return offset + 2 === length && size && scans > 0 ? size : null;
    if (marker === SOI || marker === APP1 || marker === APP13 || offset + 4 > length) return null;
    const segmentLength = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    if (segmentLength < 2 || offset + 2 + segmentLength > length) return null;
    if (isFrameStart(marker)) {
      if (size || segmentLength < 8) return null;
      const height = (bytes[offset + 5]! << 8) | bytes[offset + 6]!;
      const width = (bytes[offset + 7]! << 8) | bytes[offset + 8]!;
      if (width === 0 || height === 0) return null;
      size = { width, height };
    }
    offset += 2 + segmentLength;
    if (marker === SOS) {
      if (!size) return null;
      const end = scanEnd(bytes, offset);
      if (end === null || end === offset) return null;
      scans += 1;
      offset = end;
    }
  }
  return null;
}

// Entropy-coded data runs until the next marker other than a stuffed FF00 or a restart marker.
function scanEnd(bytes: Uint8Array, start: number): number | null {
  for (let offset = start; offset + 1 < bytes.byteLength; offset += 1) {
    if (bytes[offset] !== 0xff) continue;
    const next = bytes[offset + 1]!;
    if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) offset += 1;
    else if (next !== 0xff) return offset;
  }
  return null;
}
