/**
 * Port of SC4Mapper-2026: src/sc4mapper/region.py (`SaveFile.Save`)
 * Original 2013: DBPF city save / blank city template patching.
 */

import { decode, encode } from "./qfs";

const COMPRESSED_SIG = 0xfb10;
const TGI_HEIGHT = [0xa9dd6ff4, 0xe98f9525, 0x00000001] as const;
const TGI_INFO = [0xca027edb, 0xca027ee1, 0x00000000] as const;
const TGI_REGION = [0x8a2482b9, 0x4a2482bb, 0x00000000] as const;
const TGI_ALPHA = [0x8a2482b9, 0x4a2482bb, 0x00000002] as const;
const TGI_TRANS = [0x8a2482b9, 0x4a2482bb, 0x00000004] as const;
const TGI_TRANS_ALPHA = [0x8a2482b9, 0x4a2482bb, 0x00000006] as const;

function tgiEq(a: readonly [number, number, number], t: number, g: number, i: number): boolean {
  return a[0] === t && a[1] === g && a[2] === i;
}

function u32(view: DataView, off: number): number {
  return view.getUint32(off, true);
}

function setU32(arr: Uint8Array, off: number, value: number): void {
  new DataView(arr.buffer, arr.byteOffset, arr.byteLength).setUint32(off, value >>> 0, true);
}

function prefixLen(payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + payload.length);
  new DataView(out.buffer).setInt32(0, payload.length, true);
  out.set(payload, 4);
  return out;
}

interface Entry {
  t: number;
  g: number;
  i: number;
  index: Uint8Array;
  raw: Uint8Array;
  content: Uint8Array | null;
}

export class CityTemplate {
  private header: Uint8Array;
  private entries: Entry[];
  private saveSerial = 3;

  constructor(file: Uint8Array) {
    const header = file.slice(0, 96);
    header.fill(0, 0x30, 0x3c);
    this.header = header;
    const hv = new DataView(header.buffer, header.byteOffset, 96);
    const count = u32(hv, 36);
    const indexPos = u32(hv, 40);
    const index = file.subarray(indexPos, indexPos + count * 20);
    this.entries = [];
    for (let idx = 0; idx < count; idx++) {
      const rec = index.slice(idx * 20, idx * 20 + 20);
      const rv = new DataView(rec.buffer, rec.byteOffset, 20);
      const t = u32(rv, 0);
      const g = u32(rv, 4);
      const i = u32(rv, 8);
      const loc = rv.getInt32(12, true);
      const size = rv.getInt32(16, true);
      const raw = file.slice(loc, loc + size);
      let content: Uint8Array | null = null;
      const isDeep = tgiEq(TGI_HEIGHT, t, g, i) || tgiEq(TGI_INFO, t, g, i);
      if (isDeep && raw.length >= 8) {
        const sig = new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getUint16(4, true);
        if (sig === COMPRESSED_SIG) content = decode(raw.subarray(4));
      }
      this.entries.push({ t, g, i, index: rec, raw, content });
    }
  }

  save(cityXPos: number, cityYPos: number, heightF32: Float32Array, regionPng: Uint8Array, alphaPng: Uint8Array): Uint8Array {
    const heightBytes = new Uint8Array(2 + heightF32.byteLength);
    new DataView(heightBytes.buffer).setUint16(0, 2, true);
    heightBytes.set(new Uint8Array(heightF32.buffer, heightF32.byteOffset, heightF32.byteLength), 2);
    const newHeight = prefixLen(encode(heightBytes));

    const header = this.header.slice();
    const dateUpdated = (Math.floor(Date.now() / 1000) + this.saveSerial * 65535) >>> 0;
    this.saveSerial += 1;
    setU32(header, 0x1c, dateUpdated);
    setU32(header, 0x28, 96);

    const indexLen = this.entries.length * 20;
    let pos = 96 + indexLen;
    const indexOut = new Uint8Array(indexLen);
    const bodies: Uint8Array[] = [];

    for (let n = 0; n < this.entries.length; n++) {
      const e = this.entries[n];
      let rec = e.index.slice();
      let body = e.raw;
      setU32(rec, 0x0c, pos);

      if (tgiEq(TGI_HEIGHT, e.t, e.g, e.i)) {
        body = newHeight;
        setU32(rec, 0x10, body.length);
      } else if (tgiEq(TGI_INFO, e.t, e.g, e.i)) {
        const src = e.content;
        if (!src) throw new Error("city info entry was not decompressed");
        const content = src.slice();
        setU32(content, 0x04, cityXPos);
        setU32(content, 0x08, cityYPos);
        setU32(content, 39, dateUpdated);
        body = prefixLen(encode(content));
        setU32(rec, 0x10, body.length);
      } else if (tgiEq(TGI_REGION, e.t, e.g, e.i) || tgiEq(TGI_TRANS, e.t, e.g, e.i)) {
        body = regionPng;
        setU32(rec, 0x10, body.length);
      } else if (tgiEq(TGI_ALPHA, e.t, e.g, e.i) || tgiEq(TGI_TRANS_ALPHA, e.t, e.g, e.i)) {
        body = alphaPng;
        setU32(rec, 0x10, body.length);
      }

      indexOut.set(rec, n * 20);
      bodies.push(body);
      pos += body.length;
    }

    let total = 96 + indexLen;
    for (const b of bodies) total += b.length;
    const out = new Uint8Array(total);
    out.set(header, 0);
    out.set(indexOut, 96);
    let o = 96 + indexLen;
    for (const b of bodies) {
      out.set(b, o);
      o += b.length;
    }
    return out;
  }
}

export function templateNameForSize(size: 1 | 2 | 4): "small" | "medium" | "large" {
  if (size === 1) return "small";
  if (size === 2) return "medium";
  return "large";
}
