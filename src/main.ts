import {
  buildBestCities,
  clampCityOrigin,
  cloneCities,
  eraseCityAt,
  placeCity,
  type City,
  type CitySize,
} from "./grid";
import { decodeGray16Png, tilesFromPixels, type Gray16Image } from "./png16";
import {
  PAINT_GREEN,
  PAINT_WATER,
  beginHealStroke,
  healDab,
  healLine,
  paintDab,
  paintLine,
  paintTargetPng,
  type HealStroke,
  type PaintPreset,
} from "./paint";
import {
  WATER_LEVEL,
  heightForPaletteRgb,
  hexToRgb,
  onePassColors,
  paletteRgbForHeight,
  rgbToHex,
} from "./terrain";
import "./style.css";
import type { Templates, WorkerRequest } from "./export";
import ExportWorker from "./export.worker.ts?worker";
import { clearDraft, loadDraft, saveDraft } from "./draft";

const drop = document.getElementById("drop") as HTMLLabelElement;
const fileInput = document.getElementById("file") as HTMLInputElement;
const nameInput = document.getElementById("name") as HTMLInputElement;
const downloadBtn = document.getElementById("download") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLParagraphElement;
const canvas = document.getElementById("view") as HTMLCanvasElement;
const viewPane = document.getElementById("view-pane") as HTMLElement;
const zoomBar = document.getElementById("zoom-bar") as HTMLDivElement;
const zoomInBtn = document.getElementById("zoom-in") as HTMLButtonElement;
const zoomOutBtn = document.getElementById("zoom-out") as HTMLButtonElement;
const zoomFitBtn = document.getElementById("zoom-fit") as HTMLButtonElement;
const zoomVal = document.getElementById("zoom-val") as HTMLInputElement;
const hintEl = document.getElementById("hint") as HTMLParagraphElement;
const overlayCbx = document.getElementById("overlay") as HTMLInputElement;
const btnSmall = document.getElementById("tool-small") as HTMLButtonElement;
const btnMedium = document.getElementById("tool-medium") as HTMLButtonElement;
const btnBig = document.getElementById("tool-big") as HTMLButtonElement;
const btnErase = document.getElementById("tool-erase") as HTMLButtonElement;
const btnDraw = document.getElementById("tool-draw") as HTMLButtonElement;
const btnStamp = document.getElementById("tool-stamp") as HTMLButtonElement;
const btnRevert = document.getElementById("tool-revert") as HTMLButtonElement;
const btnUndo = document.getElementById("tool-undo") as HTMLButtonElement;
const btnRedo = document.getElementById("tool-redo") as HTMLButtonElement;
const btnReset = document.getElementById("tool-reset") as HTMLButtonElement;
const resetDialog = document.getElementById("reset-dialog") as HTMLDialogElement;
const helpBtn = document.getElementById("help-btn") as HTMLButtonElement;
const helpDialog = document.getElementById("help-dialog") as HTMLDialogElement;
const drawOpts = document.getElementById("draw-opts") as HTMLDivElement;
const brushOptsLabel = document.getElementById("brush-opts-label") as HTMLSpanElement;
const paintColorOpts = document.getElementById("paint-color-opts") as HTMLDivElement;
const paintWater = document.getElementById("paint-water") as HTMLInputElement;
const paintGreen = document.getElementById("paint-green") as HTMLInputElement;
const paintCustom = document.getElementById("paint-custom") as HTMLInputElement;
const paintColorEl = document.getElementById("paint-color") as HTMLInputElement;
const paintSampleBtn = document.getElementById("paint-sample") as HTMLButtonElement;
const paintHeightVal = document.getElementById("paint-height-val") as HTMLSpanElement;
const brushSizeEl = document.getElementById("brush-size") as HTMLInputElement;
const brushSizeVal = document.getElementById("brush-size-val") as HTMLSpanElement;
const brushSoftEl = document.getElementById("brush-soft") as HTMLInputElement;
const brushSoftVal = document.getElementById("brush-soft-val") as HTMLSpanElement;
const modeButtons = [btnSmall, btnMedium, btnBig, btnErase, btnDraw, btnStamp];
const ctx = canvas.getContext("2d")!;
const ac = new AbortController();
const { signal } = ac;

type EditMode = "none" | "small" | "medium" | "big" | "erase" | "draw" | "heal";

