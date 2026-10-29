import { describe, expect, test } from "bun:test";
import { generatePixels, generateSvg, httpUrl, imageMime, PNG_SIZE, type CorrectionLevel } from "../plugins/qrcode/qr";
import { decodeQr } from "../plugins/qrcode/decode";

const contents = ["hello", "你好，AhaTools！", "你好 👋🧑‍💻✨", "第一行\nsecond line\n第三行", "https://example.com/路径?q=二维码&n=1"];
const levels: CorrectionLevel[] = ["L", "M", "Q", "H"];

describe("二维码图像往返", () => {
  for (const text of contents) {
    for (const level of levels) {
      test(`${level} · ${text.split("\n")[0]}`, () => {
        const image = generatePixels(text, level);
        expect([image.width, image.height]).toEqual([1024, 1024]);
        expect(image.rgba.length).toBe(1024 * 1024 * 4);
        const decoded = decodeQr(image);
        expect(decoded?.text).toBe(text);
        expect(decoded?.corners.length).toBe(4);
        for (const point of decoded!.corners) {
          expect(point.x).toBeGreaterThanOrEqual(0);
          expect(point.x).toBeLessThanOrEqual(PNG_SIZE);
          expect(point.y).toBeGreaterThanOrEqual(0);
          expect(point.y).toBeLessThanOrEqual(PNG_SIZE);
        }
      });
    }
  }
});

test("导出仅使用不透明黑白像素，四边保留白边", () => {
  const image = generatePixels("AhaTools", "M");
  for (let i = 0; i < image.rgba.length; i += 4) {
    const r = image.rgba[i];
    expect(r === 0 || r === 255).toBe(true);
    expect(image.rgba[i + 1]).toBe(r);
    expect(image.rgba[i + 2]).toBe(r);
    expect(image.rgba[i + 3]).toBe(255);
  }
  for (let x = 0; x < PNG_SIZE; x++) {
    for (const offset of [x * 4, ((PNG_SIZE - 1) * PNG_SIZE + x) * 4, x * PNG_SIZE * 4, (x * PNG_SIZE + PNG_SIZE - 1) * 4]) {
      expect(Array.from(image.rgba.slice(offset, offset + 4))).toEqual([255, 255, 255, 255]);
    }
  }
});

test("SVG 预览支持特殊字符，过长或空内容不能导出", async () => {
  expect(await generateSvg("<script>alert('二维码')</script>", "M")).toContain("<svg");
  expect(await generateSvg("AhaTools", "M")).not.toContain("AhaTools");
  expect(() => generatePixels("", "M")).toThrow();
  expect(() => generatePixels("测".repeat(10_000), "H")).toThrow();
  await expect(generateSvg("测".repeat(10_000), "H")).rejects.toThrow();
});

test("没有二维码和透明图片返回未识别，损坏的像素返回错误", () => {
  for (const fill of [0, 255]) {
    expect(decodeQr({ width: 200, height: 100, rgba: new Uint8ClampedArray(200 * 100 * 4).fill(fill) })).toBeNull();
  }
  expect(() => decodeQr({ width: 20, height: 10, rgba: new Uint8ClampedArray(1) })).toThrow("图片像素不完整");
});

test("只有有效 HTTP 和 HTTPS 结果提供浏览器动作", () => {
  expect(httpUrl("https://example.com/path?q=1")).toBe("https://example.com/path?q=1");
  expect(httpUrl(" http://localhost:1420/ ")).toBe("http://localhost:1420/");
  for (const text of ["普通文字", "example.com", "javascript:alert(1)", "file:///etc/hosts", "https://", "mailto:a@example.com"]) {
    expect(httpUrl(text)).toBeNull();
  }
});

test("拖图格式忽略扩展名大小写，支持中文及空格路径", () => {
  expect(imageMime("/图片/二维码 测试.PNG")).toBe("image/png");
  expect(imageMime("test.jpg")).toBe("image/jpeg");
  expect(imageMime("test.JPEG")).toBe("image/jpeg");
  expect(imageMime("test.webp")).toBe("image/webp");
  expect(imageMime("test.svg")).toBeNull();
  expect(imageMime("folder")).toBeNull();
});
