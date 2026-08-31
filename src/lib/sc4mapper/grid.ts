/**
 * Port of SC4Mapper-2026: src/sc4mapper/region.py (`BuildBestConfig`, city layout)
 * Original 2013: config.bmp packing (large / medium / small cities).
 */

export type CitySize = 1 | 2 | 4;

export interface City {
  x: number;
  y: number;
  size: CitySize;
}

type RGB = [number, number, number];

const BLUE: RGB = [0, 0, 255];
const GREEN: RGB = [0, 255, 0];
const RED: RGB = [255, 0, 0];

function redish(c: RGB): boolean {
  return c[0] > c[1] && c[0] > c[2] && c[0] > 250;
}
function greenish(c: RGB): boolean {
  return c[1] > c[0] && c[1] > c[2] && c[1] > 250;
}
function blueish(c: RGB): boolean {
  return c[2] > c[0] && c[2] > c[1] && c[2] > 250;
}

function fill(pix: RGB[][], x0: number, y0: number, x1: number, y1: number, color: RGB): void {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) pix[y][x] = color;
  }
}

/** Same packing as Python `BuildBestConfig`. */
export function buildBestPixels(tilesX: number, tilesY: number): RGB[][] {
  const pix: RGB[][] = Array.from({ length: tilesY }, () =>
    Array.from({ length: tilesX }, (): RGB => [...BLUE] as RGB),
  );
  const nbBigX = Math.floor(tilesX / 4);
  const nbBigY = Math.floor(tilesY / 4);
  const rX = tilesX % 4;
  const rY = tilesY % 4;
  const nbMediumX = rX === 3 || rX === 2 ? 1 : 0;
  const nbMediumY = rY === 3 || rY === 2 ? 1 : 0;
  fill(pix, nbBigX * 4, 0, tilesX, tilesY, GREEN);
  fill(pix, 0, nbBigY * 4, tilesX, tilesY, GREEN);
  fill(pix, nbBigX * 4 + nbMediumX * 2, 0, tilesX, tilesY, RED);
  fill(pix, 0, nbBigY * 4 + nbMediumY * 2, tilesX, tilesY, RED);
  return pix;
}

/** Same scan as Python `WorkTheconfig`. */
export function citiesFromPixels(pix: RGB[][]): City[] {
  const w = pix[0].length;
  const h = pix.length;
  const verified = Array.from({ length: h }, () => new Uint8Array(w));
  const smalls: City[] = [];
  const mediums: City[] = [];
  const bigs: City[] = [];

  const verifyMedium = (x: number, y: number) => {
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
      [1, 1],
    ] as const) {
      if (!greenish(pix[y + dy][x + dx])) throw new Error("invalid medium city in config");
    }
    verified[y][x] = 1;
    verified[y][x + 1] = 1;
    verified[y + 1][x] = 1;
    verified[y + 1][x + 1] = 1;
  };

  const verifyLarge = (x: number, y: number) => {
    for (let dy = 0; dy < 4; dy++) {
      for (let dx = 0; dx < 4; dx++) {
        if (dx === 0 && dy === 0) continue;
        if (!blueish(pix[y + dy][x + dx])) throw new Error("invalid large city in config");
      }
    }
    for (let dy = 0; dy < 4; dy++) {
      for (let dx = 0; dx < 4; dx++) verified[y + dy][x + dx] = 1;
    }
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (verified[y][x]) continue;
      const rgb = pix[y][x];
      if (blueish(rgb)) {
        verifyLarge(x, y);
        bigs.push({ x, y, size: 4 });
      } else if (greenish(rgb)) {
        verifyMedium(x, y);
        mediums.push({ x, y, size: 2 });
      } else if (redish(rgb)) {
        smalls.push({ x, y, size: 1 });
      }
    }
  }
  return [...smalls, ...mediums, ...bigs];
}

export function buildBestCities(tilesX: number, tilesY: number): City[] {
  return citiesFromPixels(buildBestPixels(tilesX, tilesY));
}