type HotState = {
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

let image: Gray16Image | null = null;
let tilesX = 0;
let tilesY = 0;
let cities: City[] = [];
let originalCities: City[] = [];
let templates: Templates | null = null;
let preview: ImageData | null = null;
let editMode: EditMode = "none";
let overlayOn = true;
let hover: { x: number; y: number } | null = null;
let hoverPx: { x: number; y: number } | null = null;
let painting = false;
let sampling = false;
let lastPaint: { x: number; y: number } | null = null;
let undoPixels: Uint16Array | null = null;
let undoPreview: ImageData | null = null;
let strokeCities: City[] | null = null;
let healStroke: HealStroke | null = null;
let healSource: { x: number; y: number } | null = null;
let healAlign: { ox: number; oy: number } | null = null;
let customMapper = PAINT_GREEN;
let zoom = 1;
let panX = 0;
let panY = 0;
let spaceDown = false;
let zDown = false;
let altDown = false;
let panning = false;
let panOrigin = { x: 0, y: 0, panX: 0, panY: 0 };

const ZOOM_MAX = 16;
const ZOOM_STEP = 1.25;

let exportWorker: Worker | null = null;
let exportBusy = false;
let draftTimer = 0;
let draftEpoch = 0;

function getExportWorker(): Worker {
  if (exportWorker) return exportWorker;
  exportWorker = new ExportWorker();
  return exportWorker;
}

function pixelsCopy(): ArrayBuffer {
  if (!image) return new ArrayBuffer(0);
  const copy = new Uint16Array(image.pixels.length);
  copy.set(image.pixels);
  return copy.buffer;
}

function writeDraft(): void {
  if (!image) return;
  const epoch = draftEpoch;
  void saveDraft({
    pixels: pixelsCopy(),
    width: image.width,
    height: image.height,
    tilesX,
    tilesY,
    cities,
    originalCities,
    regionName: nameInput.value,
    overlay: overlayOn,
  }).then(() => {
    if (epoch !== draftEpoch) return clearDraft();
  }).catch(() => {
    /* keep editing if storage is unavailable */
  });
}

function scheduleDraftSave(): void {
  if (!image) return;
  window.clearTimeout(draftTimer);
  draftTimer = window.setTimeout(writeDraft, 400);
}

const restored = import.meta.hot?.data.state as HotState | undefined;
if (restored) {
  image = restored.image;
  tilesX = restored.tilesX;
  tilesY = restored.tilesY;
  cities = restored.cities;
  originalCities = restored.originalCities?.length
    ? restored.originalCities
    : cloneCities(restored.cities);
  templates = restored.templates;
  if (restored.regionName) nameInput.value = restored.regionName;
  editMode = restored.editMode ?? "none";
  overlayOn = restored.overlay !== false;
  overlayCbx.checked = overlayOn;
  if (restored.zoom && restored.zoom > 0) zoom = restored.zoom;
  if (typeof restored.panX === "number") panX = restored.panX;
  if (typeof restored.panY === "number") panY = restored.panY;
}

if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose((data) => {
    ac.abort();
    data.state = {
      image,
      tilesX,
      tilesY,
      cities,
      originalCities,
      templates,
      regionName: nameInput.value,
      status: statusEl.textContent ?? "",
      editMode,
      overlay: overlayOn,
      zoom,
      panX,
      panY,
    } satisfies HotState;
  });
}

function setStatus(msg: string): void {
  statusEl.textContent = msg;
}

type HistoryEntry = {
  pixels: Uint16Array;
  preview: ImageData;
  cities: City[];
};

const HISTORY_MAX = 40;
let undoStack: HistoryEntry[] = [];
let redoStack: HistoryEntry[] = [];

function syncHistoryButtons(): void {
  const on = Boolean(image);
  btnUndo.disabled = !on || (undoStack.length === 0 && !(painting && undoPixels));
  btnRedo.disabled = !on || redoStack.length === 0;
}

function snapshotState(): HistoryEntry | null {
  if (!image || !preview) return null;
  return {
    pixels: Uint16Array.from(image.pixels),
    preview: new ImageData(new Uint8ClampedArray(preview.data), preview.width, preview.height),
    cities: cloneCities(cities),
  };
}

function restoreState(entry: HistoryEntry): void {
  if (!image || !preview) return;
  image.pixels.set(entry.pixels);
  preview.data.set(entry.preview.data);
  cities = cloneCities(entry.cities);
  healStroke = null;
  draw();
  syncHistoryButtons();
  scheduleDraftSave();
}

function checkpoint(): void {
  const snap = snapshotState();
  if (!snap) return;
  undoStack.push(snap);
  if (undoStack.length > HISTORY_MAX) undoStack.shift();
  redoStack = [];
  syncHistoryButtons();
}

function commitStrokeHistory(): void {
  if (!undoPixels || !undoPreview || !strokeCities) return;
  undoStack.push({
    pixels: undoPixels,
    preview: undoPreview,
    cities: strokeCities,
  });
  if (undoStack.length > HISTORY_MAX) undoStack.shift();
  redoStack = [];
  undoPixels = null;
  undoPreview = null;
  strokeCities = null;
  syncHistoryButtons();
}

function undo(): void {
  if (!image || !preview) return;
  if (painting && undoPixels && undoPreview) {
    image.pixels.set(undoPixels);
    preview.data.set(undoPreview.data);
    painting = false;
    lastPaint = null;
    healStroke = null;
    undoPixels = null;
    undoPreview = null;
    strokeCities = null;
    draw();
    syncHistoryButtons();
    setStatus(`${cityCountStatus()} (stroke cancelled)`);
    return;
  }
  if (!undoStack.length) return;
  const current = snapshotState();
  if (current) redoStack.push(current);
  restoreState(undoStack.pop()!);
  setStatus(`${cityCountStatus()} (undo)`);
}

function redo(): void {
  if (!image || !preview || !redoStack.length) return;
  const current = snapshotState();
  if (current) {
    undoStack.push(current);
    if (undoStack.length > HISTORY_MAX) undoStack.shift();
  }
  restoreState(redoStack.pop()!);
  setStatus(`${cityCountStatus()} (redo)`);
}

function setToolsEnabled(on: boolean): void {
  for (const b of [...modeButtons, btnRevert]) b.disabled = !on;
  btnUndo.disabled = !on || (undoStack.length === 0 && !(painting && undoPixels));
  btnRedo.disabled = !on || redoStack.length === 0;
  brushSizeEl.disabled = !on;
  brushSoftEl.disabled = !on;
  paintWater.disabled = !on;
  paintGreen.disabled = !on;
  paintCustom.disabled = !on;
  paintColorEl.disabled = !on;
  paintSampleBtn.disabled = !on;
  zoomInBtn.disabled = !on;
  zoomOutBtn.disabled = !on;
  zoomFitBtn.disabled = !on;
  zoomVal.disabled = !on;
  zoomBar.hidden = !on;
}

