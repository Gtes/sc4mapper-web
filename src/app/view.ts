/** Map canvas: height preview, city overlay, brush / stamp cursors. */
import { clampCityOrigin, paletteRgbForHeight, rgbToHex } from "../lib/sc4mapper";
import type { Dom } from "./dom";
import type { AppState } from "./state";
import { isBrushMode, sizeForMode } from "./state";
import type { Nav } from "./nav";

export function createView(s: AppState, dom: Dom, nav: Nav) {
  function screenLineWidth(): number {
    return 0.5 / Math.max(s.zoom, 0.01);
  }

  function strokeOutline(drawPath: () => void, dashed: boolean): void {
    const { ctx } = dom;
    ctx.setLineDash(dashed ? [Math.max(1, 4 / s.zoom), Math.max(1, 3 / s.zoom)] : []);
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
      dom.ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    }, dashed);
  }

  function strokeCrosshair(cx: number, cy: number): void {
    const arm = Math.max(4, 8 / s.zoom);
    strokeOutline(() => {
      const { ctx } = dom;
      ctx.moveTo(cx - arm, cy);
      ctx.lineTo(cx + arm, cy);
      ctx.moveTo(cx, cy - arm);
      ctx.lineTo(cx, cy + arm);
    }, false);
  }

  function softness(): number {
    return Number(dom.brushSoftEl.value) / 100;
  }

  function draw(): void {
    if (!s.image || !s.preview) return;
    const { canvas, ctx } = dom;
    canvas.width = s.image.width;
    canvas.height = s.image.height;
    canvas.hidden = false;
    nav.applyCanvasCssSize();
    ctx.putImageData(s.preview, 0, 0);

    if (s.overlayOn) {
      ctx.strokeStyle = "rgba(200,200,200,0.55)";
      ctx.lineWidth = 1;
      for (let y = 1; y < s.tilesY; y++) {
        const py = y * 64 + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, py);
        ctx.lineTo(s.image.width, py);
        ctx.stroke();
      }
      for (let x = 1; x < s.tilesX; x++) {
        const px = x * 64 + 0.5;
        ctx.beginPath();
        ctx.moveTo(px, 0);
        ctx.lineTo(px, s.image.height);
        ctx.stroke();
      }
      for (const c of s.cities) {
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

    const placeSize = sizeForMode(s.editMode);
    if (placeSize && s.hover) {
      const origin = clampCityOrigin(s.hover.x, s.hover.y, placeSize, s.tilesX, s.tilesY);
      if (origin) {
        ctx.strokeStyle = placeSize === 4 ? "#88aaff" : placeSize === 2 ? "#88ff88" : "#ff8888";
        ctx.lineWidth = 3;
        ctx.setLineDash([8, 6]);
        ctx.strokeRect(origin.x * 64 + 0.5, origin.y * 64 + 0.5, placeSize * 64, placeSize * 64);
        ctx.setLineDash([]);
      }
    }

    if (isBrushMode(s.editMode) && !s.spaceDown && !s.zDown && !s.panning) {
      if (s.editMode === "stamp" && (s.altDown || s.stampSource)) {
        if (s.altDown && s.hoverPx) {
          strokeCrosshair(s.hoverPx.x + 0.5, s.hoverPx.y + 0.5);
        } else if (s.stampAlign && s.hoverPx) {
          const r = Number(dom.brushSizeEl.value);
          const cx = s.hoverPx.x + 0.5;
          const cy = s.hoverPx.y + 0.5;
          strokeBrushRing(cx, cy, r, false);
          const core = r * (1 - softness());
          if (core > 1.5) strokeBrushRing(cx, cy, core, true);
          strokeBrushRing(cx + s.stampAlign.ox, cy + s.stampAlign.oy, r, true);
          strokeCrosshair(cx + s.stampAlign.ox, cy + s.stampAlign.oy);
        } else if (s.stampSource) {
          strokeCrosshair(s.stampSource.x + 0.5, s.stampSource.y + 0.5);
          if (s.hoverPx) {
            strokeBrushRing(s.hoverPx.x + 0.5, s.hoverPx.y + 0.5, Number(dom.brushSizeEl.value), false);
          }
        }
      } else if (s.hoverPx) {
        if (s.sampling && s.image) {
          const H = s.image.pixels[s.hoverPx.y * s.image.width + s.hoverPx.x] / 10;
          const [r, g, b] = paletteRgbForHeight(H);
          dom.paintColorEl.value = rgbToHex(r, g, b);
          dom.paintHeightVal.textContent = `height ${Math.round(H)}`;
          strokeCrosshair(s.hoverPx.x + 0.5, s.hoverPx.y + 0.5);
        } else {
          const r = Number(dom.brushSizeEl.value);
          const cx = s.hoverPx.x + 0.5;
          const cy = s.hoverPx.y + 0.5;
          strokeBrushRing(cx, cy, r, false);
          const core = r * (1 - softness());
          if (core > 1.5) strokeBrushRing(cx, cy, core, true);
        }
      }
    }
  }

  return { draw, softness };
}

export type View = ReturnType<typeof createView>;
