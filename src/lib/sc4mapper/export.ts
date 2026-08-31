/**
 * Port of SC4Mapper-2026: region export in src/sc4mapper/app.py +
 * src/sc4mapper/region.py (`Save` / ZIP of `.sc4` cities + config.bmp).
 */

import JSZip from "jszip";
import { encodeRgbBmp } from "./bmp";
import { CityTemplate, templateNameForSize } from "./dbpf";
import { City, cityFileName, configRgb } from "./grid";
import { WATER_LEVEL, buildThumbnails, onePassColors } from "./terrain";

export interface Templates {
  small: Uint8Array;
  medium: Uint8Array;
  large: Uint8Array;
}

export interface ExportProgress {
  current: number;
  total: number;
  message: string;
}

export interface WorkerRequest {
  /** Live heightmap (PNG uint16), including any Draw-tool edits. */
  pixels: Uint16Array;
  width: number;
  height: number;
  tilesX: number;
  tilesY: number;
  cities: City[];
  regionName: string;
  templates: Templates;
}

function sliceHeight(
  pixels: Uint16Array,
  width: number,
  city: City,
): Float32Array {
  const x0 = city.x * 64;
  const y0 = city.y * 64;
  const w = city.size * 64 + 1;
  const h = city.size * 64 + 1;
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out[y * w + x] = pixels[(y0 + y) * width + (x0 + x)] / 10;
    }
  }
  return out;
}

export async function buildRegionZip(
  pixels: Uint16Array,
  width: number,
  height: number,
  tilesX: number,
  tilesY: number,
  cities: City[],
  regionName: string,
  templates: Templates,
  onProgress?: (p: ExportProgress) => void,
): Promise<Blob> {
  if (pixels.length !== width * height) {
    throw new Error("heightmap size does not match width×height");
  }
  const parsed = {
    small: new CityTemplate(templates.small),
    medium: new CityTemplate(templates.medium),
    large: new CityTemplate(templates.large),
  };
  const zip = new JSZip();
  const folder = zip.folder(regionName);
  if (!folder) throw new Error("could not create zip folder");
  folder.file("config.bmp", encodeRgbBmp(tilesX, tilesY, configRgb(tilesX, tilesY, cities)));

  const total = cities.length;
  for (let i = 0; i < cities.length; i++) {
    const city = cities[i];
    onProgress?.({
      current: i + 1,
      total,
      message: `Saving ${cityFileName(city.x, city.y)}`,
    });
    const hmap = sliceHeight(pixels, width, city);
    const ySize = city.size * 64 + 1;
    const xSize = city.size * 64 + 1;
    const colors = onePassColors(ySize, xSize, hmap, WATER_LEVEL);
    const thumbs = buildThumbnails(ySize, xSize, hmap, colors);
    const tmpl = parsed[templateNameForSize(city.size)];
    const sc4 = tmpl.save(city.x, city.y, hmap, thumbs.regionPng, thumbs.alphaPng);
    folder.file(cityFileName(city.x, city.y), sc4);
  }
  return zip.generateAsync({ type: "blob" });
}
