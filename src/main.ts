/**
 * Boot and event wiring only.
 * App shell: src/app/ · tools: src/tools/ · mapper port: src/lib/sc4mapper/
 */
import "./style.css";
import { cloneCities } from "./lib/sc4mapper";
import { cityCountStatus, createAppState, isBrushMode, isTextEntry, loadTemplates, snapshotHotState, applyHotState, type HotState } from "./app/state";
import { bindDom } from "./app/dom";
import { createHistory } from "./app/history";
import { createNav, ZOOM_STEP } from "./app/nav";
import { createView } from "./app/view";
import { createTools } from "./tools/map-tools";
import { createSession } from "./app/session";

const dom = bindDom();
const s = createAppState();
const ac = new AbortController();
const { signal } = ac;

function setStatus(msg: string): void {
  dom.statusEl.textContent = msg;
}

const nav = createNav(s, dom);
const view = createView(s, dom, nav);
const draftApi = { scheduleDraftSave: (): void => undefined };
const history = createHistory(s, dom, {
  draw: () => view.draw(),
  setStatus,
  scheduleDraftSave: () => draftApi.scheduleDraftSave(),
});
const tools = createTools(s, dom, history, view, {
  setStatus,
  scheduleDraftSave: () => draftApi.scheduleDraftSave(),
});
const session = createSession(s, dom, history, nav, view, tools, { setStatus });
draftApi.scheduleDraftSave = () => session.scheduleDraftSave();

const restored = import.meta.hot?.data.state as HotState | undefined;
if (restored) {
  applyHotState(s, restored);
  if (restored.regionName) dom.nameInput.value = restored.regionName;
  dom.overlayCbx.checked = s.overlayOn;
}

if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose((data) => {
    ac.abort();
    data.state = snapshotHotState(s, dom.nameInput.value, dom.statusEl.textContent ?? "");
  });
}

dom.fileInput.addEventListener("change", () => {
  const f = dom.fileInput.files?.[0];
  if (f) session.onFile(f).catch((e) => setStatus(e instanceof Error ? e.message : String(e)));
}, { signal });

dom.drop.addEventListener("dragover", (e) => {
  e.preventDefault();
  dom.drop.classList.add("over");
}, { signal });
dom.drop.addEventListener("dragleave", () => dom.drop.classList.remove("over"), { signal });
dom.drop.addEventListener("drop", (e) => {
  e.preventDefault();
  dom.drop.classList.remove("over");
  const f = e.dataTransfer?.files[0];
  if (f) session.onFile(f).catch((err) => setStatus(err instanceof Error ? err.message : String(err)));
}, { signal });

dom.canvas.addEventListener("click", (e) => tools.onCityClick(e), { signal });
dom.canvas.addEventListener("pointerdown", (e) => {
  if (!s.image) return;
  if (nav.handlePointerDown(e)) return;
  tools.onBrushDown(e);
}, { signal });
dom.canvas.addEventListener("pointermove", (e) => {
  if (!s.image || s.panning || s.spaceDown || s.zDown) return;
  if (tools.onBrushMove(e)) return;
  tools.onCityHover(e);
}, { signal });

function endPaint(): void {
  if (!s.painting) return;
  s.painting = false;
  s.lastPaint = null;
  history.commitStroke();
  session.scheduleDraftSave();
}

function endPointer(): void {
  endPaint();
  nav.endPan();
}

