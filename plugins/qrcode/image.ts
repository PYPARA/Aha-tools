import type { RgbaImage } from "@ahatools/sdk";

export function imageCanvas({ width, height, rgba }: RgbaImage): HTMLCanvasElement {
  if (width < 1 || height < 1 || rgba.length !== width * height * 4) throw new Error("图片像素不完整");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法绘制图片");
  ctx.putImageData(new ImageData(rgba, width, height), 0, 0);
  return canvas;
}

export function imagePng(image: RgbaImage): Promise<Blob> {
  const canvas = imageCanvas(image);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("无法生成 PNG 图片")), "image/png");
  });
}

export async function pixelsFromBlob(blob: Blob): Promise<RgbaImage> {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx || !canvas.width || !canvas.height) throw new Error("无法读取图片像素");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0);
    return { width: canvas.width, height: canvas.height, rgba: ctx.getImageData(0, 0, canvas.width, canvas.height).data };
  } catch {
    throw new Error("无法解码这张图片，请换一张 PNG、JPEG 或 WebP 图片");
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function hasTextSelection(): boolean {
  const el = document.activeElement;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    if (el.selectionStart !== null && el.selectionEnd !== el.selectionStart) return true;
  }
  return Boolean(window.getSelection()?.toString());
}

export function isEditingTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("input, textarea, select, button, [contenteditable='true']"));
}
