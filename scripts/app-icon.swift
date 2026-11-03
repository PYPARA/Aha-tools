// 生成应用图标母版（1024×1024 PNG）：衬线 A，见 docs/design/AppIcon.html。
// 用法：swift scripts/app-icon.swift <输出.png>，再 bun run tauri icon <输出.png>。
// 尺寸按 macOS 图标模板：824pt 圆角方形居中，四周留 100pt 给阴影。
import AppKit

let out = CommandLine.arguments.dropFirst().first ?? "app-icon.png"
let size = 1024
let body: CGFloat = 824
let origin = (CGFloat(size) - body) / 2

// 设计稿坐标：168 画布里 156 的方形，偏移 6。换算到母版坐标（y 向下）。
let k = body / 156
func px(_ v: CGFloat) -> CGFloat { origin + (v - 6) * k }

let ctx = CGContext(
  data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
  space: CGColorSpace(name: CGColorSpace.sRGB)!,
  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
// 翻转成 y 向下，和设计稿一致；文字绘制时再局部翻回。
ctx.translateBy(x: 0, y: CGFloat(size))
ctx.scaleBy(x: 1, y: -1)

func rgb(_ hex: UInt32, _ a: CGFloat = 1) -> CGColor {
  CGColor(
    srgbRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
    blue: CGFloat(hex & 0xFF) / 255, alpha: a)
}

// 圆角按 macOS 模板约 22.5%。
let rect = CGRect(x: origin, y: origin, width: body, height: body)
let shape = CGPath(
  roundedRect: rect, cornerWidth: body * 0.225, cornerHeight: body * 0.225, transform: nil)

// 阴影
ctx.saveGState()
ctx.setShadow(offset: CGSize(width: 0, height: 12), blur: 28, color: rgb(0x000000, 0.22))
ctx.addPath(shape)
ctx.setFillColor(rgb(0xFFFFFF))
ctx.fillPath()
ctx.restoreGState()

// 米白渐变底
ctx.saveGState()
ctx.addPath(shape)
ctx.clip()
let gradient = CGGradient(
  colorsSpace: CGColorSpace(name: CGColorSpace.sRGB),
  colors: [rgb(0xFFFFFF), rgb(0xEDEAE2)] as CFArray, locations: [0, 1])!
ctx.drawLinearGradient(
  gradient, start: CGPoint(x: 0, y: rect.minY), end: CGPoint(x: 0, y: rect.maxY), options: [])
ctx.restoreGState()

// 细描边，浅色背景上也能看出边界
ctx.saveGState()
ctx.addPath(shape)
ctx.clip()
ctx.addPath(shape)
ctx.setStrokeColor(rgb(0x28241E, 0.10))
ctx.setLineWidth(4)
ctx.strokePath()
ctx.restoreGState()

// 衬线 A（系统 New York），字号 96、基线 y=118、水平居中于 x=84。
// 光学尺寸固定为 36：大字号默认的展示档横线太细，缩到 16px 会消失。
let base = NSFont.systemFont(ofSize: 96 * k, weight: .medium)
let serif = base.fontDescriptor.withDesign(.serif)!.addingAttributes([
  .variation: [NSNumber(value: 0x6F70_737A): NSNumber(value: 36)]
])
let font = NSFont(descriptor: serif, size: 96 * k)!
let line = CTLineCreateWithAttributedString(
  NSAttributedString(
    string: "A",
    attributes: [.font: font, .foregroundColor: NSColor(cgColor: rgb(0x1D1C1A))!]))
let width = CTLineGetTypographicBounds(line, nil, nil, nil)
ctx.saveGState()
ctx.translateBy(x: px(84) - CGFloat(width) / 2, y: px(118))
ctx.scaleBy(x: 1, y: -1)
ctx.textPosition = .zero
CTLineDraw(line, ctx)
ctx.restoreGState()

// 墨蓝四角火花，中心 (116, 54)
let spark: [(CGFloat, CGFloat)] = [
  (116, 40), (120, 50), (130, 54), (120, 58), (116, 68), (112, 58), (102, 54), (112, 50),
]
ctx.beginPath()
for (i, (x, y)) in spark.enumerated() {
  let pt = CGPoint(x: px(x), y: px(y))
  i == 0 ? ctx.move(to: pt) : ctx.addLine(to: pt)
}
ctx.closePath()
ctx.setFillColor(rgb(0x3A5A8C))
ctx.fillPath()

let image = ctx.makeImage()!
let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])!
try! png.write(to: URL(fileURLWithPath: out))
print("已生成 \(out)")
