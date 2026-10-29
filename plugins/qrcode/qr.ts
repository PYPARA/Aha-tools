import QRCode from "qrcode";
import type { RgbaImage } from "@ahatools/sdk";

export type CorrectionLevel = "L" | "M" | "Q" | "H";
export const PNG_SIZE = 1024;

export const generateSvg = (text: string, level: CorrectionLevel) =>
  QRCode.toString(text, {
    type: "svg", errorCorrectionLevel: level, margin: 1,
    color: { dark: "#000000ff", light: "#ffffffff" },
  });

/** Integer-size modules and a quiet zone survive copying, saving and resampling. */
export function generatePixels(text: string, level: CorrectionLevel): RgbaImage {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: level });
  const scale = Math.floor(PNG_SIZE / (modules.size + 8));
  const offset = Math.floor((PNG_SIZE - modules.size * scale) / 2);
  const rgba = new Uint8ClampedArray(PNG_SIZE * PNG_SIZE * 4).fill(255);
  for (let row = 0; row < modules.size; row++) {
    for (let col = 0; col < modules.size; col++) {
      if (!modules.get(row, col)) continue;
      for (let y = 0; y < scale; y++) {
        let i = ((offset + row * scale + y) * PNG_SIZE + offset + col * scale) * 4;
        for (let x = 0; x < scale; x++, i += 4) rgba[i] = rgba[i + 1] = rgba[i + 2] = 0;
      }
    }
  }
  return { width: PNG_SIZE, height: PNG_SIZE, rgba };
}

export function httpUrl(text: string): string | null {
  try {
    const url = new URL(text.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

export function imageMime(name: string): string | null {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  return null;
}
