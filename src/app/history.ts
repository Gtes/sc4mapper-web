/** Undo / redo for terrain + city config. */
import { cloneCities, type City } from "../lib/sc4mapper";
import type { Dom } from "./dom";
import type { AppState } from "./state";
import { cityCountStatus } from "./state";

export type HistoryEntry = {
  pixels: Uint16Array;
  preview: ImageData;
  cities: City[];
};

const HISTORY_MAX = 40;

export function createHistory(s: AppState, dom: Dom, hooks: {
  draw: () => void;
  setStatus: (msg: string) => void;
  scheduleDraftSave: () => void;
}) {
  let undoStack: HistoryEntry[] = [];
  let redoStack: HistoryEntry[] = [];

  function syncButtons(): void {
    const on = Boolean(s.image);
    dom.btnUndo.disabled = !on || (undoStack.length === 0 && !(s.painting && s.undoPixels));
    dom.btnRedo.disabled = !on || redoStack.length === 0;
  }

  function snapshot(): HistoryEntry | null {
    if (!s.image || !s.preview) return null;
    return {
      pixels: Uint16Array.from(s.image.pixels),
      preview: new ImageData(new Uint8ClampedArray(s.preview.data), s.preview.width, s.preview.height),
      cities: cloneCities(s.cities),
    };
  }

  function restore(entry: HistoryEntry): void {
    if (!s.image || !s.preview) return;
    s.image.pixels.set(entry.pixels);
    s.preview.data.set(entry.preview.data);
    s.cities = cloneCities(entry.cities);
    s.stampStroke = null;
    hooks.draw();
    syncButtons();
    hooks.scheduleDraftSave();
  }

  function checkpoint(): void {
    const snap = snapshot();
    if (!snap) return;
    undoStack.push(snap);
    if (undoStack.length > HISTORY_MAX) undoStack.shift();
    redoStack = [];
    syncButtons();
  }

  function commitStroke(): void {
    if (!s.undoPixels || !s.undoPreview || !s.strokeCities) return;
    undoStack.push({
      pixels: s.undoPixels,
      preview: s.undoPreview,
      cities: s.strokeCities,
    });
    if (undoStack.length > HISTORY_MAX) undoStack.shift();
    redoStack = [];
    s.undoPixels = null;
    s.undoPreview = null;
    s.strokeCities = null;
    syncButtons();
  }

  function undo(): void {
    if (!s.image || !s.preview) return;
    if (s.painting && s.undoPixels && s.undoPreview) {
      s.image.pixels.set(s.undoPixels);
      s.preview.data.set(s.undoPreview.data);
      s.painting = false;
      s.lastPaint = null;
      s.stampStroke = null;
      s.undoPixels = null;
      s.undoPreview = null;
      s.strokeCities = null;
      hooks.draw();
      syncButtons();
      hooks.setStatus(`${cityCountStatus(s)} (stroke cancelled)`);
      return;
    }
    if (!undoStack.length) return;
    const current = snapshot();
    if (current) redoStack.push(current);
    restore(undoStack.pop()!);
    hooks.setStatus(`${cityCountStatus(s)} (undo)`);
  }

  function redo(): void {
    if (!s.image || !s.preview || !redoStack.length) return;
    const current = snapshot();
    if (current) {
      undoStack.push(current);
      if (undoStack.length > HISTORY_MAX) undoStack.shift();
    }
    restore(redoStack.pop()!);
    hooks.setStatus(`${cityCountStatus(s)} (redo)`);
  }

  function clear(): void {
    undoStack = [];
    redoStack = [];
    s.undoPixels = null;
    s.undoPreview = null;
    s.strokeCities = null;
    syncButtons();
  }

  return { syncButtons, checkpoint, commitStroke, undo, redo, clear };
}

export type History = ReturnType<typeof createHistory>;
