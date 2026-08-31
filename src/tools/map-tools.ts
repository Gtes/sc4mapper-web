/** City place/erase, Draw, and Stamp. Add new map tools here. */
import { cloneCities, eraseCityAt, placeCity, heightForPaletteRgb, hexToRgb, paletteRgbForHeight, rgbToHex } from "../lib/sc4mapper";
import {
  PAINT_GREEN,
  PAINT_WATER,
  beginHealStroke,
  healDab,
  healLine,
  paintDab,
  paintLine,
  paintTargetPng,
  type PaintPreset,
} from "./paint";
import type { Dom } from "../app/dom";
import type { AppState, EditMode } from "../app/state";
import { cityCountStatus, isBrushMode, mapPixelFromEvent, sizeForMode, tileFromEvent } from "../app/state";
import type { History } from "../app/history";
import type { View } from "../app/view";

const HINTS: Record<EditMode, (s: AppState) => string> = {
  none: () => "Select a tool, then click the map. Space-drag pans · Z-click zooms in · Alt+Z-click zooms out.",
  small: () => "Click to place a small (1×1) city. Overlapping tiles are replaced.",
  medium: () => "Click to place a medium (2×2) city.",
  big: () => "Click to place a big (4×4) city.",
  erase: () => "Click a city to remove it from the config.",
  draw: (s) => s.sampling
    ? "Click the map to sample a nearby color, then adjust the picker."
    : "Drag to paint. Space-drag pans · Z-click zooms in · Alt+Z-click zooms out.",
  stamp: (s) => s.stampSource
    ? "Drag to clone the Alt-picked terrain (height + grain). Alt-click to pick a new source."
    : "Alt-click green (or any terrain) to set source, then drag to stamp it.",
};

