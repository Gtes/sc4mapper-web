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
import { WATER_LEVEL, onePassColors } from "./terrain";
import "./style.css";
import type { Templates, WorkerRequest } from "./export";

const drop = document.getElementById("drop") as HTMLLabelElement;
const fileInput = document.getElementById("file") as HTMLInputElement;
const nameInput = document.getElementById("name") as HTMLInputElement;
const downloadBtn = document.getElementById("download") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLParagraphElement;
const canvas = document.getElementById("view") as HTMLCanvasElement;
const hintEl = document.getElementById("hint") as HTMLParagraphElement;
const overlayCbx = document.getElementById("overlay") as HTMLInputElement;
const btnSmall = document.getElementById("tool-small") as HTMLButtonElement;
const btnMedium = document.getElementById("tool-medium") as HTMLButtonElement;
const btnBig = document.getElementById("tool-big") as HTMLButtonElement;
const btnErase = document.getElementById("tool-erase") as HTMLButtonElement;
const btnRevert = document.getElementById("tool-revert") as HTMLButtonElement;
const modeButtons = [btnSmall, btnMedium, btnBig, btnErase];
const ctx = canvas.getContext("2d")!;
const ac = new AbortController();
const { signal } = ac;

type EditMode = "none" | "small" | "medium" | "big" | "erase";

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
    } satisfies HotState;
  });
}

function setStatus(msg: string): void {
  statusEl.textContent = msg;
}

function setToolsEnabled(on: boolean): void {
  for (const b of [...modeButtons, btnRevert]) b.disabled = !on;
}

function sizeForMode(mode: EditMode): CitySize | null {
  if (mode === "small") return 1;
  if (mode === "medium") return 2;
  if (mode === "big") return 4;
  return null;
}

function syncToolButtons(): void {
  btnSmall.classList.toggle("active", editMode === "small");
  btnMedium.classList.toggle("active", editMode === "medium");
  btnBig.classList.toggle("active", editMode === "big");
  btnErase.classList.toggle("active", editMode === "erase");
  const hints: Record<EditMode, string> = {
    none: "Select a tool, then click the map. Overlay shows city borders.",
    small: "Click to place a small (1×1) city. Overlapping tiles are replaced.",
    medium: "Click to place a medium (2×2) city.",
    big: "Click to place a big (4×4) city.",
    erase: "Click a city to remove it from the config.",
  };
  hintEl.textContent = hints[editMode];
}

function setEditMode(mode: EditMode): void {
  editMode = editMode === mode ? "none" : mode;
  hover = null;
  syncToolButtons();
  draw();
}

function tileFromEvent(e: MouseEvent): { tx: number; ty: number } | null {
  if (!image) return null;
  const rect = canvas.getBoundingClientRect();
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
  if (!nameInput.value || nameInput.value === "New Region") {
    nameInput.value = file.name.replace(/\.png$/i, "") || "New Region";
  }
  draw();
  downloadBtn.disabled = false;
  setToolsEnabled(true);
  syncToolButtons();
  setStatus(cityCountStatus());
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
  if (!image) return;
  const tile = tileFromEvent(e);
  if (!tile) return;
  if (editMode === "erase") {
    cities = eraseCityAt(cities, tile.tx, tile.ty);
  } else {
    const size = sizeForMode(editMode);
    if (!size) return;
    cities = placeCity(cities, tile.tx, tile.ty, size, tilesX, tilesY);
  }
  draw();
  setStatus(cityCountStatus());
}, { signal });

canvas.addEventListener("mousemove", (e) => {
  if (!image || !sizeForMode(editMode)) {
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

canvas.addEventListener("mouseleave", () => {
  if (!hover) return;
  hover = null;
  draw();
}, { signal });

downloadBtn.addEventListener("click", () => {
  if (!image || !templates) return;
  downloadBtn.disabled = true;
  const worker = new Worker(new URL("./export.worker.ts", import.meta.url), { type: "module" });
  const req: WorkerRequest = {
    pixels: image.pixels,
    width: image.width,
    height: image.height,
    tilesX,
    tilesY,
    cities,
    regionName: sanitizeName(nameInput.value),
    templates,
  };
  worker.onmessage = (ev: MessageEvent) => {
    const msg = ev.data;
    if (msg.type === "progress") {
      setStatus(`${msg.message} (${msg.current}/${msg.total})`);
    } else if (msg.type === "done") {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(msg.blob);
      a.download = `${sanitizeName(nameInput.value)}.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
      setStatus("ZIP downloaded. Unzip into Documents/SimCity 4/Regions/");
      downloadBtn.disabled = false;
      worker.terminate();
    } else if (msg.type === "error") {
      setStatus(msg.message);
      downloadBtn.disabled = false;
      worker.terminate();
    }
  };
  worker.onerror = (e) => {
    setStatus(e.message || "worker error");
    downloadBtn.disabled = false;
    worker.terminate();
  };
  worker.postMessage(req);
}, { signal });

btnSmall.addEventListener("click", () => setEditMode("small"), { signal });
btnMedium.addEventListener("click", () => setEditMode("medium"), { signal });
btnBig.addEventListener("click", () => setEditMode("big"), { signal });
btnErase.addEventListener("click", () => setEditMode("erase"), { signal });
btnRevert.addEventListener("click", () => {
  if (!image) return;
  cities = cloneCities(originalCities);
  editMode = "none";
  hover = null;
  syncToolButtons();
  draw();
  setStatus(`${cityCountStatus()} (reverted)`);
}, { signal });
overlayCbx.addEventListener("change", () => {
  overlayOn = overlayCbx.checked;
  draw();
}, { signal });

function showRestoredMap(): void {
  if (!image) return;
  preview = buildPreview(image);
  setToolsEnabled(true);
  syncToolButtons();
  draw();
  downloadBtn.disabled = !templates;
  setStatus(restored?.status || cityCountStatus());
}

if (templates) {
  showRestoredMap();
  if (!image) {
    setToolsEnabled(false);
    setStatus("Ready. Drop a 16-bit grayscale PNG.");
  }
} else {
  loadTemplates()
    .then((t) => {
      templates = t;
      if (image) showRestoredMap();
      else {
        setToolsEnabled(false);
        setStatus("Ready. Drop a 16-bit grayscale PNG.");
      }
    })
    .catch((e) => setStatus(e instanceof Error ? e.message : String(e)));
}