function sizeForMode(mode: EditMode): CitySize | null {
  if (mode === "small") return 1;
  if (mode === "medium") return 2;
  if (mode === "big") return 4;
  return null;
}

function isBrushMode(mode = editMode): boolean {
  return mode === "draw" || mode === "heal";
}

function syncToolButtons(): void {
  btnSmall.classList.toggle("active", editMode === "small");
  btnMedium.classList.toggle("active", editMode === "medium");
  btnBig.classList.toggle("active", editMode === "big");
  btnErase.classList.toggle("active", editMode === "erase");
  btnDraw.classList.toggle("active", editMode === "draw");
  btnStamp.classList.toggle("active", editMode === "heal");
  drawOpts.hidden = !isBrushMode();
  paintColorOpts.hidden = editMode !== "draw";
  brushOptsLabel.textContent = editMode === "heal" ? "Stamp" : "Paint";
  canvas.classList.toggle("drawing", isBrushMode());
  const hints: Record<EditMode, string> = {
    none: "Select a tool, then click the map. Space-drag pans · Z-click zooms in · Alt+Z-click zooms out.",
    small: "Click to place a small (1×1) city. Overlapping tiles are replaced.",
    medium: "Click to place a medium (2×2) city.",
    big: "Click to place a big (4×4) city.",
    erase: "Click a city to remove it from the config.",
    draw: sampling
      ? "Click the map to sample a nearby color, then adjust the picker."
      : "Drag to paint. Space-drag pans · Z-click zooms in · Alt+Z-click zooms out.",
    heal: healSource
      ? "Drag to clone the Alt-picked terrain (height + grain). Alt-click to pick a new source."
      : "Alt-click green (or any terrain) to set source, then drag to stamp it.",
  };
  hintEl.textContent = hints[editMode];
  paintSampleBtn.classList.toggle("active", sampling);
  canvas.classList.toggle("sampling", sampling);
  canvas.classList.toggle("heal-pick", editMode === "heal" && altDown);
}

function setEditMode(mode: EditMode): void {
  editMode = editMode === mode ? "none" : mode;
  hover = null;
  hoverPx = null;
  painting = false;
  sampling = false;
  lastPaint = null;
  syncToolButtons();
  draw();
}

function mapPixelFromEvent(e: MouseEvent): { x: number; y: number } | null {
  if (!image) return null;
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const x = Math.floor(((e.clientX - rect.left) / rect.width) * image.width);
  const y = Math.floor(((e.clientY - rect.top) / rect.height) * image.height);
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return null;
  return { x, y };
}

function fitZoom(): number {
  if (!image) return 1;
  const pad = 24;
  const availW = Math.max(1, viewPane.clientWidth - pad);
  const availH = Math.max(1, viewPane.clientHeight - pad);
  return Math.min(availW / image.width, availH / image.height);
}

function clampZoom(z: number): number {
  return Math.min(ZOOM_MAX, Math.max(fitZoom() * 0.5, z));
}

function formatZoomPercent(z: number): string {
  const pct = Math.round(z * 1000) / 10;
  return Number.isInteger(pct) ? String(pct) : pct.toFixed(1);
}

function applyCanvasCssSize(): void {
  if (!image) return;
  canvas.style.width = `${image.width}px`;
  canvas.style.height = `${image.height}px`;
  canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  if (document.activeElement !== zoomVal) zoomVal.value = formatZoomPercent(zoom);
}

function commitZoomInput(): void {
  if (!image || canvas.hidden) {
    zoomVal.value = formatZoomPercent(zoom);
    return;
  }
  const pct = Number(zoomVal.value.replace("%", "").trim().replace(",", "."));
  if (!Number.isFinite(pct) || pct <= 0) {
    zoomVal.value = formatZoomPercent(zoom);
    return;
  }
  const r = viewPane.getBoundingClientRect();
  zoomAt(r.left + r.width / 2, r.top + r.height / 2, pct / 100);
  zoomVal.value = formatZoomPercent(zoom);
}

function zoomAt(clientX: number, clientY: number, next: number): void {
  if (!image || canvas.hidden) return;
  const z = clampZoom(next);
  const pane = viewPane.getBoundingClientRect();
  const mapX = (clientX - pane.left - panX) / zoom;
  const mapY = (clientY - pane.top - panY) / zoom;
  zoom = z;
  panX = clientX - pane.left - mapX * zoom;
  panY = clientY - pane.top - mapY * zoom;
  applyCanvasCssSize();
}

function zoomBy(factor: number, clientX?: number, clientY?: number): void {
  if (clientX != null && clientY != null) {
    zoomAt(clientX, clientY, zoom * factor);
    return;
  }
  const r = viewPane.getBoundingClientRect();
  zoomAt(r.left + r.width / 2, r.top + r.height / 2, zoom * factor);
}

function fitToView(): void {
  if (!image) return;
  zoom = fitZoom();
  panX = (viewPane.clientWidth - image.width * zoom) / 2;
  panY = (viewPane.clientHeight - image.height * zoom) / 2;
  applyCanvasCssSize();
}

function shouldPan(e: PointerEvent): boolean {
  return e.button === 1 || (e.button === 0 && spaceDown);
}

function syncNavCursor(): void {
  const pan = spaceDown || panning;
  viewPane.classList.toggle("space-nav", pan && !panning);
  viewPane.classList.toggle("panning", panning);
  viewPane.classList.toggle("zoom-in-nav", zDown && !altDown && !pan);
  viewPane.classList.toggle("zoom-out-nav", zDown && altDown && !pan);
}

