/**
 * Port of SC4Mapper-2026: src/sc4mapper/qfs.py
 * Original 2013: Modules/qfs.c (Denis Auroux QFS v1.22).
 */

const QFS_MAXITER = 50;
const WINDOW_LEN = 1 << 17;
const WINDOW_MASK = WINDOW_LEN - 1;

function refcopy(buf: Uint8Array, pos: number, offset: number, length: number): void {
  const src = pos - offset;
  if (offset >= length) {
    buf.set(buf.subarray(src, src + length), pos);
  } else {
    for (let i = 0; i < length; i++) buf[pos + i] = buf[src + i];
  }
}

export function decode(data: Uint8Array): Uint8Array {
  const inbuf = data;
  const inlen = inbuf.length;
  if (inlen < 5) return new Uint8Array(0);
  const outlen = (inbuf[2] << 16) + (inbuf[3] << 8) + inbuf[4];
  const outbuf = new Uint8Array(outlen);
  let inpos = inbuf[0] & 0x01 ? 8 : 5;
  let outpos = 0;

  while (inpos < inlen && inbuf[inpos] < 0xfc) {
    const packcode = inbuf[inpos];
    const a = inpos + 1 < inlen ? inbuf[inpos + 1] : 0;
    const b = inpos + 2 < inlen ? inbuf[inpos + 2] : 0;

    if (!(packcode & 0x80)) {
      const nlit = packcode & 3;
      outbuf.set(inbuf.subarray(inpos + 2, inpos + 2 + nlit), outpos);
      inpos += nlit + 2;
      outpos += nlit;
      const length = ((packcode & 0x1c) >> 2) + 3;
      const offset = ((packcode >> 5) << 8) + a + 1;
      refcopy(outbuf, outpos, offset, length);
      outpos += length;
    } else if (!(packcode & 0x40)) {
      const nlit = (a >> 6) & 3;
      outbuf.set(inbuf.subarray(inpos + 3, inpos + 3 + nlit), outpos);
      inpos += nlit + 3;
      outpos += nlit;
      const length = (packcode & 0x3f) + 4;
      const offset = (a & 0x3f) * 256 + b + 1;
      refcopy(outbuf, outpos, offset, length);
      outpos += length;
    } else if (!(packcode & 0x20)) {
      const c = inbuf[inpos + 3];
      const nlit = packcode & 3;
      outbuf.set(inbuf.subarray(inpos + 4, inpos + 4 + nlit), outpos);
      inpos += nlit + 4;
      outpos += nlit;
      const length = ((packcode >> 2) & 3) * 256 + c + 5;
      const offset = ((packcode & 0x10) << 12) + 256 * a + b + 1;
      refcopy(outbuf, outpos, offset, length);
      outpos += length;
    } else {
      const nlit = (packcode & 0x1f) * 4 + 4;
      outbuf.set(inbuf.subarray(inpos + 1, inpos + 1 + nlit), outpos);
      inpos += nlit + 1;
      outpos += nlit;
    }
  }

  if (inpos < inlen && outpos < outlen) {
    const nlit = inbuf[inpos] & 3;
    outbuf.set(inbuf.subarray(inpos + 1, inpos + 1 + nlit), outpos);
  }
  return outbuf;
}

function matchLen(buf: Uint8Array, p1: number, p2: number, maxlen: number): number {
  let n = 0;
  const step = 64;
  while (n + step <= maxlen) {
    let same = true;
    for (let i = 0; i < step; i++) {
      if (buf[p1 + n + i] !== buf[p2 + n + i]) {
        same = false;
        break;
      }
    }
    if (!same) break;
    n += step;
  }
  while (n < maxlen && buf[p1 + n] === buf[p2 + n]) n++;
  return n;
}

