import { zlibSync } from "fflate";

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  out[4] = type.charCodeAt(0);
  out[5] = type.charCodeAt(1);
  out[6] = type.charCodeAt(2);
  out[7] = type.charCodeAt(3);
  out.set(data, 8);
  const crcBuf = out.subarray(4, 8 + data.length);
  v.setUint32(8 + data.length, crc32(crcBuf));
  return out;
}

/** 8-bit RGBA PNG (filter 0). Used for region-view thumbnails inside .sc4 files. */
export function encodeRgbaPng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const raw = new Uint8Array(height * (1 + width * 4));
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0;
    const row = y * width * 4;
    raw.set(rgba.subarray(row, row + width * 4), o);
    o += width * 4;
  }
  const compressed = zlibSync(raw, { level: 6 });
  const ihdr = new Uint8Array(13);
  const hv = new DataView(ihdr.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const cIHDR = chunk("IHDR", ihdr);
  const cIDAT = chunk("IDAT", compressed);
  const cIEND = chunk("IEND", new Uint8Array(0));
  const out = new Uint8Array(sig.length + cIHDR.length + cIDAT.length + cIEND.length);
  out.set(sig, 0);
  out.set(cIHDR, sig.length);
  out.set(cIDAT, sig.length + cIHDR.length);
  out.set(cIEND, sig.length + cIHDR.length + cIDAT.length);
  return out;
}
