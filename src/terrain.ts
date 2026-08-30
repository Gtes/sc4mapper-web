/** Port of SC4Mapper `terrain.py` + default palettes from `config/SC4Mapper.ini`. */

import { encodeRgbaPng } from "./png-encode";

export const WATER_LEVEL = 250;

const PALETTE_WATER: Record<number, [number, number, number]> = {
  0: [0x94, 0xb0, 0xbb],
  200: [0x35, 0x3a, 0x65],
  6000: [0x35, 0x3a, 0x65],
};

const PALETTE_LAND: Record<number, [number, number, number]> = {
  1: [0xdd, 0xd2, 0xac],
  3: [0xe9, 0xe7, 0xcf],
  4: [0x0d, 0x3d, 0x18],
  50: [0x1e, 0x4c, 0x0a],
  100: [0x45, 0x62, 0x35],
  250: [0x48, 0x75, 0x42],
  450: [0x37, 0x65, 0x40],
  600: [0x28, 0x70, 0x21],
  900: [0x3a, 0x70, 0x26],
  1000: [0x4a, 0x7a, 0x37],
  1220: [0x72, 0x85, 0x51],
  1450: [0x91, 0x91, 0x68],
  1900: [0xa1, 0x9b, 0x7d],
  2050: [255, 255, 255],
  6000: [255, 255, 255],
};

function gradientColor(
  palette: Record<number, [number, number, number]>,
  keys: number[],
  value: number,
): [number, number, number] {
  if (value < keys[0]) return palette[keys[0]];
  let prev = keys[0];
  for (const k of keys) {
    if (value < k) {
      const c0 = palette[prev];
      const c1 = palette[k];
      const alpha = (value - prev) / (k - prev);
      return [
        Math.trunc((1 - alpha) * c0[0] + c1[0] * alpha),
        Math.trunc((1 - alpha) * c0[1] + c1[1] * alpha),
        Math.trunc((1 - alpha) * c0[2] + c1[2] * alpha),
      ];
    }
    prev = k;
  }
  return palette[keys[keys.length - 1]];
}

function buildLut(palette: Record<number, [number, number, number]>): Int32Array {
  const keys = Object.keys(palette).map(Number).sort((a, b) => a - b);
  const lut = new Int32Array((keys[keys.length - 1] + 1) * 3);
  for (let value = 0; value <= keys[keys.length - 1]; value++) {
    const c = gradientColor(palette, keys, value);
    lut[value * 3] = c[0];
    lut[value * 3 + 1] = c[1];
    lut[value * 3 + 2] = c[2];
  }
  return lut;
}

const WATER_LUT = buildLut(PALETTE_WATER);
const LAND_LUT = buildLut(PALETTE_LAND);
const WATER_MAX = WATER_LUT.length / 3 - 1;
const LAND_MAX = LAND_LUT.length / 3 - 1;

/** Unlit palette RGB for a mapper height (PNG/10). Used by the color picker. */
export function paletteRgbForHeight(height: number, waterLevel = WATER_LEVEL): [number, number, number] {
  if (height < waterLevel) {
    let wv = (waterLevel - height) | 0;
    if (wv < 0) wv = 0;
    if (wv > WATER_MAX) wv = WATER_MAX;
    return [WATER_LUT[wv * 3], WATER_LUT[wv * 3 + 1], WATER_LUT[wv * 3 + 2]];
  }
  let lv = (height - waterLevel) | 0;
  if (lv < 0) lv = 0;
  if (lv > LAND_MAX) lv = LAND_MAX;
  return [LAND_LUT[lv * 3], LAND_LUT[lv * 3 + 1], LAND_LUT[lv * 3 + 2]];
}

/** Nearest mapper height whose palette color matches RGB (ignores lighting). */
export function heightForPaletteRgb(
  r: number,
  g: number,
  b: number,
  waterLevel = WATER_LEVEL,
): number {
  let bestH = 0;
  let bestD = Infinity;
  const maxH = waterLevel + LAND_MAX;
  for (let h = 0; h <= maxH; h++) {
    const c = paletteRgbForHeight(h, waterLevel);
    const d = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2;
    if (d < bestD) {
      bestD = d;
      bestH = h;
      if (d === 0) break;
    }
  }
  return bestH;
}

export function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.max(0, Math.min(255, n | 0)).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function hexToRgb(hex: string): [number, number, number] {
  const s = hex.replace("#", "");
  if (s.length === 3) {
    return [
      parseInt(s[0] + s[0], 16),
      parseInt(s[1] + s[1], 16),
      parseInt(s[2] + s[2], 16),
    ];
  }
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

export function normalize(p: [number, number, number]): [number, number, number] {
  const n = Math.sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2]);
  if (!n) return [0, 0, 0];
  return [p[0] / n, p[1] / n, p[2] / n];
}

