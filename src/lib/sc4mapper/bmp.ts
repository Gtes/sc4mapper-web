/**
 * Port of SC4Mapper-2026: region `config.bmp` write (PIL in src/sc4mapper/app.py /
 * src/sc4mapper/region.py). 24-bit Windows BMP, bottom-up BGR.
 */

export function encodeRgbBmp(width: number, height: number, rgb: Uint8Array): Uint8Array {
  const rowStride = ((width * 3 + 3) & ~3);
  const pixelSize = rowStride * height;
  const fileSize = 14 + 40 + pixelSize;
  const out = new Uint8Array(fileSize);
  const v = new DataView(out.buffer);
  out[0] = 0x42;
  out[1] = 0x4d;
  v.setUint32(2, fileSize, true);
  v.setUint32(10, 54, true);
  v.setUint32(14, 40, true);
  v.setInt32(18, width, true);
  v.setInt32(22, height, true);
  v.setUint16(26, 1, true);
  v.setUint16(28, 24, true);
  v.setUint32(34, pixelSize, true);
  for (let y = 0; y < height; y++) {
    const srcY = height - 1 - y;
    const dst = 54 + y * rowStride;
    for (let x = 0; x < width; x++) {
      const s = (srcY * width + x) * 3;
      out[dst + x * 3] = rgb[s + 2];
      out[dst + x * 3 + 1] = rgb[s + 1];
      out[dst + x * 3 + 2] = rgb[s];
    }
  }
  return out;
}
