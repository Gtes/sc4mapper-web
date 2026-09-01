/** Sidebar + canvas elements. Look up once at boot. */

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

export function bindDom() {
  const canvas = el<HTMLCanvasElement>("view");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas unavailable");
  const btnSmall = el<HTMLButtonElement>("tool-small");
  const btnMedium = el<HTMLButtonElement>("tool-medium");
  const btnBig = el<HTMLButtonElement>("tool-big");
  const btnErase = el<HTMLButtonElement>("tool-erase");
  const btnDraw = el<HTMLButtonElement>("tool-draw");
  const btnStamp = el<HTMLButtonElement>("tool-stamp");
  return {
    drop: el<HTMLLabelElement>("drop"),
    fileInput: el<HTMLInputElement>("file"),
    nameInput: el<HTMLInputElement>("name"),
    downloadBtn: el<HTMLButtonElement>("download"),
    downloadSc4mBtn: el<HTMLButtonElement>("download-sc4m"),
    statusEl: el<HTMLParagraphElement>("status"),
    canvas,
    ctx,
    viewPane: el<HTMLElement>("view-pane"),
    zoomBar: el<HTMLDivElement>("zoom-bar"),
    zoomInBtn: el<HTMLButtonElement>("zoom-in"),
    zoomOutBtn: el<HTMLButtonElement>("zoom-out"),
    zoomFitBtn: el<HTMLButtonElement>("zoom-fit"),
    zoomVal: el<HTMLInputElement>("zoom-val"),
    hintEl: el<HTMLParagraphElement>("hint"),
    overlayCbx: el<HTMLInputElement>("overlay"),
    btnSmall,
    btnMedium,
    btnBig,
    btnErase,
    btnDraw,
    btnStamp,
    btnRevert: el<HTMLButtonElement>("tool-revert"),
    btnUndo: el<HTMLButtonElement>("tool-undo"),
    btnRedo: el<HTMLButtonElement>("tool-redo"),
    btnReset: el<HTMLButtonElement>("tool-reset"),
    resetDialog: el<HTMLDialogElement>("reset-dialog"),
    helpBtn: el<HTMLButtonElement>("help-btn"),
    helpDialog: el<HTMLDialogElement>("help-dialog"),
    drawOpts: el<HTMLDivElement>("draw-opts"),
    brushOptsLabel: el<HTMLSpanElement>("brush-opts-label"),
    paintColorOpts: el<HTMLDivElement>("paint-color-opts"),
    paintWater: el<HTMLInputElement>("paint-water"),
    paintGreen: el<HTMLInputElement>("paint-green"),
    paintCustom: el<HTMLInputElement>("paint-custom"),
    paintColorEl: el<HTMLInputElement>("paint-color"),
    paintSampleBtn: el<HTMLButtonElement>("paint-sample"),
    paintHeightVal: el<HTMLSpanElement>("paint-height-val"),
    brushSizeEl: el<HTMLInputElement>("brush-size"),
    brushSizeVal: el<HTMLSpanElement>("brush-size-val"),
    brushSoftEl: el<HTMLInputElement>("brush-soft"),
    brushSoftVal: el<HTMLSpanElement>("brush-soft-val"),
    modeButtons: [btnSmall, btnMedium, btnBig, btnErase, btnDraw, btnStamp],
  };
}

export type Dom = ReturnType<typeof bindDom>;