export const LIGHT_DIR = normalize([1, -5, -1]);

function sampleH(pixels: Uint16Array, xSize: number, x: number, y: number): number {
  return pixels[y * xSize + x] / 10;
}

function shadePixel(
  pixels: Uint16Array,
  ySize: number,
  xSize: number,
  x: number,
  y: number,
  waterLevel: number,
  lightDir: [number, number, number],
): [number, number, number] {
  const H = sampleH(pixels, xSize, x, y);
  let dx = 0;
  let dy = 0;
  let interior = false;
  if (y > 0 && y < ySize - 1 && x > 0 && x < xSize - 1) {
    dx = sampleH(pixels, xSize, x - 1, y) - sampleH(pixels, xSize, x + 1, y);
    dy = sampleH(pixels, xSize, x, y - 1) - sampleH(pixels, xSize, x, y + 1);
    interior = true;
  }
  const mag = Math.sqrt(dx * dx + dy * dy + 4);
  const nx = interior ? dx / mag : 0;
  const ny = interior ? 2 / mag : 0;
  const nz = interior ? dy / mag : 0;
  const n = ny * 255;
  const light = nx * lightDir[0] + ny * lightDir[1] + nz * lightDir[2];
  const c = light < 0 ? 191 - ((light * 64) | 0) : 255;
  if (H < waterLevel) {
    let wv = (waterLevel - H) | 0;
    if (wv < 0) wv = 0;
    if (wv > WATER_MAX) wv = WATER_MAX;
    return [WATER_LUT[wv * 3], WATER_LUT[wv * 3 + 1], WATER_LUT[wv * 3 + 2]];
  }
  if (n < 20) {
    const half = c >> 1;
    return [half, half, half];
  }
  let lv = (H - waterLevel) | 0;
  if (lv < 0) lv = 0;
  if (lv > LAND_MAX) lv = LAND_MAX;
  return [
    (LAND_LUT[lv * 3] * c) >> 8,
    (LAND_LUT[lv * 3 + 1] * c) >> 8,
    (LAND_LUT[lv * 3 + 2] * c) >> 8,
  ];
}

/** `height` is float32 row-major (already /10, same as desktop save path). */
export function onePassColors(
  ySize: number,
  xSize: number,
  height: Float32Array,
  waterLevel = WATER_LEVEL,
  lightDir: [number, number, number] = LIGHT_DIR,
): Uint8Array {
  const png = new Uint16Array(height.length);
  for (let i = 0; i < height.length; i++) {
    const v = height[i] * 10;
    png[i] = v < 0 ? 0 : v > 65535 ? 65535 : v;
  }
  const rgb = new Uint8Array(ySize * xSize * 3);
  for (let y = 0; y < ySize; y++) {
    for (let x = 0; x < xSize; x++) {
      const col = shadePixel(png, ySize, xSize, x, y, waterLevel, lightDir);
      const o = (y * xSize + x) * 3;
      rgb[o] = col[0];
      rgb[o + 1] = col[1];
      rgb[o + 2] = col[2];
    }
  }
  return rgb;
}

/** Recolor a rectangle in an ImageData from PNG uint16 heights. Expands 1px for lighting. */
export function recolorPatch(
  data: ImageData,
  pixels: Uint16Array,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  waterLevel = WATER_LEVEL,
): void {
  const w = data.width;
  const h = data.height;
  const rx0 = Math.max(0, x0 - 1);
  const ry0 = Math.max(0, y0 - 1);
  const rx1 = Math.min(w - 1, x1 + 1);
  const ry1 = Math.min(h - 1, y1 + 1);
  for (let y = ry0; y <= ry1; y++) {
    for (let x = rx0; x <= rx1; x++) {
      const col = shadePixel(pixels, h, w, x, y, waterLevel, LIGHT_DIR);
      const o = (y * w + x) * 4;
      data.data[o] = col[0];
      data.data[o + 1] = col[1];
      data.data[o + 2] = col[2];
      data.data[o + 3] = 255;
    }
  }
}

const THUMB_W = 514;
const THUMB_H = 428;
const SENTINEL = 0x7f7f7f7f;

