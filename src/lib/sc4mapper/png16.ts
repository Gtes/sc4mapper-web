/**
 * Port of SC4Mapper-2026: src/sc4mapper/png16.py
 * Original 2013: 16-bit grayscale PNG heightmap import (Pillow `I` / `I;16`).
 */

import { unzlibSync } from "fflate";

const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];

function readU32(b: Uint8Array, o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function unfilter(data: Uint8Array, width: number, height: number, bpp: number): Uint8Array {
  const stride = width * bpp;
  const out = new Uint8Array(height * stride);
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = data[src++];
    const row = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const raw = data[src++];
      const a = x >= bpp ? row[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let val = 0;
      if (filter === 0) val = raw;
      else if (filter === 1) val = raw + a;
      else if (filter === 2) val = raw + b;
      else if (filter === 3) val = raw + ((a + b) >> 1);
      else if (filter === 4) val = raw + paeth(a, b, c);
      else throw new Error(`unsupported PNG filter ${filter}`);
      row[x] = val & 255;
    }
  }
  return out;
}

export interface Gray16Image {
  width: number;
  height: number;
  /** Row-major uint16 samples, PNG big-endian decoded. */
  pixels: Uint16Array;
}

/** Decode a 16-bit grayscale PNG (color type 0, bit depth 16). Not canvas. */
export function decodeGray16Png(buf: Uint8Array): Gray16Image {
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== PNG_SIG[i]) throw new Error("not a PNG file");
  }
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = 0;
  const idats: Uint8Array[] = [];
  let offset = 8;
  while (offset + 12 <= buf.length) {
    const len = readU32(buf, offset);
    const type = String.fromCharCode(buf[offset + 4], buf[offset + 5], buf[offset + 6], buf[offset + 7]);
    const data = buf.subarray(offset + 8, offset + 8 + len);
    if (type === "IHDR") {
      width = readU32(data, 0);
      height = readU32(data, 4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      idats.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + len;
  }
  if (bitDepth !== 16 || colorType !== 0) {
    throw new Error(
      `need a 16-bit grayscale PNG (color type 0, bit depth 16); got type ${colorType} depth ${bitDepth}`,
    );
  }
  if (interlace) throw new Error("interlaced PNG is not supported");
  let idatLen = 0;
  for (const c of idats) idatLen += c.length;
  const idat = new Uint8Array(idatLen);
  let p = 0;
  for (const c of idats) {
    idat.set(c, p);
    p += c.length;
  }
  const inflated = unzlibSync(idat);
  const raw = unfilter(inflated, width, height, 2);
  const pixels = new Uint16Array(width * height);
  for (let i = 0; i < pixels.length; i++) {
    pixels[i] = (raw[i * 2] << 8) | raw[i * 2 + 1];
  }
  return { width, height, pixels };
}

export function tilesFromPixels(size: number): number {
  if (size < 65 || (size - 1) % 64 !== 0) return -1;
  return (size - 1) / 64;
}