export function encode(src: Uint8Array): Uint8Array {
  const inlen = src.length;
  const inbuf = new Uint8Array(inlen + 1064);
  inbuf.set(src);
  const outbuf = new Uint8Array(inlen * 2 + 1064);

  const revSimilar = new Int32Array(WINDOW_LEN);
  revSimilar.fill(-1);
  const revLast = new Int32Array(256 * 256);
  revLast.fill(-1);

  outbuf[0] = 0x10;
  outbuf[1] = 0xfb;
  outbuf[2] = (inlen >> 16) & 0xff;
  outbuf[3] = (inlen >> 8) & 0xff;
  outbuf[4] = inlen & 0xff;
  let outpos = 5;
  let lastwrot = 0;

  for (let inpos = 0; inpos < inlen; inpos++) {
    const cur = inbuf[inpos];
    const nxt = inbuf[inpos + 1];
    let offs = revLast[cur * 256 + nxt];
    revSimilar[inpos & WINDOW_MASK] = offs;
    revLast[cur * 256 + nxt] = inpos;
    if (inpos < lastwrot) continue;

    let bestlen = 0;
    let bestoffs = 0;
    let it = 0;
    while (offs >= 0 && inpos - offs < WINDOW_LEN && it < QFS_MAXITER) {
      it++;
      if (bestlen >= 2 && inbuf[inpos + bestlen] !== inbuf[offs + bestlen]) {
        offs = revSimilar[offs & WINDOW_MASK];
        continue;
      }
      const length = 2 + matchLen(inbuf, inpos + 2, offs + 2, 1026);
      if (length > bestlen) {
        bestlen = length;
        bestoffs = inpos - offs;
      }
      offs = revSimilar[offs & WINDOW_MASK];
    }

    if (bestlen > inlen - inpos) bestlen = inpos - inlen;
    if (bestlen <= 2) bestlen = 0;
    if (bestlen === 3 && bestoffs > 1024) bestlen = 0;
    if (bestlen === 4 && bestoffs > 16384) bestlen = 0;

    if (bestlen) {
      while (inpos - lastwrot >= 4) {
        let n = Math.floor((inpos - lastwrot) / 4) - 1;
        if (n > 0x1b) n = 0x1b;
        outbuf[outpos] = 0xe0 + n;
        outpos += 1;
        n = 4 * n + 4;
        outbuf.set(inbuf.subarray(lastwrot, lastwrot + n), outpos);
        lastwrot += n;
        outpos += n;
      }

      const nlit = inpos - lastwrot;
      if (bestlen <= 10 && bestoffs <= 1024) {
        outbuf[outpos] = (((bestoffs - 1) >> 8) << 5) + ((bestlen - 3) << 2) + nlit;
        outbuf[outpos + 1] = (bestoffs - 1) & 0xff;
        outpos += 2;
      } else if (bestlen <= 67 && bestoffs <= 16384) {
        outbuf[outpos] = 0x80 + (bestlen - 4);
        outbuf[outpos + 1] = (nlit << 6) + ((bestoffs - 1) >> 8);
        outbuf[outpos + 2] = (bestoffs - 1) & 0xff;
        outpos += 3;
      } else {
        const bo = bestoffs - 1;
        outbuf[outpos] = 0xc0 + ((bo >> 16) << 4) + (((bestlen - 5) >> 8) << 2) + nlit;
        outbuf[outpos + 1] = (bo >> 8) & 0xff;
        outbuf[outpos + 2] = bo & 0xff;
        outbuf[outpos + 3] = (bestlen - 5) & 0xff;
        outpos += 4;
      }
      outbuf.set(inbuf.subarray(lastwrot, lastwrot + nlit), outpos);
      outpos += nlit;
      lastwrot += nlit + bestlen;
    }
  }

  let inpos = inlen;
  while (inpos - lastwrot >= 4) {
    let n = Math.floor((inpos - lastwrot) / 4) - 1;
    if (n > 0x1b) n = 0x1b;
    outbuf[outpos] = 0xe0 + n;
    outpos += 1;
    n = 4 * n + 4;
    outbuf.set(inbuf.subarray(lastwrot, lastwrot + n), outpos);
    lastwrot += n;
    outpos += n;
  }

  const nlit = inpos - lastwrot;
  outbuf[outpos] = 0xfc + nlit;
  outpos += 1;
  outbuf.set(inbuf.subarray(lastwrot, lastwrot + nlit), outpos);
  outpos += nlit;

  return outbuf.slice(0, outpos);
}
