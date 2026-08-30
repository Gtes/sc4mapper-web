import { buildRegionZip, type WorkerRequest } from "./export";

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  try {
    const m = ev.data;
    const blob = await buildRegionZip(
      m.pixels,
      m.width,
      m.height,
      m.tilesX,
      m.tilesY,
      m.cities,
      m.regionName,
      m.templates,
      (p) => self.postMessage({ type: "progress", ...p }),
    );
    self.postMessage({ type: "done", blob });
  } catch (err) {
    self.postMessage({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