const SMALL_COLORS = ["#FF7777", "#FF0000"];
const MEDIUM_COLORS = ["#00FF00", "#99FF00", "#00FF99", "#55FF55"];
const LARGE_COLORS = [
  "#0000FF", "#4000FF", "#8000FF", "#C000FF",
  "#0040FF", "#4040FF", "#8040FF", "#C040FF",
  "#0080FF", "#4080FF", "#8080FF", "#C080FF",
  "#00C0FF", "#40C0FF", "#80C0FF", "#C0C0FF",
];

function hexRgb(hex: string): RGB {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

/** Display/save `config.bmp` colours from Python `SC4Region.BuildConfig`. */
export function configRgb(tilesX: number, tilesY: number, cities: City[]): Uint8Array {
  const rgb = new Uint8Array(tilesX * tilesY * 3);
  const setRect = (x0: number, y0: number, x1: number, y1: number, color: RGB) => {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = (y * tilesX + x) * 3;
        rgb[i] = color[0];
        rgb[i + 1] = color[1];
        rgb[i + 2] = color[2];
      }
    }
  };
  for (const c of cities) {
    const k = c.x + c.y;
    if (c.size === 1) setRect(c.x, c.y, c.x, c.y, hexRgb(SMALL_COLORS[k % 2]));
    else if (c.size === 2) setRect(c.x, c.y, c.x + 1, c.y + 1, hexRgb(MEDIUM_COLORS[k % 4]));
    else setRect(c.x, c.y, c.x + 3, c.y + 3, hexRgb(LARGE_COLORS[k % 16]));
  }
  return rgb;
}

export function cityAt(cities: City[], tx: number, ty: number): City | undefined {
  return cities.find(
    (c) => tx >= c.x && tx < c.x + c.size && ty >= c.y && ty < c.y + c.size,
  );
}

export function citiesUnder(cities: City[], x: number, y: number, size: number): City[] {
  return cities.filter(
    (c) => !(x >= c.x + c.size || x + size <= c.x || y >= c.y + c.size || y + size <= c.y),
  );
}

export function clampCityOrigin(
  tx: number,
  ty: number,
  size: CitySize,
  tilesX: number,
  tilesY: number,
): { x: number; y: number } | null {
  let x = tx;
  let y = ty;
  if (x + size > tilesX) x = tilesX - size;
  if (y + size > tilesY) y = tilesY - size;
  if (x < 0 || y < 0 || x + size > tilesX || y + size > tilesY) return null;
  return { x, y };
}

/** Place a city, splitting overlapping larger cities first (desktop `OnLeftUp`). */
export function placeCity(
  cities: City[],
  tx: number,
  ty: number,
  size: CitySize,
  tilesX: number,
  tilesY: number,
): City[] {
  const origin = clampCityOrigin(tx, ty, size, tilesX, tilesY);
  if (!origin) return cities;
  let next = cities.slice();
  let done = false;
  while (!done) {
    done = true;
    for (const city of citiesUnder(next, origin.x, origin.y, size)) {
      if (city.size === 1) {
        next = next.filter((c) => c !== city);
      } else {
        done = false;
        next = splitCity(next, city);
      }
    }
  }
  next.push({ x: origin.x, y: origin.y, size });
  return next;
}

export function eraseCityAt(cities: City[], tx: number, ty: number): City[] {
  const hit = cityAt(cities, tx, ty);
  if (!hit) return cities;
  return cities.filter((c) => c !== hit);
}

export function cloneCities(cities: City[]): City[] {
  return cities.map((c) => ({ ...c }));
}

/** Split a medium/large city into four smaller ones (desktop `CityProxy.Split`). */
export function splitCity(cities: City[], target: City): City[] {
  if (target.size === 1) return cities;
  const half = (target.size / 2) as CitySize;
  const next = cities.filter((c) => c !== target);
  next.push(
    { x: target.x, y: target.y, size: half },
    { x: target.x + half, y: target.y, size: half },
    { x: target.x + half, y: target.y + half, size: half },
    { x: target.x, y: target.y + half, size: half },
  );
  return next;
}

export function cityFileName(x: number, y: number): string {
  const p = (n: number) => n.toString().padStart(3, "0");
  return `City - New city(${p(x)}-${p(y)}).sc4`;
}
