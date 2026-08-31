/** PNG load, draft save, reset, and ZIP export. */
import { buildBestCities, cloneCities, decodeGray16Png, tilesFromPixels, type WorkerRequest } from "../lib/sc4mapper";
import ExportWorker from "../lib/sc4mapper/export.worker.ts?worker";
import { clearDraft, loadDraft, saveDraft, type MapDraft } from "./draft";
import type { Dom } from "./dom";
import type { AppState, HotState } from "./state";
import { buildPreview, cityCountStatus, sanitizeName } from "./state";
import type { History } from "./history";
import type { Nav } from "./nav";
import type { View } from "./view";
import type { Tools } from "../tools/map-tools";

export function createSession(
  s: AppState,
  dom: Dom,
  history: History,
  nav: Nav,
  view: View,
  tools: Tools,
  hooks: { setStatus: (msg: string) => void },
) {
  let exportWorker: Worker | null = null;

  function getExportWorker(): Worker {
    if (exportWorker) return exportWorker;
    exportWorker = new ExportWorker();
    return exportWorker;
  }

  function pixelsCopy(): ArrayBuffer {
    if (!s.image) return new ArrayBuffer(0);
    const copy = new Uint16Array(s.image.pixels.length);
    copy.set(s.image.pixels);
    return copy.buffer;
  }

  function writeDraft(): void {
    if (!s.image) return;
    const epoch = s.draftEpoch;
    void saveDraft({
      pixels: pixelsCopy(),
      width: s.image.width,
      height: s.image.height,
      tilesX: s.tilesX,
      tilesY: s.tilesY,
      cities: s.cities,
      originalCities: s.originalCities,
      regionName: dom.nameInput.value,
      overlay: s.overlayOn,
    }).then(() => {
      if (epoch !== s.draftEpoch) return clearDraft();
    }).catch(() => {
      /* keep editing if storage is unavailable */
    });
  }

  function scheduleDraftSave(): void {
    if (!s.image) return;
    window.clearTimeout(s.draftTimer);
    s.draftTimer = window.setTimeout(writeDraft, 400);
  }

  async function onPng(file: File): Promise<void> {
    hooks.setStatus("Reading PNG…");
    dom.downloadBtn.disabled = true;
    const buf = new Uint8Array(await file.arrayBuffer());
    const decoded = decodeGray16Png(buf);
    const nextTilesX = tilesFromPixels(decoded.width);
    const nextTilesY = tilesFromPixels(decoded.height);
    if (nextTilesX < 1 || nextTilesY < 1) {
      s.image = null;
      dom.canvas.hidden = true;
      dom.zoomBar.hidden = true;
      tools.setEnabled(false);
      throw new Error(
        `PNG must be (N×64+1) pixels on each side (65, 129, 257, 513, 1025, …). This file is ${decoded.width}×${decoded.height}.`,
      );
    }
    s.image = decoded;
    s.tilesX = nextTilesX;
    s.tilesY = nextTilesY;
    s.cities = buildBestCities(s.tilesX, s.tilesY);
    s.originalCities = cloneCities(s.cities);
    s.preview = buildPreview(s.image);
    s.stampStroke = null;
    s.stampSource = null;
    s.stampAlign = null;
    history.clear();
    if (!dom.nameInput.value || dom.nameInput.value === "New Region") {
      dom.nameInput.value = file.name.replace(/\.png$/i, "") || "New Region";
    }
    view.draw();
    nav.fitToView();
    dom.downloadBtn.disabled = false;
    tools.setEnabled(true);
    tools.syncButtons();
    hooks.setStatus(cityCountStatus(s));
    writeDraft();
  }

  async function resetAll(): Promise<void> {
    window.clearTimeout(s.draftTimer);
    s.draftEpoch += 1;
    const templates = s.templates;
    s.image = null;
    s.tilesX = 0;
    s.tilesY = 0;
    s.cities = [];
    s.originalCities = [];
    s.preview = null;
    s.editMode = "none";
    s.overlayOn = true;
    dom.overlayCbx.checked = true;
    s.hover = null;
    s.hoverPx = null;
    s.painting = false;
    s.sampling = false;
    s.lastPaint = null;
    s.stampStroke = null;
    s.stampSource = null;
    s.stampAlign = null;
    history.clear();
    s.zoom = 1;
    s.panX = 0;
    s.panY = 0;
    s.templates = templates;
    dom.nameInput.value = "New Region";
    dom.fileInput.value = "";
    dom.canvas.hidden = true;
    dom.canvas.width = 0;
    dom.canvas.height = 0;
    dom.canvas.style.transform = "";
    dom.canvas.style.width = "";
    dom.canvas.style.height = "";
    dom.downloadBtn.disabled = true;
    tools.setEnabled(false);
    tools.syncButtons();
    history.syncButtons();
    hooks.setStatus("Ready. Drop a 16-bit grayscale PNG.");
    try {
      await clearDraft();
    } catch {
      hooks.setStatus("Map cleared, but the saved draft could not be removed.");
      return;
    }
    hooks.setStatus("Reset. Draft cleared. Drop a 16-bit grayscale PNG.");
  }

  function applyDraft(draft: MapDraft | null): boolean {
    if (!draft || draft.width < 2 || draft.height < 2) return false;
    if (draft.pixels.byteLength !== draft.width * draft.height * 2) return false;
    s.image = {
      width: draft.width,
      height: draft.height,
      pixels: new Uint16Array(draft.pixels.slice(0)),
    };
    s.tilesX = draft.tilesX;
    s.tilesY = draft.tilesY;
    s.cities = draft.cities ?? [];
    s.originalCities = draft.originalCities?.length ? draft.originalCities : cloneCities(s.cities);
    if (draft.regionName) dom.nameInput.value = draft.regionName;
    s.overlayOn = draft.overlay !== false;
    dom.overlayCbx.checked = s.overlayOn;
    return true;
  }

  function showRestoredMap(restored?: HotState): void {
    if (!s.image) return;
    s.preview = buildPreview(s.image);
    tools.setEnabled(true);
    tools.syncButtons();
    dom.brushSizeVal.textContent = dom.brushSizeEl.value;
    dom.brushSoftVal.textContent = dom.brushSoftEl.value;
    tools.syncColorUi(tools.currentMapperHeight(), true);
    view.draw();
    if (restored && typeof restored.panX === "number" && restored.zoom) {
      nav.restoreView(restored.zoom, restored.panX, restored.panY ?? 0);
    } else {
      nav.fitToView();
    }
    dom.downloadBtn.disabled = !s.templates;
    hooks.setStatus(restored?.status || cityCountStatus(s));
  }

  async function boot(restored?: HotState): Promise<void> {
    try {
      getExportWorker();
    } catch {
      /* worker will be created on first download */
    }
    if (!s.image) {
      try {
        const draft = await loadDraft();
        if (applyDraft(draft)) {
          showRestoredMap();
          hooks.setStatus(`${cityCountStatus(s)} · restored unsaved map`);
          return;
        }
      } catch {
        /* start empty */
      }
    }
    if (s.image) showRestoredMap(restored);
    else {
      tools.setEnabled(false);
      hooks.setStatus("Ready. Drop a 16-bit grayscale PNG.");
    }
  }

  function downloadZip(): void {
    if (!s.image || !s.templates || s.exportBusy) return;
    s.exportBusy = true;
    dom.downloadBtn.disabled = true;
    writeDraft();
    hooks.setStatus("Preparing ZIP…");
    const pixels = new Uint16Array(s.image.pixels);
    const small = new Uint8Array(s.templates.small);
    const medium = new Uint8Array(s.templates.medium);
    const large = new Uint8Array(s.templates.large);
    const req: WorkerRequest = {
      pixels,
      width: s.image.width,
      height: s.image.height,
      tilesX: s.tilesX,
      tilesY: s.tilesY,
      cities: s.cities,
      regionName: sanitizeName(dom.nameInput.value),
      templates: { small, medium, large },
    };
    const worker = getExportWorker();
    const finish = (ok: boolean, message: string) => {
      s.exportBusy = false;
      dom.downloadBtn.disabled = false;
      hooks.setStatus(message);
      if (!ok) {
        worker.terminate();
        exportWorker = null;
      }
    };
    worker.onmessage = (ev: MessageEvent) => {
      const msg = ev.data;
      if (msg.type === "progress") {
        hooks.setStatus(`${msg.message} (${msg.current}/${msg.total})`);
      } else if (msg.type === "done") {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(msg.blob);
        a.download = `${sanitizeName(dom.nameInput.value)}.zip`;
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
  }

  return { writeDraft, scheduleDraftSave, onPng, resetAll, boot, downloadZip };
}

export type Session = ReturnType<typeof createSession>;