function startPan(e: PointerEvent): void {
  panning = true;
  panOrigin = { x: e.clientX, y: e.clientY, panX, panY };
  syncNavCursor();
  try {
    viewPane.setPointerCapture(e.pointerId);
  } catch {
    /* already released */
  }
}

function movePan(e: PointerEvent): void {
  if (!panning) return;
  panX = panOrigin.panX + (e.clientX - panOrigin.x);
  panY = panOrigin.panY + (e.clientY - panOrigin.y);
  applyCanvasCssSize();
}

function endPan(): void {
  if (!panning) return;
  panning = false;
  syncNavCursor();
}

function handleNavPointerDown(e: PointerEvent): boolean {
  if (!image) return false;
  if (zDown && e.button === 0 && !spaceDown) {
    e.preventDefault();
    zoomBy(e.altKey || altDown ? 1 / ZOOM_STEP : ZOOM_STEP, e.clientX, e.clientY);
    return true;
  }
  if (shouldPan(e)) {
    e.preventDefault();
    startPan(e);
    return true;
  }
  return false;
}

function isTextEntry(el: EventTarget | null): boolean {
  if (el instanceof HTMLTextAreaElement) return true;
  if (!(el instanceof HTMLInputElement)) return false;
  return el.type === "text" || el.type === "search" || el.type === "number" || el.type === "password";
}

function screenLineWidth(): number {
  return 0.5 / Math.max(zoom, 0.01);
}

function strokeOutline(drawPath: () => void, dashed: boolean): void {
  ctx.setLineDash(dashed ? [Math.max(1, 4 / zoom), Math.max(1, 3 / zoom)] : []);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = "#000";
  ctx.lineWidth = screenLineWidth();
  ctx.beginPath();
  drawPath();
  ctx.stroke();
  ctx.setLineDash([]);
}

function strokeBrushRing(cx: number, cy: number, radius: number, dashed: boolean): void {
  if (radius < 0.5) return;
  strokeOutline(() => {
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  }, dashed);
}

function strokeCrosshair(cx: number, cy: number): void {
  const arm = Math.max(4, 8 / zoom);
  strokeOutline(() => {
    ctx.moveTo(cx - arm, cy);
    ctx.lineTo(cx + arm, cy);
    ctx.moveTo(cx, cy - arm);
    ctx.lineTo(cx, cy + arm);
  }, false);
}

function currentPreset(): PaintPreset {
  if (paintCustom.checked) return "custom";
  if (paintGreen.checked) return "green";
  return "water";
}

function currentMapperHeight(): number {
  const p = currentPreset();
  if (p === "water") return PAINT_WATER;
  if (p === "green") return PAINT_GREEN;
  return customMapper;
}

function syncColorUi(mapper: number, snapPicker: boolean): void {
  paintHeightVal.textContent = `height ${Math.round(mapper)}`;
  if (!snapPicker) return;
  const [r, g, b] = paletteRgbForHeight(mapper);
  paintColorEl.value = rgbToHex(r, g, b);
}

function setCustomFromMapper(mapper: number): void {
  customMapper = Math.max(0, Math.min(6000, mapper));
  paintCustom.checked = true;
  sampling = false;
  syncColorUi(customMapper, true);
  syncToolButtons();
}

function sampleAt(x: number, y: number): void {
  if (!image) return;
  setCustomFromMapper(image.pixels[y * image.width + x] / 10);
  setStatus(`${cityCountStatus()} · sampled height ${Math.round(customMapper)}`);
}

function beginStroke(hx: number, hy: number): boolean {
  if (!image || !preview) return false;
  if (editMode === "heal") {
    if (!healSource) {
      setStatus("Alt-click the map to set a Stamp source");
      return false;
    }
    if (!healAlign) {
      healAlign = { ox: healSource.x - hx, oy: healSource.y - hy };
    }
  }
  undoPixels = Uint16Array.from(image.pixels);
  undoPreview = new ImageData(new Uint8ClampedArray(preview.data), preview.width, preview.height);
  strokeCities = cloneCities(cities);
  syncHistoryButtons();
  healStroke = null;
  if (editMode === "heal" && healAlign) {
    healStroke = beginHealStroke(undoPixels, image.width, image.height, healAlign.ox, healAlign.oy);
  }
  return true;
}

function currentSoftness(): number {
  return Number(brushSoftEl.value) / 100;
}

function applyDab(x: number, y: number, from: { x: number; y: number } | null): void {
  if (!image || !preview) return;
  const radius = Number(brushSizeEl.value);
  const softness = currentSoftness();
  if (editMode === "heal") {
    if (!undoPixels || !healStroke) return;
    if (from) {
      healLine(
        image.pixels,
        preview,
        image.width,
        image.height,
        from.x,
        from.y,
        x,
        y,
        radius,
        softness,
        undoPixels,
        healStroke,
      );
    } else {
      healDab(
        image.pixels,
        preview,
        image.width,
        image.height,
        x,
        y,
        radius,
        softness,
        undoPixels,
        healStroke,
      );
    }
    return;
  }
  const target = paintTargetPng(currentPreset(), customMapper);
  if (from) {
    paintLine(
      image.pixels,
      preview,
      image.width,
      image.height,
      from.x,
      from.y,
      x,
      y,
      radius,
      target,
      softness,
      undoPixels,
    );
  } else {
    paintDab(
      image.pixels,
      preview,
      image.width,
      image.height,
      x,
      y,
      radius,
      target,
      softness,
      undoPixels,
    );
  }
}

