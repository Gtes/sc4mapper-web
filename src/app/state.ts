/**
 * Shared editor state. Feature modules mutate this object.
 * Add a tool: extend EditMode, then wire UI in tools/map-tools.ts and events in main.ts.
 */
import { cloneCities, type City, type CitySize, type Gray16Image, WATER_LEVEL, onePassColors, type Templates } from "../lib/sc4mapper";
import { PAINT_GREEN, type HealStroke } from "../tools/paint";

export type EditMode = "none" | "small" | "medium" | "big" | "erase" | "draw" | "stamp";

export type HotState = {
  image: Gray16Image | null;
  tilesX: number;
  tilesY: number;
  cities: City[];
  originalCities: City[];
  templates: Templates | null;
  regionName: string;
  status: string;
  editMode: EditMode;
  overlay: boolean;
  zoom: number;
  panX: number;
  panY: number;
};

export type AppState = {
  image: Gray16Image | null;
  tilesX: number;
  tilesY: number;
  cities: City[];
  originalCities: City[];
  templates: Templates | null;
  preview: ImageData | null;
  editMode: EditMode;
  overlayOn: boolean;
  hover: { x: number; y: number } | null;
  hoverPx: { x: number; y: number } | null;
  painting: boolean;
  sampling: boolean;
  lastPaint: { x: number; y: number } | null;
  undoPixels: Uint16Array | null;
  undoPreview: ImageData | null;
  strokeCities: City[] | null;
  stampStroke: HealStroke | null;
  stampSource: { x: number; y: number } | null;
  stampAlign: { ox: number; oy: number } | null;
  customMapper: number;
  zoom: number;
  panX: number;
  panY: number;
  spaceDown: boolean;
  zDown: boolean;
  altDown: boolean;
  panning: boolean;
  panOrigin: { x: number; y: number; panX: number; panY: number };
  exportBusy: boolean;
  draftTimer: number;
  draftEpoch: number;
};

export function createAppState(): AppState {
  return {
    image: null,
    tilesX: 0,
    tilesY: 0,
    cities: [],
    originalCities: [],
    templates: null,
    preview: null,
    editMode: "none",
    overlayOn: true,
    hover: null,
    hoverPx: null,
    painting: false,
    sampling: false,
    lastPaint: null,
    undoPixels: null,
    undoPreview: null,
    strokeCities: null,
    stampStroke: null,
    stampSource: null,
    stampAlign: null,
    customMapper: PAINT_GREEN,
    zoom: 1,
    panX: 0,
    panY: 0,
    spaceDown: false,
    zDown: false,
    altDown: false,
    panning: false,
    panOrigin: { x: 0, y: 0, panX: 0, panY: 0 },
    exportBusy: false,
    draftTimer: 0,
    draftEpoch: 0,
  };
}

export function isBrushMode(mode: EditMode): boolean {
  return mode === "draw" || mode === "stamp";
}

export function sizeForMode(mode: EditMode): CitySize | null {
  if (mode === "small") return 1;
  if (mode === "medium") return 2;
  if (mode === "big") return 4;
  return null;
}

export function cityCountStatus(s: AppState): string {
  if (!s.image) return "";
  return `${s.image.width}×${s.image.height} · ${s.tilesX}×${s.tilesY} tiles · ${s.cities.length} cities`;
}

export function sanitizeName(name: string): string {
  const trimmed = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").trim() || "New Region";
  return trimmed.slice(0, 80);
}

export function isTextEntry(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement) return true;
  if (!(target instanceof HTMLInputElement)) return false;
  return target.type === "text" || target.type === "search" || target.type === "number" || target.type === "password";
}

export function buildPreview(img: Gray16Image): ImageData {
  const height = new Float32Array(img.pixels.length);
  for (let i = 0; i < img.pixels.length; i++) height[i] = img.pixels[i] / 10;
  const rgb = onePassColors(img.height, img.width, height, WATER_LEVEL);
  const data = new ImageData(img.width, img.height);
  for (let i = 0; i < img.pixels.length; i++) {
    data.data[i * 4] = rgb[i * 3];
    data.data[i * 4 + 1] = rgb[i * 3 + 1];
    data.data[i * 4 + 2] = rgb[i * 3 + 2];
    data.data[i * 4 + 3] = 255;
  }
  return data;
}

export async function loadTemplates(): Promise<Templates> {
  const load = async (name: string) => {
    const res = await fetch(`./assets/City - ${name}.sc4`);
    if (!res.ok) throw new Error(`missing template City - ${name}.sc4`);
    return new Uint8Array(await res.arrayBuffer());
  };
  return {
    small: await load("Small"),
    medium: await load("Medium"),
    large: await load("Large"),
  };
}

export function mapPixelFromEvent(
  s: AppState,
  canvas: HTMLCanvasElement,
  e: MouseEvent,
): { x: number; y: number } | null {
  if (!s.image) return null;
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const x = Math.floor(((e.clientX - rect.left) / rect.width) * s.image.width);
  const y = Math.floor(((e.clientY - rect.top) / rect.height) * s.image.height);
  if (x < 0 || y < 0 || x >= s.image.width || y >= s.image.height) return null;
  return { x, y };
}

export function tileFromEvent(
  s: AppState,
  canvas: HTMLCanvasElement,
  e: MouseEvent,
): { tx: number; ty: number } | null {
  if (!s.image) return null;
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  if (
    e.clientX < rect.left || e.clientX >= rect.right ||
    e.clientY < rect.top || e.clientY >= rect.bottom
  ) {
    return null;
  }
  const x = ((e.clientX - rect.left) / rect.width) * s.tilesX;
  const y = ((e.clientY - rect.top) / rect.height) * s.tilesY;
  const tx = Math.min(s.tilesX - 1, Math.max(0, Math.floor(x)));
  const ty = Math.min(s.tilesY - 1, Math.max(0, Math.floor(y)));
  return { tx, ty };
}

export function parseEditMode(value: string | undefined): EditMode {
  if (value === "heal" || value === "stamp") return "stamp";
  if (
    value === "none" || value === "small" || value === "medium" ||
    value === "big" || value === "erase" || value === "draw"
  ) {
    return value;
  }
  return "none";
}

export function snapshotHotState(
  s: AppState,
  regionName: string,
  status: string,
): HotState {
  return {
    image: s.image,
    tilesX: s.tilesX,
    tilesY: s.tilesY,
    cities: s.cities,
    originalCities: s.originalCities,
    templates: s.templates,
    regionName,
    status,
    editMode: s.editMode,
    overlay: s.overlayOn,
    zoom: s.zoom,
    panX: s.panX,
    panY: s.panY,
  };
}

export function applyHotState(s: AppState, restored: HotState): void {
  s.image = restored.image;
  s.tilesX = restored.tilesX;
  s.tilesY = restored.tilesY;
  s.cities = restored.cities;
  s.originalCities = restored.originalCities?.length
    ? restored.originalCities
    : cloneCities(restored.cities);
  s.templates = restored.templates;
  s.editMode = parseEditMode(restored.editMode);
  s.overlayOn = restored.overlay !== false;
  if (restored.zoom && restored.zoom > 0) s.zoom = restored.zoom;
  if (typeof restored.panX === "number") s.panX = restored.panX;
  if (typeof restored.panY === "number") s.panY = restored.panY;
}