dom.canvas.addEventListener("pointerup", endPointer, { signal });
dom.canvas.addEventListener("pointercancel", endPointer, { signal });
window.addEventListener("pointerup", endPointer, { signal });
dom.viewPane.addEventListener("pointerdown", (e) => {
  if (!s.image || e.target === dom.canvas) return;
  nav.handlePointerDown(e);
}, { signal });
dom.viewPane.addEventListener("pointermove", (e) => {
  if (!s.panning) return;
  e.preventDefault();
  nav.movePan(e);
}, { signal });
dom.viewPane.addEventListener("pointerup", () => nav.endPan(), { signal });
dom.viewPane.addEventListener("pointercancel", () => nav.endPan(), { signal });
dom.viewPane.addEventListener("auxclick", (e) => {
  if (e.button === 1) e.preventDefault();
}, { signal });
dom.viewPane.addEventListener("wheel", (e) => {
  if (!s.image || dom.canvas.hidden) return;
  e.preventDefault();
  nav.zoomBy(e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, e.clientX, e.clientY);
}, { passive: false, signal });
dom.zoomInBtn.addEventListener("click", () => nav.zoomBy(ZOOM_STEP), { signal });
dom.zoomOutBtn.addEventListener("click", () => nav.zoomBy(1 / ZOOM_STEP), { signal });
dom.zoomFitBtn.addEventListener("click", () => nav.fitToView(), { signal });
dom.zoomVal.addEventListener("change", () => nav.commitZoomInput(), { signal });
dom.zoomVal.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    nav.commitZoomInput();
    dom.zoomVal.blur();
  } else if (e.key === "Escape") {
    dom.zoomVal.value = nav.formatZoomPercent(s.zoom);
    dom.zoomVal.blur();
  }
}, { signal });

window.addEventListener("keydown", (e) => {
  if (isTextEntry(e.target)) return;
  const mapOn = Boolean(s.image && !dom.canvas.hidden);
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.code === "KeyZ") {
    e.preventDefault();
    if (e.shiftKey) history.redo();
    else history.undo();
    return;
  }
  if (mod && e.code === "KeyY" && !e.shiftKey) {
    e.preventDefault();
    history.redo();
    return;
  }
  if (e.code === "Space") {
    if (!s.spaceDown) {
      s.spaceDown = true;
      nav.syncCursor();
      if (mapOn) view.draw();
    }
    if (mapOn) e.preventDefault();
    return;
  }
  if (e.code === "KeyZ" && !e.ctrlKey && !e.metaKey) {
    if (!s.zDown) {
      s.zDown = true;
      s.altDown = e.altKey;
      nav.syncCursor();
      if (mapOn) view.draw();
    }
    if (mapOn) e.preventDefault();
    return;
  }
  if (e.key === "Alt") {
    s.altDown = true;
    nav.syncCursor();
    tools.syncButtons();
    if (mapOn) view.draw();
    return;
  }
  if (!mapOn) return;
  if (e.key === "+" || e.key === "=") {
    e.preventDefault();
    nav.zoomBy(ZOOM_STEP);
  } else if (e.key === "-" || e.key === "_") {
    e.preventDefault();
    nav.zoomBy(1 / ZOOM_STEP);
  } else if (e.key === "0") {
    e.preventDefault();
    nav.fitToView();
  }
}, { capture: true, signal });
window.addEventListener("keyup", (e) => {
  if (e.code === "Space") {
    s.spaceDown = false;
    nav.syncCursor();
    view.draw();
    return;
  }
  if (e.code === "KeyZ") {
    s.zDown = false;
    nav.syncCursor();
    view.draw();
    return;
  }
  if (e.key === "Alt") {
    s.altDown = false;
    nav.syncCursor();
    tools.syncButtons();
    view.draw();
  }
}, { capture: true, signal });
window.addEventListener("blur", () => {
  s.spaceDown = false;
  s.zDown = false;
  s.altDown = false;
  nav.syncCursor();
  tools.syncButtons();
}, { signal });

dom.canvas.addEventListener("mouseleave", () => {
  if (!s.hover && !s.hoverPx) return;
  s.hover = null;
  s.hoverPx = null;
  if (s.sampling) tools.syncColorUi(tools.currentMapperHeight(), true);
  view.draw();
}, { signal });

dom.downloadBtn.addEventListener("click", (e) => {
  e.preventDefault();
  session.downloadZip();
}, { signal });
dom.downloadSc4mBtn.addEventListener("click", (e) => {
  e.preventDefault();
  session.downloadSc4m();
}, { signal });