function tileFromEvent(e: MouseEvent): { tx: number; ty: number } | null {
  if (!image) return null;
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  if (
    e.clientX < rect.left || e.clientX >= rect.right ||
    e.clientY < rect.top || e.clientY >= rect.bottom
  ) {
    return null;
  }
  const x = ((e.clientX - rect.left) / rect.width) * tilesX;
  const y = ((e.clientY - rect.top) / rect.height) * tilesY;
  const tx = Math.min(tilesX - 1, Math.max(0, Math.floor(x)));
  const ty = Math.min(tilesY - 1, Math.max(0, Math.floor(y)));
  return { tx, ty };
}

function cityCountStatus(): string {
  if (!image) return "";
  return `${image.width}×${image.height} · ${tilesX}×${tilesY} tiles · ${cities.length} cities`;
}

function sanitizeName(name: string): string {
  const s = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").trim() || "New Region";
  return s.slice(0, 80);
}

async function loadTemplates(): Promise<Templates> {
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

function buildPreview(img: Gray16Image): ImageData {
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

function draw(): void {
  if (!image || !preview) return;
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.hidden = false;
  applyCanvasCssSize();
  ctx.putImageData(preview, 0, 0);

  if (overlayOn) {
    ctx.strokeStyle = "rgba(200,200,200,0.55)";
  ctx.lineWidth = 1;
  for (let y = 1; y < tilesY; y++) {
    const py = y * 64 + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, py);
    ctx.lineTo(image.width, py);
    ctx.stroke();
  }
  for (let x = 1; x < tilesX; x++) {
    const px = x * 64 + 0.5;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, image.height);
    ctx.stroke();
  }

  for (const c of cities) {
    const color = c.size === 4 ? "#0000ff" : c.size === 2 ? "#00ff00" : "#ff0000";
    const x = c.x * 64 + 0.5;
    const y = c.y * 64 + 0.5;
    const w = c.size * 64;
    const h = c.size * 64;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  }
  }

  const placeSize = sizeForMode(editMode);
  if (placeSize && hover) {
    const origin = clampCityOrigin(hover.x, hover.y, placeSize, tilesX, tilesY);
    if (origin) {
      ctx.strokeStyle = placeSize === 4 ? "#88aaff" : placeSize === 2 ? "#88ff88" : "#ff8888";
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 6]);
      ctx.strokeRect(origin.x * 64 + 0.5, origin.y * 64 + 0.5, placeSize * 64, placeSize * 64);
      ctx.setLineDash([]);
    }
  }

  if (isBrushMode() && !spaceDown && !zDown && !panning) {
    if (editMode === "heal" && (altDown || healSource)) {
      if (altDown && hoverPx) {
        strokeCrosshair(hoverPx.x + 0.5, hoverPx.y + 0.5);
      } else if (healAlign && hoverPx) {
        const r = Number(brushSizeEl.value);
        const cx = hoverPx.x + 0.5;
        const cy = hoverPx.y + 0.5;
        strokeBrushRing(cx, cy, r, false);
        const core = r * (1 - currentSoftness());
        if (core > 1.5) strokeBrushRing(cx, cy, core, true);
        strokeBrushRing(cx + healAlign.ox, cy + healAlign.oy, r, true);
        strokeCrosshair(cx + healAlign.ox, cy + healAlign.oy);
      } else if (healSource) {
        strokeCrosshair(healSource.x + 0.5, healSource.y + 0.5);
        if (hoverPx) {
          const r = Number(brushSizeEl.value);
          strokeBrushRing(hoverPx.x + 0.5, hoverPx.y + 0.5, r, false);
        }
      }
    } else if (hoverPx) {
      if (sampling && image) {
        const H = image.pixels[hoverPx.y * image.width + hoverPx.x] / 10;
        const [r, g, b] = paletteRgbForHeight(H);
        const hex = rgbToHex(r, g, b);
        paintColorEl.value = hex;
        paintHeightVal.textContent = `height ${Math.round(H)}`;
        strokeCrosshair(hoverPx.x + 0.5, hoverPx.y + 0.5);
      } else {
        const r = Number(brushSizeEl.value);
        const cx = hoverPx.x + 0.5;
        const cy = hoverPx.y + 0.5;
        strokeBrushRing(cx, cy, r, false);
        const core = r * (1 - currentSoftness());
        if (core > 1.5) strokeBrushRing(cx, cy, core, true);
      }
    }
  }
}

async function onPng(file: File): Promise<void> {
  setStatus("Reading PNG…");
  downloadBtn.disabled = true;
  const buf = new Uint8Array(await file.arrayBuffer());
  const decoded = decodeGray16Png(buf);
  const nextTilesX = tilesFromPixels(decoded.width);
  const nextTilesY = tilesFromPixels(decoded.height);
  if (nextTilesX < 1 || nextTilesY < 1) {
    image = null;
    canvas.hidden = true;
    zoomBar.hidden = true;
    setToolsEnabled(false);
    throw new Error(
      `PNG must be (N×64+1) pixels on each side (65, 129, 257, 513, 1025, …). This file is ${decoded.width}×${decoded.height}.`,
    );
  }
  image = decoded;
  tilesX = nextTilesX;
  tilesY = nextTilesY;
  cities = buildBestCities(tilesX, tilesY);
  originalCities = cloneCities(cities);
  preview = buildPreview(image);
  undoPixels = null;
  undoPreview = null;
  strokeCities = null;
  healStroke = null;
  healSource = null;
  healAlign = null;
  undoStack = [];
  redoStack = [];
  if (!nameInput.value || nameInput.value === "New Region") {
    nameInput.value = file.name.replace(/\.png$/i, "") || "New Region";
  }
  draw();
  fitToView();
  downloadBtn.disabled = false;
  setToolsEnabled(true);
  syncToolButtons();
  setStatus(cityCountStatus());
  writeDraft();
}

