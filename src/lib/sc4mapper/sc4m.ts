/**
 * Port of SC4Mapper-2026: src/sc4mapper/app.py
 * (`ExportAsSC4M` / `CreateRgnFromSC4M`).
 * Original 2013: SC4Terraformer / SC4Mapper .SC4M share format.
 *
 * zlib file: SC4M header, optional SC4N notes, SC4C config RGB, SC4D
 * elevation as two uint8 planes (low, then high byte of uint16 height).
 */
import { zlibSync, unzlibSync } from "fflate";
import { buildBestCities, citiesFromConfigRgb, configRgb, type City } from "./grid";
import { tilesFromPixels } from "./png16";

const VERSION = 0x0200;

export type Sc4mMap = {
  pixels: Uint16Array;
  width: number;
  height: number;
  tilesX: number;
  tilesY: number;
  cities: City[];
};

function ascii(buf: Uint8Array, off: number): string {
  return String.fromCharCode(buf[off], buf[off + 1], buf[off + 2], buf[off + 3]);
}

function writeTag(body: Uint8Array, off: number, tag: string): void {
  body[off] = tag.charCodeAt(0);
  body[off + 1] = tag.charCodeAt(1);
  body[off + 2] = tag.charCodeAt(2);
  body[off + 3] = tag.charCodeAt(3);
}

export function encodeSc4m(
  pixels: Uint16Array,
  width: number,
  height: number,
  tilesX: number,
  tilesY: number,
  cities: City[],
): Uint8Array {
  if (pixels.length !== width * height) {
    throw new Error("heightmap size does not match width×height");
  }
  const rgb = configRgb(tilesX, tilesY, cities);
  const n = pixels.length;
  const hdrLen = 20 + 4 + 12 + rgb.length + 4;
  const body = new Uint8Array(hdrLen + n * 2);
  const view = new DataView(body.buffer);
  writeTag(body, 0, "SC4M");
  view.setUint32(4, VERSION, true);
  view.setUint32(8, height, true);
  view.setUint32(12, width, true);
  view.setFloat32(16, 0, true);
  let o = 20;
  writeTag(body, o, "SC4C");
  o += 4;
  view.setUint32(o, tilesX, true);
  o += 4;
  view.setUint32(o, tilesY, true);
  o += 4;
  view.setUint32(o, rgb.length, true);
  o += 4;
  body.set(rgb, o);
  o += rgb.length;
  writeTag(body, o, "SC4D");
  o += 4;
  for (let i = 0; i < n; i++) {
    const v = pixels[i];
    body[o + i] = v & 0xff;
    body[o + n + i] = (v >> 8) & 0xff;
  }
  return zlibSync(body, { level: 9 });
}

export function decodeSc4m(file: Uint8Array): Sc4mMap {
  let raw: Uint8Array;
  try {
    raw = unzlibSync(file);
  } catch {
    throw new Error("Not a valid SC4M file (could not decompress).");
  }
  if (raw.length < 20 || ascii(raw, 0) !== "SC4M") {
    throw new Error("Not a valid SC4M file.");
  }
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  if (view.getUint32(4, true) !== VERSION) {
    throw new Error("Unsupported SC4M version.");
  }
  const height = view.getUint32(8, true);
  const width = view.getUint32(12, true);
  let off = 20;
  const tag = (): string => {
    if (off + 4 > raw.length) throw new Error("Truncated SC4M file.");
    const t = ascii(raw, off);
    off += 4;
    return t;
  };
  const take = (len: number, what: string): Uint8Array => {
    if (len < 0 || off + len > raw.length) throw new Error(`Truncated SC4M ${what}.`);
    const slice = raw.subarray(off, off + len);
    off += len;
    return slice;
  };
  let t = tag();
  if (t === "SC4N") {
    const len = view.getUint32(off, true);
    off += 4;
    take(len, "notes");
    t = tag();
  }
  let cities: City[] | null = null;
  let cfgW = 0;
  let cfgH = 0;
  if (t === "SC4C") {
    if (off + 12 > raw.length) throw new Error("Truncated SC4M config.");
    cfgW = view.getUint32(off, true);
    cfgH = view.getUint32(off + 4, true);
    const len = view.getUint32(off + 8, true);
    off += 12;
    const rgb = take(len, "config");
    try {
      cities = citiesFromConfigRgb(cfgW, cfgH, rgb);
    } catch {
      cities = null;
    }
    t = tag();
  }
  if (t !== "SC4D") throw new Error("SC4M is missing elevation data.");
  const n = width * height;
  if (n <= 0 || off + n * 2 > raw.length) throw new Error("Truncated SC4M elevation data.");
  const lo = raw.subarray(off, off + n);
  const hi = raw.subarray(off + n, off + n * 2);
  const pixels = new Uint16Array(n);
  for (let i = 0; i < n; i++) pixels[i] = lo[i] + (hi[i] << 8);

  const tilesX = tilesFromPixels(width);
  const tilesY = tilesFromPixels(height);
  if (tilesX < 1 || tilesY < 1) {
    throw new Error(
      `SC4M size must be (N×64+1) pixels (65, 129, 257, 513, 1025, …). This file is ${width}×${height}.`,
    );
  }
  if (!cities || cfgW !== tilesX || cfgH !== tilesY) {
    cities = buildBestCities(tilesX, tilesY);
  }
  return { pixels, width, height, tilesX, tilesY, cities };
}
