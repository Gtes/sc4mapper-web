import { WATER_LEVEL, recolorPatch } from "./terrain";

/** Mapper units (PNG/10). Water is below 250. */
export const PAINT_WATER = 200;
export const PAINT_GREEN = 400;

export type PaintPreset = "water" | "green" | "custom";

export function paintTargetPng(preset: PaintPreset, customMapper = PAINT_GREEN): number {
  const mapper = preset === "water" ? PAINT_WATER : preset === "green" ? PAINT_GREEN : customMapper;
  return Math.max(0, Math.min(65535, Math.round(mapper * 10)));
}

/** softness 0 = hard disk, 1 = fade from center. */
export function brushWeight(dist: number, radius: number, softness: number): number {
  if (dist >= radius) return 0;
  const s = Math.min(1, Math.max(0, softness));
  if (s <= 0) return 1;
  const u = dist / radius;
  const core = 1 - s;
  if (u <= core) return 1;
  const f = (u - core) / s;
  const sm = f * f * f * (f * (f * 6 - 15) + 10);
  const t = 1 - sm;
  return t * t * (3 - 2 * t);
}

function distToSegment(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const vx = x1 - x0;
  const vy = y1 - y0;
  const len2 = vx * vx + vy * vy;
  if (len2 < 1e-8) return Math.hypot(px - x0, py - y0);
  let t = ((px - x0) * vx + (py - y0) * vy) / len2;
  t = Math.min(1, Math.max(0, t));
  return Math.hypot(px - (x0 + t * vx), py - (y0 + t * vy));
}

function blendToward(
  pixels: Uint16Array,
  baseline: Uint16Array | null,
  i: number,
  target: number,
  t: number,
): void {
  if (t <= 0) return;
  const base = baseline ? baseline[i] : pixels[i];
  const next = Math.round(base + (target - base) * t);
  const clamped = next < 0 ? 0 : next > 65535 ? 65535 : next;
  if (!baseline) {
    pixels[i] = clamped;
    return;
  }
  if (Math.abs(clamped - target) < Math.abs(pixels[i] - target)) {
    pixels[i] = clamped;
  }
}

function paintCapsule(
  pixels: Uint16Array,
  preview: ImageData,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number,
  target: number,
  softness: number,
  baseline: Uint16Array | null,
): { x0: number; y0: number; x1: number; y1: number } | null {
  const r = Math.max(1, radius);
  const minx = Math.max(0, Math.floor(Math.min(x0, x1) - r));
  const miny = Math.max(0, Math.floor(Math.min(y0, y1) - r));
  const maxx = Math.min(width - 1, Math.ceil(Math.max(x0, x1) + r));
  const maxy = Math.min(height - 1, Math.ceil(Math.max(y0, y1) + r));
  if (maxx < minx || maxy < miny) return null;
  for (let y = miny; y <= maxy; y++) {
    for (let x = minx; x <= maxx; x++) {
      const t = brushWeight(distToSegment(x, y, x0, y0, x1, y1), r, softness);
      if (t <= 0) continue;
      blendToward(pixels, baseline, y * width + x, target, t);
    }
  }
  recolorPatch(preview, pixels, minx, miny, maxx, maxy, WATER_LEVEL);
  return { x0: minx, y0: miny, x1: maxx, y1: maxy };
}

export function paintDab(
  pixels: Uint16Array,
  preview: ImageData,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
  target: number,
  softness: number,
  baseline: Uint16Array | null = null,
): { x0: number; y0: number; x1: number; y1: number } | null {
  return paintCapsule(pixels, preview, width, height, cx, cy, cx, cy, radius, target, softness, baseline);
}

export function paintLine(
  pixels: Uint16Array,
  preview: ImageData,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number,
  target: number,
  softness: number,
  baseline: Uint16Array | null = null,
): void {
  paintCapsule(pixels, preview, width, height, x0, y0, x1, y1, radius, target, softness, baseline);
}

export type HealStroke = {
  ox: number;
  oy: number;
  w: number;
  h: number;
};

export function beginHealStroke(
  _baseline: Uint16Array,
  width: number,
  height: number,
  ox: number,
  oy: number,
): HealStroke {
  return { ox, oy, w: width, h: height };
}

function healCapsule(
  pixels: Uint16Array,
  preview: ImageData,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number,
  softness: number,
  baseline: Uint16Array,
  stroke: HealStroke,
): void {
  const r = Math.max(1, radius);
  const minx = Math.max(0, Math.floor(Math.min(x0, x1) - r));
  const miny = Math.max(0, Math.floor(Math.min(y0, y1) - r));
  const maxx = Math.min(width - 1, Math.ceil(Math.max(x0, x1) + r));
  const maxy = Math.min(height - 1, Math.ceil(Math.max(y0, y1) + r));
  if (maxx < minx || maxy < miny) return;
  const w = stroke.w;
  const h = stroke.h;
  for (let y = miny; y <= maxy; y++) {
    for (let x = minx; x <= maxx; x++) {
      const t = brushWeight(distToSegment(x, y, x0, y0, x1, y1), r, softness);
      if (t <= 0) continue;
      const sx = x + stroke.ox;
      const sy = y + stroke.oy;
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
      blendToward(pixels, baseline, y * width + x, baseline[sy * w + sx], t);
    }
  }
  recolorPatch(preview, pixels, minx, miny, maxx, maxy, WATER_LEVEL);
}

export function healDab(
  pixels: Uint16Array,
  preview: ImageData,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
  softness: number,
  baseline: Uint16Array,
  stroke: HealStroke,
): void {
  healCapsule(pixels, preview, width, height, cx, cy, cx, cy, radius, softness, baseline, stroke);
}

export function healLine(
  pixels: Uint16Array,
  preview: ImageData,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number,
  softness: number,
  baseline: Uint16Array,
  stroke: HealStroke,
): void {
  healCapsule(pixels, preview, width, height, x0, y0, x1, y1, radius, softness, baseline, stroke);
}