fileInput.addEventListener("change", () => {
  const f = fileInput.files?.[0];
  if (f) onPng(f).catch((e) => setStatus(e instanceof Error ? e.message : String(e)));
}, { signal });

drop.addEventListener("dragover", (e) => {
  e.preventDefault();
  drop.classList.add("over");
}, { signal });
drop.addEventListener("dragleave", () => drop.classList.remove("over"), { signal });
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  const f = e.dataTransfer?.files[0];
  if (f) onPng(f).catch((err) => setStatus(err instanceof Error ? err.message : String(err)));
}, { signal });

canvas.addEventListener("click", (e) => {
  if (!image || isBrushMode() || editMode === "none" || spaceDown || zDown) return;
  const tile = tileFromEvent(e);
  if (!tile) return;
  if (editMode === "erase") {
    checkpoint();
    cities = eraseCityAt(cities, tile.tx, tile.ty);
  } else {
    const size = sizeForMode(editMode);
    if (!size) return;
    checkpoint();
    cities = placeCity(cities, tile.tx, tile.ty, size, tilesX, tilesY);
  }
  draw();
  setStatus(cityCountStatus());
  scheduleDraftSave();
}, { signal });

canvas.addEventListener("pointerdown", (e) => {
  if (!image) return;
  if (handleNavPointerDown(e)) return;
  if (!isBrushMode() || e.button !== 0) return;
  const pt = mapPixelFromEvent(e);
  if (!pt) return;
  e.preventDefault();
  if (editMode === "heal" && (e.altKey || altDown)) {
    healSource = pt;
    healAlign = null;
    healStroke = null;
    hoverPx = pt;
    syncToolButtons();
    draw();
    setStatus(`${cityCountStatus()} · Stamp source ${pt.x},${pt.y}`);
    return;
  }
  if (editMode === "draw" && (sampling || e.altKey)) {
    sampleAt(pt.x, pt.y);
    hoverPx = pt;
    draw();
    return;
  }
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    /* pointer already released */
  }
  painting = true;
  if (!beginStroke(pt.x, pt.y)) {
    painting = false;
    return;
  }
  applyDab(pt.x, pt.y, null);
  lastPaint = pt;
  hoverPx = pt;
  draw();
}, { signal });

canvas.addEventListener("pointermove", (e) => {
  if (!image || panning || spaceDown || zDown) return;
  if (isBrushMode()) {
    const pt = mapPixelFromEvent(e);
    hoverPx = pt;
    if (painting && pt) {
      applyDab(pt.x, pt.y, lastPaint);
      lastPaint = pt;
    }
    draw();
    return;
  }
  if (!sizeForMode(editMode)) {
    if (hover) {
      hover = null;
      draw();
    }
    return;
  }
  const tile = tileFromEvent(e);
  if (!tile) return;
  if (hover && hover.x === tile.tx && hover.y === tile.ty) return;
  hover = { x: tile.tx, y: tile.ty };
  draw();
}, { signal });

function endPaint(): void {
  if (!painting) return;
  painting = false;
  lastPaint = null;
  commitStrokeHistory();
  scheduleDraftSave();
}

function endPointer(): void {
  endPaint();
  endPan();
}

canvas.addEventListener("pointerup", endPointer, { signal });
canvas.addEventListener("pointercancel", endPointer, { signal });
window.addEventListener("pointerup", endPointer, { signal });
viewPane.addEventListener("pointerdown", (e) => {
  if (!image || e.target === canvas) return;
  handleNavPointerDown(e);
}, { signal });
viewPane.addEventListener("pointermove", (e) => {
  if (!panning) return;
  e.preventDefault();
  movePan(e);
}, { signal });
viewPane.addEventListener("pointerup", endPan, { signal });
viewPane.addEventListener("pointercancel", endPan, { signal });
viewPane.addEventListener("auxclick", (e) => {
  if (e.button === 1) e.preventDefault();
}, { signal });
viewPane.addEventListener("wheel", (e) => {
  if (!image || canvas.hidden) return;
  e.preventDefault();
  zoomBy(e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, e.clientX, e.clientY);
}, { passive: false, signal });
zoomInBtn.addEventListener("click", () => zoomBy(ZOOM_STEP), { signal });
zoomOutBtn.addEventListener("click", () => zoomBy(1 / ZOOM_STEP), { signal });
zoomFitBtn.addEventListener("click", () => fitToView(), { signal });
zoomVal.addEventListener("change", () => commitZoomInput(), { signal });
zoomVal.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    commitZoomInput();
    zoomVal.blur();
  } else if (e.key === "Escape") {
    zoomVal.value = formatZoomPercent(zoom);
    zoomVal.blur();
  }
}, { signal });
window.addEventListener("keydown", (e) => {
  if (isTextEntry(e.target)) return;
  const mapOn = Boolean(image && !canvas.hidden);
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.code === "KeyZ") {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
    return;
  }
  if (mod && e.code === "KeyY" && !e.shiftKey) {
    e.preventDefault();
    redo();
    return;
  }
  if (e.code === "Space") {
    if (!spaceDown) {
      spaceDown = true;
      syncNavCursor();
      if (mapOn) draw();
    }
    if (mapOn) e.preventDefault();
    return;
  }
  if (e.code === "KeyZ" && !e.ctrlKey && !e.metaKey) {
    if (!zDown) {
      zDown = true;
      altDown = e.altKey;
      syncNavCursor();
      if (mapOn) draw();
    }
    if (mapOn) e.preventDefault();
    return;
  }
  if (e.key === "Alt") {
    altDown = true;
    syncNavCursor();
    syncToolButtons();
    if (mapOn) draw();
    return;
  }
  if (!mapOn) return;
  if (e.key === "+" || e.key === "=") {
    e.preventDefault();
    zoomBy(ZOOM_STEP);
  } else if (e.key === "-" || e.key === "_") {
    e.preventDefault();
    zoomBy(1 / ZOOM_STEP);
  } else if (e.key === "0") {
    e.preventDefault();
    fitToView();
  }
}, { capture: true, signal });
window.addEventListener("keyup", (e) => {
  if (e.code === "Space") {
    spaceDown = false;
    syncNavCursor();
    draw();
    return;
  }
  if (e.code === "KeyZ") {
    zDown = false;
    syncNavCursor();
    draw();
    return;
  }
  if (e.key === "Alt") {
    altDown = false;
    syncNavCursor();
    syncToolButtons();
    draw();
  }
}, { capture: true, signal });
window.addEventListener("blur", () => {
  spaceDown = false;
  zDown = false;
  altDown = false;
  syncNavCursor();
  syncToolButtons();
}, { signal });

