/**
 * TypeScript port of SC4Mapper-2026 (Python), itself from SC4Mapper-2013.
 *
 * Python counterparts (src/sc4mapper/ unless noted):
 *   qfs.ts         qfs.py  (2013: Modules/qfs.c)
 *   terrain.ts     terrain.py + config/SC4Mapper.ini  (2013: Modules/terrain.cpp)
 *   grid.ts        region.py  BuildBestConfig
 *   dbpf.ts        region.py  SaveFile.Save
 *   png16.ts       png16.py
 *   bmp.ts         config.bmp write in app.py / region.py
 *   png-encode.ts  Pillow PNG output used by terrain.py generateImage
 *   export.ts      app.py + region.py region ZIP
 *   sc4m.ts        app.py ExportAsSC4M / CreateRgnFromSC4M
 *
 * Web UI (Draw, Stamp, draft) lives in src/tools/ and src/app/ — not here.
 */
export { decode, encode } from "./qfs";
export { WATER_LEVEL, onePassColors, recolorPatch, buildThumbnails, paletteRgbForHeight, heightForPaletteRgb, hexToRgb, rgbToHex } from "./terrain";
export {
  buildBestCities,
  clampCityOrigin,
  cloneCities,
  eraseCityAt,
  placeCity,
  cityFileName,
  citiesFromConfigRgb,
  configRgb,
  type City,
  type CitySize,
} from "./grid";
export { CityTemplate, templateNameForSize } from "./dbpf";
export { decodeGray16Png, tilesFromPixels, type Gray16Image } from "./png16";
export { encodeRgbBmp } from "./bmp";
export { encodeRgbaPng } from "./png-encode";
export { buildRegionZip, type Templates, type WorkerRequest, type ExportProgress } from "./export";
export { encodeSc4m, decodeSc4m, type Sc4mMap } from "./sc4m";
