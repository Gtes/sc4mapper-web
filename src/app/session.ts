/** PNG / SC4M load, draft save, reset, ZIP and SC4M export. */
import { buildBestCities, cloneCities, decodeGray16Png, decodeSc4m, encodeSc4m, tilesFromPixels, type City, type WorkerRequest } from "../lib/sc4mapper";
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

  function syncExportButtons(): void {
    const ready = Boolean(s.image) && !s.exportBusy;
    dom.downloadBtn.disabled = !ready || !s.templates;
    dom.downloadSc4mBtn.disabled = !ready;
  }

  function triggerDownload(blob: Blob, filename: string): void {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.rel = "noopener";
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  }

  function looksLikeSc4m(name: string, buf: Uint8Array): boolean {
    if (/\.sc4m$/i.test(name)) return true;
    if (/\.png$/i.test(name) || (buf[0] === 0x89 && buf[1] === 0x50)) return false;
    return buf[0] === 0x78;
  }

  function applyLoadedMap(
    pixels: Uint16Array,
    width: number,
    height: number,
    tilesX: number,
    tilesY: number,
    cities: City[],
    fileName: string,
    nameExt: RegExp,
  ): void {
    s.image = { width, height, pixels };
    s.tilesX = tilesX;
    s.tilesY = tilesY;
    s.cities = cities;
    s.originalCities = cloneCities(cities);
    s.preview = buildPreview(s.image);
    s.stampStroke = null;
    s.stampSource = null;
    s.stampAlign = null;
    history.clear();
    if (!dom.nameInput.value || dom.nameInput.value === "New Region") {
      dom.nameInput.value = fileName.replace(nameExt, "") || "New Region";
    }
    view.draw();
    nav.fitToView();
    syncExportButtons();
    tools.setEnabled(true);
    tools.syncButtons();
    hooks.setStatus(cityCountStatus(s));
    writeDraft();
  }

  async function onFile(file: File): Promise<void> {
    const buf = new Uint8Array(await file.arrayBuffer());
    const sc4m = looksLikeSc4m(file.name, buf);
    hooks.setStatus(sc4m ? "Reading SC4M…" : "Reading PNG…");
    try {
      if (sc4m) {
        const decoded = decodeSc4m(buf);
        applyLoadedMap(
          decoded.pixels,
          decoded.width,
          decoded.height,
          decoded.tilesX,
          decoded.tilesY,
          decoded.cities,
          file.name,
          /\.sc4m$/i,
        );
        return;
      }
      const decoded = decodeGray16Png(buf);
      const nextTilesX = tilesFromPixels(decoded.width);
      const nextTilesY = tilesFromPixels(decoded.height);
      if (nextTilesX < 1 || nextTilesY < 1) {
        throw new Error(
          `PNG must be (N×64+1) pixels on each side (65, 129, 257, 513, 1025, …). This file is ${decoded.width}×${decoded.height}.`,
        );
      }
      applyLoadedMap(
        decoded.pixels,
        decoded.width,
        decoded.height,
        nextTilesX,
        nextTilesY,
        buildBestCities(nextTilesX, nextTilesY),
        file.name,
        /\.png$/i,
      );
    } catch (err) {
      syncExportButtons();
      throw err;
    }
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
    syncExportButtons();
    tools.setEnabled(false);
    tools.syncButtons();
    history.syncButtons();
    hooks.setStatus("Ready. Drop a 16-bit grayscale PNG or an SC4M file.");
    try {
      await clearDraft();
    } catch {
      hooks.setStatus("Map cleared, but the saved draft could not be removed.");
      return;
    }
    hooks.setStatus("Reset. Draft cleared. Drop a 16-bit grayscale PNG or an SC4M file.");
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
    syncExportButtons();
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
      hooks.setStatus("Ready. Drop a 16-bit grayscale PNG or an SC4M file.");
    }
  }

  function downloadZip(): void {
    if (!s.image || !s.templates || s.exportBusy) return;
    s.exportBusy = true;
    syncExportButtons();
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
      syncExportButtons();
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
        triggerDownload(msg.blob, `${sanitizeName(dom.nameInput.value)}.zip`);
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

  function downloadSc4m(): void {
    if (!s.image || s.exportBusy) return;
    s.exportBusy = true;
    syncExportButtons();
    writeDraft();
    hooks.setStatus("Encoding SC4M…");
    try {
      const bytes = encodeSc4m(
        s.image.pixels,
        s.image.width,
        s.image.height,
        s.tilesX,
        s.tilesY,
        s.cities,
      );
      const packed = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(packed).set(bytes);
      triggerDownload(
        new Blob([packed], { type: "application/octet-stream" }),
        `${sanitizeName(dom.nameInput.value)}.sc4m`,
      );
      hooks.setStatus("SC4M downloaded. Share this file; use Download ZIP to play in SimCity 4.");
    } catch (err) {
      hooks.setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      s.exportBusy = false;
      syncExportButtons();
    }
  }

  return { writeDraft, scheduleDraftSave, onFile, onPng: onFile, resetAll, boot, downloadZip, downloadSc4m };
}

export type Session = ReturnType<typeof createSession>;