canvas.addEventListener("mouseleave", () => {
  if (!hover && !hoverPx) return;
  hover = null;
  hoverPx = null;
  if (sampling) syncColorUi(currentMapperHeight(), true);
  draw();
}, { signal });

downloadBtn.addEventListener("click", (e) => {
  e.preventDefault();
  if (!image || !templates || exportBusy) return;
  exportBusy = true;
  downloadBtn.disabled = true;
  writeDraft();
  setStatus("Preparing ZIP…");
  const pixels = new Uint16Array(image.pixels);
  const small = new Uint8Array(templates.small);
  const medium = new Uint8Array(templates.medium);
  const large = new Uint8Array(templates.large);
  const req: WorkerRequest = {
    pixels,
    width: image.width,
    height: image.height,
    tilesX,
    tilesY,
    cities,
    regionName: sanitizeName(nameInput.value),
    templates: { small, medium, large },
  };
  const worker = getExportWorker();
  const finish = (ok: boolean, message: string) => {
    exportBusy = false;
    downloadBtn.disabled = false;
    setStatus(message);
    if (!ok) {
      worker.terminate();
      exportWorker = null;
    }
  };
  worker.onmessage = (ev: MessageEvent) => {
    const msg = ev.data;
    if (msg.type === "progress") {
      setStatus(`${msg.message} (${msg.current}/${msg.total})`);
    } else if (msg.type === "done") {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(msg.blob);
      a.download = `${sanitizeName(nameInput.value)}.zip`;
      a.rel = "noopener";
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
      finish(true, "ZIP downloaded. Unzip into Documents/SimCity 4/Regions/");
    } else if (msg.type === "error") {
      finish(false, msg.message || "ZIP export failed");
    }
  };
  worker.onerror = (err) => {
    finish(false, err.message || "ZIP export failed");
  };
  try {
    worker.postMessage(req, [pixels.buffer, small.buffer, medium.buffer, large.buffer]);
  } catch (err) {
    finish(false, err instanceof Error ? err.message : String(err));
  }
}, { signal });

btnSmall.addEventListener("click", () => setEditMode("small"), { signal });
btnMedium.addEventListener("click", () => setEditMode("medium"), { signal });
btnBig.addEventListener("click", () => setEditMode("big"), { signal });
btnErase.addEventListener("click", () => setEditMode("erase"), { signal });
btnDraw.addEventListener("click", () => setEditMode("draw"), { signal });
btnStamp.addEventListener("click", () => setEditMode("heal"), { signal });
const stampTipWrap = btnStamp.closest(".has-tip");
if (stampTipWrap instanceof HTMLElement) {
  const stampTip = stampTipWrap.querySelector(".tip");
  const placeStampTip = (): void => {
    if (!(stampTip instanceof HTMLElement)) return;
    const r = stampTipWrap.getBoundingClientRect();
    const gap = 8;
    const width = Math.min(260, window.innerWidth - 24);
    stampTip.style.width = `${width}px`;
    stampTip.style.left = `${Math.max(8, r.left - gap - width)}px`;
    stampTip.style.right = "auto";
    stampTip.style.bottom = "auto";
    const h = stampTip.offsetHeight || 80;
    let top = r.top;
    if (top + h > window.innerHeight - 8) top = Math.max(8, window.innerHeight - 8 - h);
    stampTip.style.top = `${top}px`;
  };
  stampTipWrap.addEventListener("pointerenter", placeStampTip, { signal });
  stampTipWrap.addEventListener("pointerdown", () => stampTipWrap.classList.add("tip-off"), { signal });
  stampTipWrap.addEventListener("pointerleave", () => stampTipWrap.classList.remove("tip-off"), { signal });
}
btnRevert.addEventListener("click", () => {
  if (!image) return;
  checkpoint();
  cities = cloneCities(originalCities);
  editMode = "none";
  hover = null;
  syncToolButtons();
  draw();
  setStatus(`${cityCountStatus()} (reverted)`);
  scheduleDraftSave();
}, { signal });
helpBtn.addEventListener("click", () => {
  if (typeof helpDialog.showModal === "function") helpDialog.showModal();
}, { signal });
btnUndo.addEventListener("click", () => undo(), { signal });
btnRedo.addEventListener("click", () => redo(), { signal });
btnReset.addEventListener("click", () => {
  resetDialog.returnValue = "";
  if (typeof resetDialog.showModal === "function") resetDialog.showModal();
  else if (window.confirm("Clear the map, undo history, and the saved draft in this browser?")) {
    void resetAll();
  }
}, { signal });
resetDialog.addEventListener("close", () => {
  if (resetDialog.returnValue === "confirm") void resetAll();
}, { signal });
brushSizeEl.addEventListener("input", () => {
  brushSizeVal.textContent = brushSizeEl.value;
  if (isBrushMode()) draw();
}, { signal });
brushSoftEl.addEventListener("input", () => {
  brushSoftVal.textContent = brushSoftEl.value;
  if (isBrushMode()) draw();
}, { signal });
paintWater.addEventListener("change", () => {
  sampling = false;
  syncColorUi(currentMapperHeight(), true);
  syncToolButtons();
  if (editMode === "draw") draw();
}, { signal });
paintGreen.addEventListener("change", () => {
  sampling = false;
  syncColorUi(currentMapperHeight(), true);
  syncToolButtons();
  if (editMode === "draw") draw();
}, { signal });
paintCustom.addEventListener("change", () => {
  sampling = false;
  syncColorUi(customMapper, true);
  syncToolButtons();
  if (editMode === "draw") draw();
}, { signal });
paintColorEl.addEventListener("input", () => {
  const [r, g, b] = hexToRgb(paintColorEl.value);
  customMapper = heightForPaletteRgb(r, g, b);
  paintCustom.checked = true;
  sampling = false;
  syncColorUi(customMapper, false);
  syncToolButtons();
  if (editMode === "draw") draw();
}, { signal });
paintColorEl.addEventListener("change", () => {
  syncColorUi(customMapper, true);
  if (editMode === "draw") draw();
}, { signal });
paintSampleBtn.addEventListener("click", () => {
  sampling = !sampling;
  if (!sampling) syncColorUi(currentMapperHeight(), true);
  syncToolButtons();
  draw();
}, { signal });
overlayCbx.addEventListener("change", () => {
  overlayOn = overlayCbx.checked;
  draw();
  scheduleDraftSave();
}, { signal });
nameInput.addEventListener("change", () => scheduleDraftSave(), { signal });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") writeDraft();
}, { signal });
window.addEventListener("pagehide", () => writeDraft(), { signal });