dom.btnSmall.addEventListener("click", () => tools.setEditMode("small"), { signal });
dom.btnMedium.addEventListener("click", () => tools.setEditMode("medium"), { signal });
dom.btnBig.addEventListener("click", () => tools.setEditMode("big"), { signal });
dom.btnErase.addEventListener("click", () => tools.setEditMode("erase"), { signal });
dom.btnDraw.addEventListener("click", () => tools.setEditMode("draw"), { signal });
dom.btnStamp.addEventListener("click", () => tools.setEditMode("stamp"), { signal });

const stampTipWrap = dom.btnStamp.closest(".has-tip");
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

dom.btnRevert.addEventListener("click", () => {
  if (!s.image) return;
  history.checkpoint();
  s.cities = cloneCities(s.originalCities);
  s.editMode = "none";
  s.hover = null;
  tools.syncButtons();
  view.draw();
  setStatus(`${cityCountStatus(s)} (reverted)`);
  session.scheduleDraftSave();
}, { signal });
dom.helpBtn.addEventListener("click", () => {
  if (typeof dom.helpDialog.showModal === "function") dom.helpDialog.showModal();
}, { signal });
dom.btnUndo.addEventListener("click", () => history.undo(), { signal });
dom.btnRedo.addEventListener("click", () => history.redo(), { signal });
dom.btnReset.addEventListener("click", () => {
  dom.resetDialog.returnValue = "";
  if (typeof dom.resetDialog.showModal === "function") dom.resetDialog.showModal();
  else if (window.confirm("Clear the map, undo history, and the saved draft in this browser?")) {
    void session.resetAll();
  }
}, { signal });
dom.resetDialog.addEventListener("close", () => {
  if (dom.resetDialog.returnValue === "confirm") void session.resetAll();
}, { signal });
dom.brushSizeEl.addEventListener("input", () => {
  dom.brushSizeVal.textContent = dom.brushSizeEl.value;
  if (isBrushMode(s.editMode)) view.draw();
}, { signal });
dom.brushSoftEl.addEventListener("input", () => {
  dom.brushSoftVal.textContent = dom.brushSoftEl.value;
  if (isBrushMode(s.editMode)) view.draw();
}, { signal });
dom.paintWater.addEventListener("change", () => {
  s.sampling = false;
  tools.syncColorUi(tools.currentMapperHeight(), true);
  tools.syncButtons();
  if (s.editMode === "draw") view.draw();
}, { signal });
dom.paintGreen.addEventListener("change", () => {
  s.sampling = false;
  tools.syncColorUi(tools.currentMapperHeight(), true);
  tools.syncButtons();
  if (s.editMode === "draw") view.draw();
}, { signal });
dom.paintCustom.addEventListener("change", () => {
  s.sampling = false;
  tools.syncColorUi(s.customMapper, true);
  tools.syncButtons();
  if (s.editMode === "draw") view.draw();
}, { signal });
dom.paintColorEl.addEventListener("input", () => tools.pickCustomFromColor(), { signal });
dom.paintColorEl.addEventListener("change", () => {
  tools.syncColorUi(s.customMapper, true);
  if (s.editMode === "draw") view.draw();
}, { signal });
dom.paintSampleBtn.addEventListener("click", () => {
  s.sampling = !s.sampling;
  if (!s.sampling) tools.syncColorUi(tools.currentMapperHeight(), true);
  tools.syncButtons();
  view.draw();
}, { signal });
dom.overlayCbx.addEventListener("change", () => {
  s.overlayOn = dom.overlayCbx.checked;
  view.draw();
  session.scheduleDraftSave();
}, { signal });
dom.nameInput.addEventListener("change", () => session.scheduleDraftSave(), { signal });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") session.writeDraft();
}, { signal });
window.addEventListener("pagehide", () => session.writeDraft(), { signal });

if (s.templates) {
  void session.boot(restored);
} else {
  loadTemplates()
    .then((t) => {
      s.templates = t;
      return session.boot(restored);
    })
    .catch((e) => setStatus(e instanceof Error ? e.message : String(e)));
}

tools.syncColorUi(tools.currentMapperHeight(), true);
