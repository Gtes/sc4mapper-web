/** Zoom, pan, and map navigation cursors. */
import type { Dom } from "./dom";
import type { AppState } from "./state";

export const ZOOM_MAX = 16;
export const ZOOM_STEP = 1.25;

export function createNav(s: AppState, dom: Dom) {
  function fitZoom(): number {
    if (!s.image) return 1;
    const pad = 24;
    const availW = Math.max(1, dom.viewPane.clientWidth - pad);
    const availH = Math.max(1, dom.viewPane.clientHeight - pad);
    return Math.min(availW / s.image.width, availH / s.image.height);
  }

  function clampZoom(z: number): number {
    return Math.min(ZOOM_MAX, Math.max(fitZoom() * 0.5, z));
  }

  function formatZoomPercent(z: number): string {
    const pct = Math.round(z * 1000) / 10;
    return Number.isInteger(pct) ? String(pct) : pct.toFixed(1);
  }

  function applyCanvasCssSize(): void {
    if (!s.image) return;
    dom.canvas.style.width = `${s.image.width}px`;
    dom.canvas.style.height = `${s.image.height}px`;
    dom.canvas.style.transform = `translate(${s.panX}px, ${s.panY}px) scale(${s.zoom})`;
    if (document.activeElement !== dom.zoomVal) {
      dom.zoomVal.value = formatZoomPercent(s.zoom);
    }
  }

  function zoomAt(clientX: number, clientY: number, next: number): void {
    if (!s.image || dom.canvas.hidden) return;
    const z = clampZoom(next);
    const pane = dom.viewPane.getBoundingClientRect();
    const mapX = (clientX - pane.left - s.panX) / s.zoom;
    const mapY = (clientY - pane.top - s.panY) / s.zoom;
    s.zoom = z;
    s.panX = clientX - pane.left - mapX * s.zoom;
    s.panY = clientY - pane.top - mapY * s.zoom;
    applyCanvasCssSize();
  }

  function zoomBy(factor: number, clientX?: number, clientY?: number): void {
    if (clientX != null && clientY != null) {
      zoomAt(clientX, clientY, s.zoom * factor);
      return;
    }
    const r = dom.viewPane.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, s.zoom * factor);
  }

  function fitToView(): void {
    if (!s.image) return;
    s.zoom = fitZoom();
    s.panX = (dom.viewPane.clientWidth - s.image.width * s.zoom) / 2;
    s.panY = (dom.viewPane.clientHeight - s.image.height * s.zoom) / 2;
    applyCanvasCssSize();
  }

  function commitZoomInput(): void {
    if (!s.image || dom.canvas.hidden) {
      dom.zoomVal.value = formatZoomPercent(s.zoom);
      return;
    }
    const pct = Number(dom.zoomVal.value.replace("%", "").trim().replace(",", "."));
    if (!Number.isFinite(pct) || pct <= 0) {
      dom.zoomVal.value = formatZoomPercent(s.zoom);
      return;
    }
    const r = dom.viewPane.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, pct / 100);
    dom.zoomVal.value = formatZoomPercent(s.zoom);
  }

  function shouldPan(e: PointerEvent): boolean {
    return e.button === 1 || (e.button === 0 && s.spaceDown);
  }

  function syncCursor(): void {
    const pan = s.spaceDown || s.panning;
    dom.viewPane.classList.toggle("space-nav", pan && !s.panning);
    dom.viewPane.classList.toggle("panning", s.panning);
    dom.viewPane.classList.toggle("zoom-in-nav", s.zDown && !s.altDown && !pan);
    dom.viewPane.classList.toggle("zoom-out-nav", s.zDown && s.altDown && !pan);
  }

  function startPan(e: PointerEvent): void {
    s.panning = true;
    s.panOrigin = { x: e.clientX, y: e.clientY, panX: s.panX, panY: s.panY };
    syncCursor();
    try {
      dom.viewPane.setPointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  }

  function movePan(e: PointerEvent): void {
    if (!s.panning) return;
    s.panX = s.panOrigin.panX + (e.clientX - s.panOrigin.x);
    s.panY = s.panOrigin.panY + (e.clientY - s.panOrigin.y);
    applyCanvasCssSize();
  }

  function endPan(): void {
    if (!s.panning) return;
    s.panning = false;
    syncCursor();
  }

  function handlePointerDown(e: PointerEvent): boolean {
    if (!s.image) return false;
    if (s.zDown && e.button === 0 && !s.spaceDown) {
      e.preventDefault();
      zoomBy(e.altKey || s.altDown ? 1 / ZOOM_STEP : ZOOM_STEP, e.clientX, e.clientY);
      return true;
    }
    if (shouldPan(e)) {
      e.preventDefault();
      startPan(e);
      return true;
    }
    return false;
  }

  function restoreView(zoom: number, panX: number, panY: number): void {
    s.zoom = clampZoom(zoom);
    s.panX = panX;
    s.panY = panY;
    applyCanvasCssSize();
  }

  return {
    applyCanvasCssSize,
    zoomBy,
    zoomAt,
    fitToView,
    commitZoomInput,
    formatZoomPercent,
    syncCursor,
    movePan,
    endPan,
    handlePointerDown,
    restoreView,
  };
}

export type Nav = ReturnType<typeof createNav>;