export function generateImage(
  ySize: number,
  xSize: number,
  height: Float32Array,
  colors: Uint8Array,
  waterLevel = WATER_LEVEL,
): { minx: number; miny: number; maxx: number; maxy: number; img: Uint8Array; alpha: Uint8Array } {
  const img1 = new Uint8Array(THUMB_H * THUMB_W * 3);
  const img2 = new Uint8Array(THUMB_H * THUMB_W * 3);
  const minYmap = new Int32Array(THUMB_W);
  const maxYmap = new Int32Array(THUMB_W);
  minYmap.fill(SENTINEL);
  let minx = THUMB_W;
  let miny = THUMB_H;
  let maxx = 0;
  let maxy = 0;

  for (let y = 0; y < ySize; y++) {
    for (let x = 0; x < xSize; x++) {
      let x2 = (x * (512 - 150)) / 256 + 150 - (150 * y) / 256;
      let y2 = (y * 181) / 256 + (75 * x) / 256;
      let yBase = y2;
      let h = height[y * xSize + x];
      if (h < waterLevel) h = waterLevel;
      h *= 21 / 250;
      y2 -= h;
      y2 += THUMB_H - 256;
      yBase += THUMB_H - 256;
      if (y2 < 0) y2 = 0;
      if (y2 < miny) miny = y2 | 0;
      if (yBase > maxy) maxy = yBase | 0;
      if (x2 < minx) minx = x2 | 0;
      if (x2 > maxx) maxx = x2 | 0;
      const ix2 = x2 | 0;
      const iy2 = y2 | 0;
      if (ix2 >= 0 && ix2 < THUMB_W) {
        if (minYmap[ix2] > iy2) minYmap[ix2] = iy2;
        if (maxYmap[ix2] < iy2) maxYmap[ix2] = iy2;
      }
      const j1 = yBase | 0;
      const cr = colors[(y * xSize + x) * 3];
      const cg = colors[(y * xSize + x) * 3 + 1];
      const cb = colors[(y * xSize + x) * 3 + 2];
      if (j1 > iy2 && ix2 >= 0 && ix2 < THUMB_W) {
        const y0 = Math.max(0, iy2);
        const y1 = Math.min(THUMB_H, j1);
        for (let yy = y0; yy < y1; yy++) {
          const p = (yy * THUMB_W + ix2) * 3;
          img1[p] = cr;
          img1[p + 1] = cg;
          img1[p + 2] = cb;
          img2[p + 2] = 255;
        }
      }
    }
  }

  for (let x = minx | 0; x < (maxx | 0); x++) {
    const lo = minYmap[x];
    if (lo === SENTINEL) continue;
    const p0 = (lo * THUMB_W + x) * 3;
    img2[p0] = 255;
    img2[p0 + 1] = 255;
    const hi = maxYmap[x];
    const p1 = (hi * THUMB_W + x) * 3;
    img2[p1] = 255;
    img2[p1 + 1] = 255;
  }

  return { minx: minx | 0, miny: miny | 0, maxx: maxx | 0, maxy: maxy | 0, img: img1, alpha: img2 };
}

function cropRgb(
  src: Uint8Array,
  srcW: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
): { w: number; h: number; data: Uint8Array } {
  left = Math.max(0, left);
  top = Math.max(0, top);
  right = Math.min(srcW, right);
  bottom = Math.min(THUMB_H, bottom);
  const w = Math.max(1, right - left);
  const h = Math.max(1, bottom - top);
  const data = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    const srcOff = ((top + y) * srcW + left) * 3;
    data.set(src.subarray(srcOff, srcOff + w * 3), y * w * 3);
  }
  return { w, h, data };
}

function rgbToRgba(rgb: Uint8Array, alpha: Uint8Array | number): Uint8Array {
  const n = rgb.length / 3;
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    out[i * 4] = rgb[i * 3];
    out[i * 4 + 1] = rgb[i * 3 + 1];
    out[i * 4 + 2] = rgb[i * 3 + 2];
    out[i * 4 + 3] = typeof alpha === "number" ? alpha : alpha[i * 3 + 2];
  }
  return out;
}

export function buildThumbnails(
  ySize: number,
  xSize: number,
  height: Float32Array,
  colors: Uint8Array,
): { regionPng: Uint8Array; alphaPng: Uint8Array } {
  const g = generateImage(ySize, xSize, height, colors);
  const maxx = g.maxx + 2;
  const colorCrop = cropRgb(g.img, THUMB_W, g.minx, g.miny, maxx, g.maxy);
  const alphaCrop = cropRgb(g.alpha, THUMB_W, g.minx, g.miny, maxx, g.maxy);
  return {
    regionPng: encodeRgbaPng(colorCrop.w, colorCrop.h, rgbToRgba(colorCrop.data, alphaCrop.data)),
    alphaPng: encodeRgbaPng(alphaCrop.w, alphaCrop.h, rgbToRgba(alphaCrop.data, 0)),
  };
}
