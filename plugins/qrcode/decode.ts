import jsQR from "jsqr";
import type { RgbaImage } from "@ahatools/sdk";

export interface ScanResult {
  text: string;
  corners: { x: number; y: number }[];
}
export type ScanRequest = { id: number; image: RgbaImage };
export type ScanResponse = { id: number; result: ScanResult | null; error?: string };

export function decodeQr({ width, height, rgba }: RgbaImage): ScanResult | null {
  if (width < 1 || height < 1 || rgba.length !== width * height * 4) throw new Error("图片像素不完整");
  // Clipboard images may contain transparent pixels with black RGB values underneath.
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] === 255) continue;
    const alpha = rgba[i + 3] / 255;
    for (let c = 0; c < 3; c++) rgba[i + c] = Math.round(rgba[i + c] * alpha + 255 * (1 - alpha));
    rgba[i + 3] = 255;
  }
  const code = jsQR(rgba, width, height, { inversionAttempts: "attemptBoth" });
  if (!code) return null;
  const loc = code.location;
  return {
    text: code.data,
    corners: [loc.topLeftCorner, loc.topRightCorner, loc.bottomRightCorner, loc.bottomLeftCorner],
  };
}