export function createTools(s: AppState, dom: Dom, history: History, view: View, hooks: {
  setStatus: (msg: string) => void;
  scheduleDraftSave: () => void;
}) {
  function currentPreset(): PaintPreset {
    if (dom.paintCustom.checked) return "custom";
    if (dom.paintGreen.checked) return "green";
    return "water";
  }

  function currentMapperHeight(): number {
    const p = currentPreset();
    if (p === "water") return PAINT_WATER;
    if (p === "green") return PAINT_GREEN;
    return s.customMapper;
  }

  function syncColorUi(mapper: number, snapPicker: boolean): void {
    dom.paintHeightVal.textContent = `height ${Math.round(mapper)}`;
    if (!snapPicker) return;
    const [r, g, b] = paletteRgbForHeight(mapper);
    dom.paintColorEl.value = rgbToHex(r, g, b);
  }

  function syncButtons(): void {
    const mode = s.editMode;
    dom.btnSmall.classList.toggle("active", mode === "small");
    dom.btnMedium.classList.toggle("active", mode === "medium");
    dom.btnBig.classList.toggle("active", mode === "big");
    dom.btnErase.classList.toggle("active", mode === "erase");
    dom.btnDraw.classList.toggle("active", mode === "draw");
    dom.btnStamp.classList.toggle("active", mode === "stamp");
    dom.drawOpts.hidden = !isBrushMode(mode);
    dom.paintColorOpts.hidden = mode !== "draw";
    dom.brushOptsLabel.textContent = mode === "stamp" ? "Stamp" : "Paint";
    dom.canvas.classList.toggle("drawing", isBrushMode(mode));
    dom.hintEl.textContent = HINTS[mode](s);
    dom.paintSampleBtn.classList.toggle("active", s.sampling);
    dom.canvas.classList.toggle("sampling", s.sampling);
    dom.canvas.classList.toggle("heal-pick", mode === "stamp" && s.altDown);
  }

  function setEnabled(on: boolean): void {
    for (const b of [...dom.modeButtons, dom.btnRevert]) b.disabled = !on;
    history.syncButtons();
    dom.brushSizeEl.disabled = !on;
    dom.brushSoftEl.disabled = !on;
    dom.paintWater.disabled = !on;
    dom.paintGreen.disabled = !on;
    dom.paintCustom.disabled = !on;
    dom.paintColorEl.disabled = !on;
    dom.paintSampleBtn.disabled = !on;
    dom.zoomInBtn.disabled = !on;
    dom.zoomOutBtn.disabled = !on;
    dom.zoomFitBtn.disabled = !on;
    dom.zoomVal.disabled = !on;
    dom.zoomBar.hidden = !on;
  }

  function setEditMode(mode: EditMode): void {
    s.editMode = s.editMode === mode ? "none" : mode;
    s.hover = null;
    s.hoverPx = null;
    s.painting = false;
    s.sampling = false;
    s.lastPaint = null;
    syncButtons();
    view.draw();
  }

  function setCustomFromMapper(mapper: number): void {
    s.customMapper = Math.max(0, Math.min(6000, mapper));
    dom.paintCustom.checked = true;
    s.sampling = false;
    syncColorUi(s.customMapper, true);
    syncButtons();
  }

  function sampleAt(x: number, y: number): void {
    if (!s.image) return;
    setCustomFromMapper(s.image.pixels[y * s.image.width + x] / 10);
    hooks.setStatus(`${cityCountStatus(s)} · sampled height ${Math.round(s.customMapper)}`);
  }

  function beginStroke(hx: number, hy: number): boolean {
    if (!s.image || !s.preview) return false;
    if (s.editMode === "stamp") {
      if (!s.stampSource) {
        hooks.setStatus("Alt-click the map to set a Stamp source");
        return false;
      }
      if (!s.stampAlign) {
        s.stampAlign = { ox: s.stampSource.x - hx, oy: s.stampSource.y - hy };
      }
    }
    s.undoPixels = Uint16Array.from(s.image.pixels);
    s.undoPreview = new ImageData(new Uint8ClampedArray(s.preview.data), s.preview.width, s.preview.height);
    s.strokeCities = cloneCities(s.cities);
    history.syncButtons();
    s.stampStroke = null;
    if (s.editMode === "stamp" && s.stampAlign) {
      s.stampStroke = beginHealStroke(s.undoPixels, s.image.width, s.image.height, s.stampAlign.ox, s.stampAlign.oy);
    }
    return true;
  }

  function applyDab(x: number, y: number, from: { x: number; y: number } | null): void {
    if (!s.image || !s.preview) return;
    const radius = Number(dom.brushSizeEl.value);
    const softness = view.softness();
    if (s.editMode === "stamp") {
      if (!s.undoPixels || !s.stampStroke) return;
      if (from) {
        healLine(
          s.image.pixels, s.preview, s.image.width, s.image.height,
          from.x, from.y, x, y, radius, softness, s.undoPixels, s.stampStroke,
        );
      } else {
        healDab(
          s.image.pixels, s.preview, s.image.width, s.image.height,
          x, y, radius, softness, s.undoPixels, s.stampStroke,
        );
      }
      return;
    }
    const target = paintTargetPng(currentPreset(), s.customMapper);
    if (from) {
      paintLine(
        s.image.pixels, s.preview, s.image.width, s.image.height,
        from.x, from.y, x, y, radius, target, softness, s.undoPixels,
      );
    } else {
      paintDab(
        s.image.pixels, s.preview, s.image.width, s.image.height,
        x, y, radius, target, softness, s.undoPixels,
      );
    }
  }

  function onCityClick(e: MouseEvent): void {
    if (!s.image || isBrushMode(s.editMode) || s.editMode === "none" || s.spaceDown || s.zDown) return;
    const tile = tileFromEvent(s, dom.canvas, e);
    if (!tile) return;
    if (s.editMode === "erase") {
      history.checkpoint();
      s.cities = eraseCityAt(s.cities, tile.tx, tile.ty);
    } else {
      const size = sizeForMode(s.editMode);
      if (!size) return;
      history.checkpoint();
      s.cities = placeCity(s.cities, tile.tx, tile.ty, size, s.tilesX, s.tilesY);
    }
    view.draw();
    hooks.setStatus(cityCountStatus(s));
    hooks.scheduleDraftSave();
  }

  function onBrushDown(e: PointerEvent): boolean {
    if (!isBrushMode(s.editMode) || e.button !== 0) return false;
    const pt = mapPixelFromEvent(s, dom.canvas, e);
    if (!pt) return false;
    e.preventDefault();
    if (s.editMode === "stamp" && (e.altKey || s.altDown)) {
      s.stampSource = pt;
      s.stampAlign = null;
      s.stampStroke = null;
      s.hoverPx = pt;
      syncButtons();
      view.draw();
      hooks.setStatus(`${cityCountStatus(s)} · Stamp source ${pt.x},${pt.y}`);
      return true;
    }
    if (s.editMode === "draw" && (s.sampling || e.altKey)) {
      sampleAt(pt.x, pt.y);
      s.hoverPx = pt;
      view.draw();
      return true;
    }
    try {
      dom.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
    s.painting = true;
    if (!beginStroke(pt.x, pt.y)) {
      s.painting = false;
      return true;
    }
    applyDab(pt.x, pt.y, null);
    s.lastPaint = pt;
    s.hoverPx = pt;
    view.draw();
    return true;
  }

  function onBrushMove(e: PointerEvent): boolean {
    if (!isBrushMode(s.editMode)) return false;
    const pt = mapPixelFromEvent(s, dom.canvas, e);
    s.hoverPx = pt;
    if (s.painting && pt) {
      applyDab(pt.x, pt.y, s.lastPaint);
      s.lastPaint = pt;
    }
    view.draw();
    return true;
  }

  function onCityHover(e: PointerEvent): void {
    if (!sizeForMode(s.editMode)) {
      if (s.hover) {
        s.hover = null;
        view.draw();
      }
      return;
    }
    const tile = tileFromEvent(s, dom.canvas, e);
    if (!tile) return;
    if (s.hover && s.hover.x === tile.tx && s.hover.y === tile.ty) return;
    s.hover = { x: tile.tx, y: tile.ty };
    view.draw();
  }

  function pickCustomFromColor(): void {
    const [r, g, b] = hexToRgb(dom.paintColorEl.value);
    s.customMapper = heightForPaletteRgb(r, g, b);
    dom.paintCustom.checked = true;
    s.sampling = false;
    syncColorUi(s.customMapper, false);
    syncButtons();
    if (s.editMode === "draw") view.draw();
  }

  return {
    currentMapperHeight,
    syncColorUi,
    syncButtons,
    setEnabled,
    setEditMode,
    onCityClick,
    onBrushDown,
    onBrushMove,
    onCityHover,
    pickCustomFromColor,
  };
}

export type Tools = ReturnType<typeof createTools>;