async function resetAll(): Promise<void> {
  window.clearTimeout(draftTimer);
  draftEpoch += 1;
  image = null;
  tilesX = 0;
  tilesY = 0;
  cities = [];
  originalCities = [];
  preview = null;
  editMode = "none";
  overlayOn = true;
  overlayCbx.checked = true;
  hover = null;
  hoverPx = null;
  painting = false;
  sampling = false;
  lastPaint = null;
  undoPixels = null;
  undoPreview = null;
  strokeCities = null;
  healStroke = null;
  healSource = null;
  healAlign = null;
  undoStack = [];
  redoStack = [];
  zoom = 1;
  panX = 0;
  panY = 0;
  nameInput.value = "New Region";
  fileInput.value = "";
  canvas.hidden = true;
  canvas.width = 0;
  canvas.height = 0;
  canvas.style.transform = "";
  canvas.style.width = "";
  canvas.style.height = "";
  downloadBtn.disabled = true;
  setToolsEnabled(false);
  syncToolButtons();
  syncHistoryButtons();
  setStatus("Ready. Drop a 16-bit grayscale PNG.");
  try {
    await clearDraft();
  } catch {
    setStatus("Map cleared, but the saved draft could not be removed.");
    return;
  }
  setStatus("Reset. Draft cleared. Drop a 16-bit grayscale PNG.");
}

function showRestoredMap(): void {
  if (!image) return;
  preview = buildPreview(image);
  setToolsEnabled(true);
  syncToolButtons();
  brushSizeVal.textContent = brushSizeEl.value;
  brushSoftVal.textContent = brushSoftEl.value;
  syncColorUi(currentMapperHeight(), true);
  draw();
  if (restored && typeof restored.panX === "number" && restored.zoom) {
    zoom = clampZoom(restored.zoom);
    panX = restored.panX;
    panY = restored.panY ?? 0;
    applyCanvasCssSize();
  } else {
    fitToView();
  }
  downloadBtn.disabled = !templates;
  setStatus(restored?.status || cityCountStatus());
}

function applyDraft(draft: Awaited<ReturnType<typeof loadDraft>>): boolean {
  if (!draft || draft.width < 2 || draft.height < 2) return false;
  if (draft.pixels.byteLength !== draft.width * draft.height * 2) return false;
  image = {
    width: draft.width,
    height: draft.height,
    pixels: new Uint16Array(draft.pixels.slice(0)),
  };
  tilesX = draft.tilesX;
  tilesY = draft.tilesY;
  cities = draft.cities ?? [];
  originalCities = draft.originalCities?.length ? draft.originalCities : cloneCities(cities);
  if (draft.regionName) nameInput.value = draft.regionName;
  overlayOn = draft.overlay !== false;
  overlayCbx.checked = overlayOn;
  return true;
}

async function boot(): Promise<void> {
  try {
    getExportWorker();
  } catch {
    /* worker will be created on first download */
  }
  if (!image) {
    try {
      const draft = await loadDraft();
      if (applyDraft(draft)) {
        showRestoredMap();
        setStatus(`${cityCountStatus()} · restored unsaved map`);
        return;
      }
    } catch {
      /* start empty */
    }
  }
  if (image) showRestoredMap();
  else {
    setToolsEnabled(false);
    setStatus("Ready. Drop a 16-bit grayscale PNG.");
  }
}

if (templates) {
  void boot();
} else {
  loadTemplates()
    .then((t) => {
      templates = t;
      return boot();
    })
    .catch((e) => setStatus(e instanceof Error ? e.message : String(e)));
}

syncColorUi(currentMapperHeight(), true);
