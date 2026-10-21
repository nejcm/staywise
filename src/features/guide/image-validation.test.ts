import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HERO_MAX_BYTES, parseJpeg } from './image-validation';

// 24×16 JFIF from `magick -size 24x16 gradient:skyblue-white -strip -quality 82`, the same shape canvas output has.
const fixture = (name: string) => readFileSync(new URL(`../../tests/fixtures/${name}`, import.meta.url));
const jpeg = fixture('synthetic-hero.jpg');
const beforeEoi = (insert: Uint8Array) => Buffer.concat([jpeg.subarray(0, -2), insert, jpeg.subarray(-2)]);

function withSegment(marker: number, payload: string): Uint8Array {
  const body = Buffer.from(payload, 'latin1');
  const segment = Buffer.from([0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff]);
  return Buffer.concat([jpeg.subarray(0, 2), segment, body, jpeg.subarray(2)]);
}

const text = (value: string) => new TextEncoder().encode(value);

describe('parseJpeg', () => {
  it('reads the dimensions of a stripped JPEG', () => {
    expect(parseJpeg(jpeg)).toEqual({ width: 24, height: 16 });
  });

  it('rejects Exif, XMP, and IPTC segments', () => {
    expect(parseJpeg(withSegment(0xe1, 'Exif\0\0GPS'))).toBeNull();
    expect(parseJpeg(withSegment(0xe1, 'http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>'))).toBeNull();
    expect(parseJpeg(withSegment(0xed, 'Photoshop 3.0\0'))).toBeNull();
    expect(parseJpeg(withSegment(0xe2, 'ICC_PROFILE\0'))).toEqual({ width: 24, height: 16 });
  });

  it('walks progressive scans and restart markers to the end of the image', () => {
    expect(parseJpeg(fixture('synthetic-hero-progressive.jpg'))).toEqual({ width: 24, height: 16 });
    expect(parseJpeg(fixture('synthetic-hero-restart.jpg'))).toEqual({ width: 64, height: 48 });
    expect(parseJpeg(beforeEoi(Uint8Array.from([0x12, 0xff, 0x00, 0x34])))).toEqual({ width: 24, height: 16 });
  });

  it('rejects metadata after a scan', () => {
    const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, 0x00, 0x08]), Buffer.from('Exif\0\0', 'latin1')]);
    expect(parseJpeg(beforeEoi(app1))).toBeNull();
    expect(parseJpeg(beforeEoi(Uint8Array.from([0xff, 0xed, 0x00, 0x02])))).toBeNull();
  });

  it('rejects other formats renamed to .jpg', () => {
    expect(parseJpeg(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]))).toBeNull();
    expect(parseJpeg(text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(parseJpeg(text('<!doctype html><title>x</title>'))).toBeNull();
    expect(parseJpeg(new Uint8Array())).toBeNull();
  });

  it('rejects truncated input', () => {
    expect(parseJpeg(jpeg.subarray(0, jpeg.length - 1))).toBeNull();
    expect(parseJpeg(Buffer.concat([jpeg.subarray(0, 120), Buffer.from([0xff, 0xd9])]))).toBeNull();
    expect(parseJpeg(Buffer.from([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
    const sos = jpeg.lastIndexOf(Buffer.from([0xff, 0xda]));
    const scanHeader = sos + 2 + ((jpeg[sos + 2]! << 8) | jpeg[sos + 3]!);
    expect(parseJpeg(Buffer.concat([jpeg.subarray(0, scanHeader), Buffer.from([0xff, 0xd9])]))).toBeNull();
    expect(parseJpeg(Buffer.concat([jpeg, Buffer.from([0x00])]))).toBeNull();
  });

  it('accepts exactly the limit and rejects one byte more', () => {
    const padTo = (total: number) => {
      const comments: Buffer[] = [];
      let size = jpeg.length;
      while (size < total) {
        const body = Math.min(65533, total - size - 4);
        comments.push(
          Buffer.concat([Buffer.from([0xff, 0xfe, (body + 2) >> 8, (body + 2) & 0xff]), Buffer.alloc(body)]),
        );
        size += body + 4;
      }
      return Buffer.concat([jpeg.subarray(0, 2), ...comments, jpeg.subarray(2)]);
    };
    expect(padTo(HERO_MAX_BYTES).length).toBe(HERO_MAX_BYTES);
    expect(parseJpeg(padTo(HERO_MAX_BYTES))).toEqual({ width: 24, height: 16 });
    expect(parseJpeg(padTo(HERO_MAX_BYTES + 1))).toBeNull();
  });
});
