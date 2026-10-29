"""Generates the 「后续功能」 design boards for the AhaTools canvas.

Each board shows one screen twice, light and dark, using the v2 tokens from
docs/design-system.md. The canvas itself (claude.ai) is private to the owner, so the static copies next to
this file (docs/design/*.html) are what implementers look at.

Run: python3 gen_boards.py <canvas project dir> [src/assets/icons]
The optional second argument also writes the feature icons (direction A) as SVG files.
"""
import json
import random
import sys
from pathlib import Path

OUT = Path(sys.argv[1])

CSS = """body{margin:0}
.t-light{--desk:#E6E3DA;--bg:#FAF9F6;--surface:#FFFFFF;--sunken:#F3F2EC;--hover:rgba(120,113,100,.08);--selected:rgba(120,113,100,.14);--border:rgba(40,36,30,.11);--border-strong:rgba(40,36,30,.22);--text:#1D1C1A;--text-2:#6B6860;--text-3:#A3A096;--ok:#4C7A3D;--warn:#9A5B13;--bad:#A8402F;--on-accent:#FFFFFF;--menubar:rgba(250,249,246,.82);--shadow:0 18px 50px rgba(30,25,15,.18),0 0 0 1px rgba(40,36,30,.11)}
.t-dark{--desk:#141413;--bg:#262522;--surface:#302F2B;--sunken:#1F1E1C;--hover:rgba(255,250,240,.06);--selected:rgba(255,250,240,.10);--border:rgba(255,250,240,.10);--border-strong:rgba(255,250,240,.20);--text:#EEEDE8;--text-2:#A9A69C;--text-3:#76736B;--ok:#8FC27A;--warn:#E3A85A;--bad:#F08B78;--on-accent:#16202F;--menubar:rgba(38,37,34,.86);--shadow:0 18px 50px rgba(0,0,0,.5),0 0 0 1px rgba(255,250,240,.10)}
.t-light,.t-dark{--sans:-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC",sans-serif;--serif:ui-serif,"New York","Songti SC",Georgia,serif;--mono:ui-monospace,"SF Mono",Menlo,monospace;--accent-soft:color-mix(in srgb,var(--accent) 12%,transparent);font-family:var(--sans);color:var(--text)}
input::placeholder,textarea::placeholder{color:var(--text-3)}
.win{border-radius:14px;background:var(--bg);box-shadow:var(--shadow);display:flex;flex-direction:column;overflow:hidden;font-size:13px;flex-shrink:0}
.head{height:64px;flex-shrink:0;display:flex;align-items:center;gap:12px;padding:0 20px;border-bottom:1px solid var(--border)}
.ib{width:30px;height:30px;border-radius:8px;border:none;background:transparent;color:var(--text-2);display:flex;align-items:center;justify-content:center;flex-shrink:0;padding:0}
.tile{width:30px;height:30px;box-sizing:border-box;border-radius:8px;background:var(--sunken);border:1px solid var(--border);color:var(--text-2);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:12px}
.tile.xl{width:44px;height:44px;border-radius:11px}
.tile.sm{width:26px;height:26px;border-radius:7px;font-size:11px}
.ttl{flex:1;display:flex;flex-direction:column;gap:1px}.ttl b{font-family:var(--serif);font-size:19px;font-weight:500;line-height:1.2}.ttl span{font-size:11px;color:var(--text-2)}
.body{flex:1;min-height:0;display:flex;gap:20px;padding:20px 28px}
.col{display:flex;flex-direction:column;gap:12px;min-width:0}
.foot{height:34px;flex-shrink:0;display:flex;align-items:center;justify-content:space-between;padding:0 24px;border-top:1px solid var(--border);font-size:11px;color:var(--text-2)}
.btn{height:30px;padding:0 12px;border-radius:6px;border:1px solid var(--border-strong);background:var(--surface);font-family:inherit;font-size:13px;color:var(--text);display:inline-flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap;flex-shrink:0}
.btn.p{border:none;background:var(--accent);color:var(--on-accent);font-weight:500}
.btn.g{border:none;background:transparent;color:var(--text-2)}
.btn.a{border:none;background:transparent;color:var(--accent)}
.btn.sm{height:26px;padding:0 10px;font-size:12px}
.inp{height:30px;box-sizing:border-box;padding:0 10px;border-radius:6px;border:1px solid var(--border-strong);background:var(--surface);font-family:inherit;font-size:13px;color:var(--text);outline:none;min-width:0}
.ta{box-sizing:border-box;padding:12px 14px;border-radius:10px;border:1px solid var(--border);background:var(--surface);font-family:inherit;font-size:14px;line-height:1.65;color:var(--text);outline:none;resize:none;margin:0}
.note{font-size:12px;color:var(--text-2);line-height:1.5;margin:0}
.lbl{font-size:12px;font-weight:600;color:var(--text-2)}
.row{display:flex;align-items:center;gap:10px}
.sp{flex:1}
.seg{display:inline-flex;padding:3px;border-radius:8px;background:var(--sunken);gap:2px;flex-shrink:0}.seg span{height:24px;padding:0 12px;border-radius:6px;display:flex;align-items:center;font-size:12px;color:var(--text-2)}.seg span.on{background:var(--surface);box-shadow:0 1px 2px rgba(0,0,0,.08);color:var(--text);font-weight:500}
.dot{width:7px;height:7px;border-radius:4px;display:inline-block;flex-shrink:0}
.sw{width:36px;height:22px;box-sizing:border-box;padding:2px;border-radius:11px;background:var(--border-strong);display:flex;flex-shrink:0}.sw.on{background:var(--accent);justify-content:flex-end}.sw i{width:18px;height:18px;border-radius:9px;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.18)}
.sw.sm{width:30px;height:18px}.sw.sm i{width:14px;height:14px}
.card{border-radius:10px;border:1px solid var(--border);background:var(--surface)}
.mono{font-family:var(--mono)}
.chip{height:22px;display:inline-flex;align-items:center;padding:0 9px;border-radius:999px;background:var(--sunken);border:1px solid var(--border);font-size:11px;color:var(--text-2)}
.strip{display:flex;align-items:center;gap:10px;min-height:40px;padding:0 8px 0 14px;border-radius:10px;background:var(--sunken)}
.sel{height:30px;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:space-between;gap:10px;padding:0 10px 0 12px;border-radius:6px;border:1px solid var(--border-strong);background:var(--surface);font-size:13px;flex-shrink:0}
.side{width:208px;flex-shrink:0;background:var(--sunken);border-right:1px solid var(--border);padding:14px 10px;display:flex;flex-direction:column;gap:2px;box-sizing:border-box}
.side .h{display:flex;align-items:center;gap:8px;padding:2px 6px 14px}.side .h b{font-family:var(--serif);font-size:18px;font-weight:500}
.side .g{padding:14px 10px 6px;font-size:11px;color:var(--text-2)}
.side .i{display:flex;align-items:center;height:34px;padding:0 10px 0 36px;border-radius:8px;font-size:13px}
.side .i.on,.plist .i.on{background:var(--selected);font-weight:500}
.plist{width:184px;flex-shrink:0;padding:14px 8px;border-right:1px solid var(--border);display:flex;flex-direction:column;gap:2px;box-sizing:border-box}
.plist .i{display:flex;align-items:center;gap:10px;height:40px;padding:0 8px;border-radius:8px}
.plist .g{padding:10px 8px 4px;font-size:11px;color:var(--text-2)}
.detail{flex:1;min-width:0;display:flex;flex-direction:column;gap:16px;padding:28px 30px;overflow:hidden}
.dh{display:flex;align-items:center;gap:14px}.dh b{font-family:var(--serif);font-size:22px;font-weight:500;line-height:1.2;display:block}
.srow{display:flex;align-items:center;gap:20px;min-height:58px;border-bottom:1px solid var(--border)}
.srow:last-child{border-bottom:none}
.st{flex:1;display:flex;flex-direction:column;gap:3px}.st b{font-size:14px;font-weight:500}.st span{font-size:12px;color:var(--text-2);line-height:1.45}
.bar{display:block;height:6px;border-radius:3px;background:var(--sunken);overflow:hidden}.bar i{display:block;height:100%;border-radius:3px;background:var(--accent)}
table{border-collapse:collapse;width:100%}
th{text-align:left;padding:0 10px 8px;font-size:12px;font-weight:500;color:var(--text-2)}
td{height:46px;padding:0 10px;border-top:1px solid var(--border)}
"""

ICONS = {
    "back": '<path d="M15 18l-6-6 6-6"></path>',
    "qr": '<rect x="4" y="4" width="6" height="6" rx="1"></rect><rect x="14" y="4" width="6" height="6" rx="1"></rect><rect x="4" y="14" width="6" height="6" rx="1"></rect><path d="M14 14h2v2M20 14v6h-6M17 17h.01"></path>',
    "scan": '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16"></path>',
    "tr": '<path d="M4 6h9M8.5 4v2c0 4-2 7-4.5 8.5M6 10c1.5 2 3.5 3.5 6 4.5"></path><path d="M13 20l4-9 4 9M14.5 17h5"></path>',
    "globe": '<circle cx="12" cy="12" r="8.5"></circle><path d="M3.5 12h17M12 3.5c2.5 2.5 3.5 5.5 3.5 8.5s-1 6-3.5 8.5c-2.5-2.5-3.5-5.5-3.5-8.5s1-6 3.5-8.5z"></path>',
    "zip": '<rect x="4" y="4" width="16" height="16" rx="3"></rect><path d="M9 9l6 6M15 10v5h-5"></path>',
    "swap": '<path d="M7 7h12l-3-3M17 17H5l3 3"></path>',
    "copy": '<rect x="8" y="8" width="12" height="12" rx="2"></rect><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"></path>',
    "plus": '<path d="M12 5v14M5 12h14"></path>',
    "down": '<path d="M6 9l6 6 6-6"></path>',
    "folder": '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"></path>',
    "puzzle": '<path d="M10 4a2 2 0 1 1 4 0v2h4v4h-2a2 2 0 1 0 0 4h2v4h-4v-2a2 2 0 1 0-4 0v2H6v-4H4a2 2 0 1 1 0-4h2V6h4z"></path>',
    "lock": '<rect x="5" y="11" width="14" height="9" rx="2"></rect><path d="M8 11V8a4 4 0 0 1 8 0v3"></path>',
    "img": '<rect x="4" y="5" width="16" height="14" rx="2"></rect><circle cx="9" cy="10" r="1.5"></circle><path d="M20 16l-5-5-8 8"></path>',
    "check": '<path d="M5 12l5 5 9-10"></path>',
    "x": '<path d="M6 6l12 12M18 6L6 18"></path>',
    "chev": '<path d="M9 6l6 6-6 6"></path>',
    "cpu": '<rect x="7" y="7" width="10" height="10" rx="1.5"></rect><path d="M10 3v3M14 3v3M10 18v3M14 18v3M3 10h3M3 14h3M18 10h3M18 14h3"></path>',
    "speaker": '<path d="M5 10v4h3l4 3V7L8 10zM16 9a4 4 0 0 1 0 6"></path>',
}


def icon(name, size=16, sw=1.6):
    return (f'<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
            f'stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{ICONS[name]}</svg>')


def page(w, h, plugin_icon, title, sub, actions, body, foot_left, foot_right):
    """An 880×580-style plugin page: header, body, footer."""
    return f'''<section class="win" style="width: {w}px; height: {h}px">
<header class="head">
<button type="button" class="ib" aria-label="返回搜索">{icon("back", 18)}</button>
<span class="tile" aria-hidden="true">{icon(plugin_icon)}</span>
<span class="ttl"><b>{title}</b><span>{sub}</span></span>
{actions}
</header>
{body}
<footer class="foot"><span>{foot_left}</span><span>{foot_right}</span></footer>
</section>'''


def settings(plist, detail, nav_on="已安装插件"):
    nav = ""
    for kind, label in [("i", "通用"), ("i", "全局热键"), ("g", "插件"), ("i", "已安装插件"), ("i", "所有指令"), ("g", "其他"), ("i", "关于 AhaTools")]:
        on = " on" if label == nav_on else ""
        nav += f'<span class="{kind}{on}">{label}</span>\n'
    return f'''<section class="win" style="width: 880px; height: 580px; flex-direction: row">
<nav class="side" aria-label="设置分类">
<span class="h"><button type="button" class="ib" style="width: 28px; height: 28px" aria-label="返回搜索">{icon("back")}</button><b>设置</b></span>
{nav}</nav>
{plist}
{detail}
</section>'''


def plist(items, on):
    out = '<div class="plist" aria-label="已安装插件">\n'
    for it in items:
        if it.startswith("#"):
            out += f'<span class="g">{it[1:]}</span>\n'
            continue
        name, mark = it.split("|")
        cls = " on" if name == on else ""
        out += f'<span class="i{cls}"><span class="tile sm" aria-hidden="true">{mark}</span>{name}</span>\n'
    return out + "</div>"


def board(name, title, w, h, inner, preview_w=None, page_id="next"):
    pw = preview_w or (w + 80) * 2
    html = f'''<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>{title}</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<style>
{CSS}</style>
</helmet>
<div style="width: {pw}px; height: {h + 108}px; display: flex">
<sc-for list="{{{{themes}}}}" as="t" hint-placeholder-count="2">
<div class="{{{{t.cls}}}}" style="width: {pw // 2}px; height: {h + 108}px; box-sizing: border-box; padding: 40px; background: var(--desk); display: flex; flex-direction: column; gap: 12px; {{{{t.vars}}}}">
<div style="font-size: 12px; color: var(--text-2)">{{{{t.label}}}}</div>
{inner}
</div>
</sc-for>
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{{"accent":{{"editor":"enum","options":["墨蓝","苔绿","梅紫","赭石"],"default":"墨蓝"}},"$preview":{{"width":{pw},"height":{h + 108}}}}}'>
class Component extends DCLogic {{
renderVals() {{
const A = {{ '墨蓝': ['#3A5A8C', '#93B1E3'], '苔绿': ['#4D7358', '#9CC4A6'], '梅紫': ['#7A4E78', '#CFA2CC'], '赭石': ['#9A6326', '#DDAA6A'] }};
const pair = A[this.props.accent ?? '墨蓝'] ?? A['墨蓝'];
return {{
themes: [
{{ cls: 't-light', label: '浅色', vars: `--accent:${{pair[0]}}` }},
{{ cls: 't-dark', label: '深色', vars: `--accent:${{pair[1]}}` }}
]
}};
}}
}}
</script>
</body>
</html>
'''
    (OUT / f"{name}.dc.html").write_text(html)
    return {"file": f"{name}.dc.html", "title": title, "w": pw, "h": h + 108, "page": page_id}


def qr_path(n=25, seed=7):
    """A plausible QR code: finder patterns plus seeded noise, as one SVG path."""
    rnd = random.Random(seed)
    cells = [[rnd.random() < 0.48 for _ in range(n)] for _ in range(n)]

    def finder(x0, y0):
        for y in range(-1, 8):
            for x in range(-1, 8):
                xx, yy = x0 + x, y0 + y
                if 0 <= xx < n and 0 <= yy < n:
                    ring = max(abs(x - 3), abs(y - 3))
                    cells[yy][xx] = ring in (0, 1, 3) if 0 <= x <= 6 and 0 <= y <= 6 else False

    for x0, y0 in [(0, 0), (n - 7, 0), (0, n - 7)]:
        finder(x0, y0)
    for i in range(8, n - 8):
        cells[6][i] = cells[i][6] = i % 2 == 0
    return "".join(f"M{x} {y}h1v1h-1z" for y in range(n) for x in range(n) if cells[y][x])


boards = []
QR = qr_path()

# ---- 二维码 · 生成 ----
body = f'''<div class="body">
<div class="col" style="flex: 1">
<span class="lbl">内容</span>
<textarea class="ta" style="flex: 1">https://github.com/ZToolsCenter/ZTools</textarea>
<span class="row"><span class="note">38 个字符 · 从搜索框带入</span><span class="sp"></span><span class="note">容错</span><span class="seg"><span>低</span><span class="on">中</span><span>较高</span><span>高</span></span></span>
</div>
<div class="col" style="width: 300px; align-items: center">
<span class="lbl" style="align-self: flex-start">预览</span>
<div class="card" style="width: 300px; height: 300px; box-sizing: border-box; padding: 26px; display: flex; align-items: center; justify-content: center; background: #FFFFFF">
<svg width="248" height="248" viewBox="-1 -1 27 27" shape-rendering="crispEdges" role="img" aria-label="二维码"><path d="{QR}" fill="#1D1C1A"></path></svg>
</div>
<span class="row" style="width: 300px"><button type="button" class="btn p" style="flex: 1">{icon("copy", 15)}复制图片</button><button type="button" class="btn" style="flex: 1">保存 PNG…</button></span>
<span class="note">二维码始终是白底黑码，深色模式下也方便扫描</span>
</div>
</div>'''
boards.append(board("QrGenerate", "二维码 · 生成", 880, 580, page(880, 580, "qr", "生成二维码", "二维码", '<button type="button" class="btn">识别剪贴板里的二维码</button>', body, "esc 返回搜索 · ⌘C 复制图片", "边输入边更新")))

# ---- 二维码 · 识别 ----
body = f'''<div class="body">
<div class="col" style="width: 330px">
<span class="lbl">剪贴板里的图片</span>
<div class="card" style="height: 330px; display: flex; align-items: center; justify-content: center; background: var(--sunken); overflow: hidden; position: relative">
<div style="width: 250px; height: 280px; border-radius: 12px; background: #FFFFFF; box-shadow: 0 6px 20px rgba(0,0,0,.12); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px">
<svg width="150" height="150" viewBox="-1 -1 27 27" shape-rendering="crispEdges" aria-hidden="true"><path d="{qr_path(seed=21)}" fill="#1D1C1A"></path></svg>
<span style="font-size: 12px; color: #6B6860">扫码加入「周末徒步群」</span>
</div>
<span style="position: absolute; inset: 52px 82px 118px 82px; border: 2px solid var(--accent); border-radius: 6px"></span>
</div>
<span class="note">也可以把图片拖进来</span>
</div>
<div class="col" style="flex: 1">
<span class="row"><span class="dot" style="background: var(--ok)"></span><span style="font-weight: 500">识别到 1 个二维码</span></span>
<div class="ta mono" style="font-size: 13px; word-break: break-all">https://weixin.qq.com/g/AQYAAKx-xxQ8Rv1_y3mNcY0pXbVe2k</div>
<span class="row"><button type="button" class="btn p">在浏览器中打开</button><button type="button" class="btn">{icon("copy", 15)}复制文字</button><span class="sp"></span><button type="button" class="btn g">生成同样的二维码</button></span>
<div class="strip" style="margin-top: 8px"><span class="dot" style="background: var(--text-3)"></span><span class="note" style="flex: 1">剪贴板里没有图片时，这里会提示「先截图或复制一张图片」，并可以直接拖入图片</span></div>
</div>
</div>'''
boards.append(board("QrScan", "二维码 · 识别", 880, 580, page(880, 580, "scan", "识别二维码", "二维码", '<button type="button" class="btn">重新读取剪贴板</button>', body, "esc 返回搜索 · ↵ 打开链接", "读自剪贴板 · 刚刚")))

# ---- 翻译 · 段落 ----
src = "Tauri lets you build smaller, faster, and more secure desktop applications with a web frontend. The core is written in Rust, and the UI runs in the system's own webview, so apps stay light."
dst = "Tauri 让你用网页前端构建更小、更快、更安全的桌面应用。核心用 Rust 编写，界面运行在系统自带的网页视图里，所以应用保持轻量。"
body = f'''<div class="body" style="flex-direction: column; gap: 12px">
<span class="row"><span class="sel" style="min-width: 110px">自动检测 · 英文{icon("down", 12, 2)}</span><button type="button" class="ib" aria-label="交换方向">{icon("swap")}</button><span class="sel" style="min-width: 110px">中文{icon("down", 12, 2)}</span><span class="sp"></span><span class="seg"><span class="on">翻译</span><span>润色</span><span>解释</span></span></span>
<div style="flex: 1; min-height: 0; display: flex; gap: 14px">
<div class="ta" style="flex: 1">{src}</div>
<div class="ta" style="flex: 1; background: var(--sunken); border-color: transparent">{dst}<span style="display: inline-block; width: 2px; height: 16px; margin-left: 2px; vertical-align: -2px; background: var(--accent)"></span></div>
</div>
<span class="row"><span class="note">186 个字符</span><span class="sp"></span><span class="chip">deepseek-chat · 正在输出</span><button type="button" class="btn sm g">停止</button><button type="button" class="btn sm">{icon("copy", 14)}复制译文</button></span>
</div>'''
boards.append(board("TranslateText", "翻译 · 段落", 880, 580, page(880, 580, "tr", "翻译", "翻译 · 大模型", '<span class="note">⌘↵ 重新翻译</span>', body, "esc 返回搜索 · ⌘C 复制译文", "粘贴或输入就开始翻译")))

# ---- 翻译 · 单词 ----
body = f'''<div class="body" style="flex-direction: column; gap: 14px">
<div class="row" style="gap: 14px; align-items: baseline">
<span style="font-family: var(--serif); font-size: 32px; font-weight: 500">serendipity</span>
<span class="mono note" style="font-size: 13px">/ˌserənˈdɪpəti/</span>
<button type="button" class="ib" aria-label="朗读">{icon("speaker")}</button>
<span class="sp"></span><span class="chip">名词</span>
</div>
<div class="card" style="padding: 16px 18px; display: flex; flex-direction: column; gap: 10px">
<span style="font-size: 16px; font-weight: 500">意外发现美好事物的运气；机缘巧合</span>
<span class="note" style="font-size: 13px">指在没有刻意寻找时，偶然发现有价值或令人愉快的东西。</span>
</div>
<span class="lbl">例句</span>
<div class="col" style="gap: 10px">
<div style="display: flex; flex-direction: column; gap: 3px"><span style="font-size: 14px">Finding that café was pure <b style="font-weight: 600">serendipity</b>.</span><span class="note">找到那家咖啡馆纯属机缘巧合。</span></div>
<div style="display: flex; flex-direction: column; gap: 3px"><span style="font-size: 14px">Many discoveries in science came about by <b style="font-weight: 600">serendipity</b>.</span><span class="note">科学上的许多发现都源于偶然。</span></div>
</div>
<span class="sp"></span>
<span class="row"><span class="note">近义：chance · fortune · luck</span><span class="sp"></span><button type="button" class="btn sm">{icon("copy", 14)}复制释义</button></span>
</div>'''
boards.append(board("TranslateWord", "翻译 · 单词释义", 880, 580, page(880, 580, "tr", "翻译", "翻译 · 只输入一个单词时", f'<span class="sel">英 → 中{icon("down", 12, 2)}</span>', body, "esc 返回搜索", "单词给出音标、释义和例句")))

# ---- 翻译 · 插件设置 ----
PL = ["截图|截", "二维码|码", "翻译|译", "hosts 切换|H", "图片压缩|压", "网页应用|网", "快捷启动|启", "热键检测|键"]
detail = f'''<div class="detail">
<div class="dh"><span class="tile xl">{icon("tr", 22)}</span><span><b>翻译</b><span class="note">用大模型翻译文字，单词附带释义 · 内置 0.1.0</span></span></div>
<div class="seg" style="align-self: flex-start"><span>关键词</span><span>自动匹配</span><span class="on">设置</span></div>
<div>
<div class="srow"><span class="st"><b>服务</b><span>兼容 OpenAI 接口的服务都可以</span></span><span class="sel" style="width: 200px">DeepSeek{icon("down", 12, 2)}</span></div>
<div class="srow"><span class="st"><b>接口地址</b><span>选「自定义」时可改</span></span><input class="inp mono" style="width: 260px; font-size: 12px" value="https://api.deepseek.com/v1"></div>
<div class="srow"><span class="st"><b>模型</b></span><input class="inp mono" style="width: 260px; font-size: 12px" value="deepseek-chat"></div>
<div class="srow"><span class="st"><b>API Key</b><span>{icon("lock", 12)} 存在系统钥匙串里，不写进配置文件</span></span><input class="inp mono" style="width: 200px; font-size: 12px" value="sk-••••••••••••3f9a"><button type="button" class="btn sm g">更换</button></div>
<div class="srow"><span class="st"><b>默认方向</b><span>中文翻成英文，其他语言翻成中文</span></span><span class="sel" style="width: 200px">自动{icon("down", 12, 2)}</span></div>
</div>
<span class="row"><button type="button" class="btn">测试连接</button><span class="dot" style="background: var(--ok)"></span><span class="note">连接正常 · 首字 420 ms</span></span>
</div>'''
boards.append(board("TranslateSettings", "插件详情 · 翻译设置", 880, 580, settings(plist(PL, "翻译"), detail)))

# ---- hosts 切换 ----
schemes = [("系统原始", "只读 · 备份于首次应用前", None, True), ("开发环境", "6 条", True, False), ("测试环境", "4 条", False, False), ("屏蔽广告", "212 条", False, False)]
items = ""
for name, meta, on, locked in schemes:
    sel = ' style="background: var(--selected)"' if name == "开发环境" else ""
    ctrl = f'<span style="color: var(--text-3)">{icon("lock", 14)}</span>' if locked else f'<span class="sw sm{" on" if on else ""}"><i></i></span>'
    items += f'<div class="row" style="height: 50px; padding: 0 10px; border-radius: 8px"{sel}><span class="st" style="gap: 1px"><b style="font-size: 13px">{name}</b><span style="font-size: 11px">{meta}</span></span>{ctrl}</div>\n'
hosts = """# 开发环境
127.0.0.1   api.local.test
127.0.0.1   web.local.test
192.168.1.20  gitlab.company.lan
192.168.1.21  nexus.company.lan
# 临时：联调
10.0.3.15   pay-sandbox.company.lan"""
body = f'''<div style="flex: 1; min-height: 0; display: flex">
<div style="width: 220px; flex-shrink: 0; border-right: 1px solid var(--border); padding: 14px 10px; display: flex; flex-direction: column; gap: 2px; box-sizing: border-box">
{items}<button type="button" class="btn g" style="justify-content: flex-start; margin-top: 6px">{icon("plus", 14)}新建方案</button>
</div>
<div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 12px; padding: 16px 22px">
<span class="row"><input class="inp" style="width: 180px; font-weight: 500" value="开发环境"><span class="dot" style="background: var(--warn)"></span><span class="note">有改动未应用</span><span class="sp"></span><button type="button" class="btn g sm">复制</button><button type="button" class="btn g sm" style="color: var(--bad)">删除</button></span>
<pre class="ta mono" style="flex: 1; font-size: 12.5px; line-height: 1.75; white-space: pre; overflow: hidden">{hosts}</pre>
<span class="row"><span class="note">每行「IP 空格 域名」，# 开头是注释</span><span class="sp"></span><button type="button" class="btn">查看当前生效内容</button><button type="button" class="btn p">应用</button></span>
</div>
</div>'''
boards.append(board("Hosts", "hosts 切换", 880, 580, page(880, 580, "globe", "hosts 切换", "hosts", '<span class="row"><span class="dot" style="background: var(--ok)"></span><span class="note">已生效：开发环境 · 10:42</span></span>', body, "esc 返回搜索 · ⌘S 应用", "应用时系统会要一次管理员密码")))

# ---- 图片压缩 ----
files = [("banner-home.png", "2.4 MB", "612 KB", "75%", "done"), ("avatar@2x.png", "386 KB", "98 KB", "75%", "done"), ("photo-0921.jpg", "5.8 MB", "1.9 MB", "67%", "done"), ("screenshot-hero.png", "3.1 MB", "", "", "run"), ("icon.svg", "", "", "", "skip"), ("diagram.webp", "880 KB", "", "", "wait")]
rows = ""
for name, a, b, save, st in files:
    if st == "done":
        status = f'<span class="row" style="gap: 6px; color: var(--ok)">{icon("check", 14, 2)}节省 {save}</span>'
    elif st == "run":
        status = '<span class="bar" style="width: 110px"><i style="width: 46%"></i></span>'
    elif st == "skip":
        status = '<span class="note">不支持 SVG，已跳过</span>'
    else:
        status = '<span class="note">等待中</span>'
    copy = f'<button type="button" class="ib" style="width: 26px; height: 26px" aria-label="复制这张">{icon("copy", 14)}</button>' if st == "done" else ""
    rows += f'<tr><td><span class="row"><span class="tile sm">{icon("img", 13)}</span>{name}</span></td><td class="note">{a or "—"}</td><td>{b or "—"}</td><td>{status}</td><td>{copy}</td></tr>\n'
body = f'''<div class="body" style="flex-direction: column; gap: 12px">
<span class="row" style="gap: 14px"><span class="seg"><span>2 分钟前 · 13 张</span><span class="on">刚刚 · 6 张</span></span><span class="sp"></span><span class="note">质量</span><span style="position: relative; width: 140px; height: 4px; border-radius: 2px; background: var(--border-strong)"><span style="position: absolute; left: 0; top: 0; bottom: 0; width: 80%; border-radius: 2px; background: var(--accent)"></span><span style="position: absolute; left: calc(80% - 8px); top: -6px; width: 16px; height: 16px; border-radius: 8px; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.25)"></span></span><span class="mono note">80</span><span class="row" style="gap: 6px"><span class="note">转 WebP</span><span class="sw sm"><i></i></span></span></span>
<table><thead><tr><th>文件</th><th style="width: 90px">原大小</th><th style="width: 90px">压缩后</th><th style="width: 140px">结果</th><th style="width: 40px"></th></tr></thead><tbody>
{rows}</tbody></table>
<div style="height: 46px; border-radius: 10px; border: 1.5px dashed var(--border-strong); display: flex; align-items: center; justify-content: center; gap: 8px" class="note">继续拖入图片或文件夹，或 <button type="button" class="btn a sm" style="padding: 0">选择文件…</button></div>
</div>'''
boards.append(board("Compress", "图片压缩", 880, 580, page(880, 580, "zip", "图片压缩", "图片压缩 · 结果先放在临时目录，原图不动", f'<button type="button" class="btn">覆盖原图</button><button type="button" class="btn">另存到原目录</button><button type="button" class="btn p">{icon("copy", 15)}复制所有 ⌘C</button>', body, "完成 4/6 · 失败 0 · 跳过 1", "共节省 7.9 MB（73%）")))

# ---- 菜单栏 · 系统监控 ----
def spark(seed, top):
    rnd = random.Random(seed)
    pts = " ".join(f"L{x} {top + rnd.randint(-8, 8)}" for x in range(0, 269, 22))
    return pts


pop = f'''<div class="win" role="dialog" aria-label="AhaTools 菜单" style="width: 300px; border-radius: 12px; padding: 14px 12px 8px; gap: 14px; box-sizing: border-box">
<div class="row" style="padding: 0 4px; align-items: baseline"><span class="lbl">网速</span><span class="sp"></span><span class="note" style="font-size: 11px">Wi‑Fi · en0</span></div>
<div class="row" style="padding: 0 4px; gap: 18px"><span style="font-size: 18px; font-weight: 500">↓ 3.4<span class="note"> MB/s</span></span><span style="font-size: 18px; font-weight: 500">↑ 120<span class="note"> KB/s</span></span></div>
<div style="height: 1px; background: var(--border); margin: 0 -12px"></div>
<div class="col" style="gap: 12px; padding: 0 4px">
<div class="col" style="gap: 6px"><span class="row"><span class="lbl" style="width: 40px">CPU</span><span style="font-weight: 500">23%</span><span class="sp"></span><span class="note" style="font-size: 11px">最忙：Cursor 11%</span></span>
<svg width="268" height="28" viewBox="0 0 268 28" fill="none" aria-hidden="true"><path d="M0 20 {spark(3, 18)} L268 28 L0 28Z" fill="var(--accent)" opacity=".10"></path><path d="M0 20 {spark(3, 18)}" stroke="var(--accent)" stroke-width="1.5" stroke-linejoin="round"></path></svg></div>
<div class="col" style="gap: 6px"><span class="row"><span class="lbl" style="width: 40px">内存</span><span style="font-weight: 500">11.2</span><span class="note">/ 16 GB</span><span class="sp"></span><span class="note" style="font-size: 11px">压力正常</span></span><span class="bar"><i style="width: 70%"></i></span></div>
<div class="col" style="gap: 6px"><span class="row"><span class="lbl" style="width: 40px">电池</span><span style="font-weight: 500">86%</span><span class="sp"></span><span class="note" style="font-size: 11px">充电中 · 约 25 分钟充满</span></span><span class="bar"><i style="width: 86%; background: var(--ok)"></i></span></div>
<div class="row"><span class="lbl" style="width: 40px">磁盘</span><span style="font-weight: 500">212 GB</span><span class="note">可用 / 494 GB</span></div>
</div>
<div style="height: 1px; background: var(--border); margin: 0 -12px"></div>
<div class="col" style="gap: 1px">
<span class="row" style="height: 30px; padding: 0 8px">打开搜索面板<span class="sp"></span><span class="mono" style="font-size: 11px; color: var(--text-3)">⌥ Space</span></span>
<span class="row" style="height: 30px; padding: 0 8px">截图工具<span class="sp"></span><span class="note">QQ</span>{icon("chev", 12, 2)}</span>
<span class="row" style="height: 30px; padding: 0 8px; border-radius: 6px; background: var(--hover)">设置…<span class="sp"></span><span class="mono" style="font-size: 11px; color: var(--text-3)">⌘ ,</span></span>
</div>
</div>'''
side = f'''<div class="col" style="gap: 16px; width: 360px">
<span class="lbl">菜单栏显示</span>
<div class="row" style="height: 40px; padding: 0 14px; border-radius: 10px; background: var(--menubar); box-shadow: 0 0 0 1px var(--border); justify-content: flex-end; gap: 16px; font-size: 12px; font-weight: 500">
<span class="row" style="gap: 6px"><span class="mono" style="font-size: 10px; line-height: 11px; display: flex; flex-direction: column; align-items: flex-end"><span>120 KB/s</span><span>3.4 MB/s</span></span></span>
<span class="row" style="gap: 4px">{icon("cpu", 14)}23%</span>
<span>10月29日 周三 11:20</span>
</div>
<p class="note">设置 → 通用 → 菜单栏显示：网速（默认）、CPU、内存可以多选，按选中的顺序并排。都不选时只显示 AhaTools 标志。</p>
<div class="card" style="padding: 4px 16px">
<div class="srow" style="min-height: 52px"><span class="st"><b style="font-size: 13px">网速</b></span><span class="sw on"><i></i></span></div>
<div class="srow" style="min-height: 52px"><span class="st"><b style="font-size: 13px">CPU</b></span><span class="sw on"><i></i></span></div>
<div class="srow" style="min-height: 52px"><span class="st"><b style="font-size: 13px">内存</b></span><span class="sw"><i></i></span></div>
</div>
<p class="note">弹出面板里的 CPU、内存、电池、磁盘一直显示，只在面板打开时每秒采样，不常驻耗电。</p>
</div>'''
boards.append(board("SystemMonitor", "菜单栏 · 系统监控", 760, 640, f'<div class="row" style="align-items: flex-start; gap: 40px">{pop}{side}</div>'))

# ---- 外部插件 ----
PLX = ["#内置", "截图|截", "二维码|码", "翻译|译", "网页应用|网", "#外部", "JSON 格式化|J", "时间戳|T"]
detail = f'''<div class="detail">
<div class="dh"><span class="tile xl" style="font-size: 18px">J</span><span><b>JSON 格式化</b><span class="note">格式化、压缩、校验 JSON · 外部插件 0.3.1 · 作者 0x10</span></span><span class="sp"></span><span class="row"><span class="note">启用</span><span class="sw on"><i></i></span></span></div>
<div class="seg" style="align-self: flex-start"><span class="on">关键词</span><span>自动匹配</span></div>
<p class="note" style="margin-top: -4px">在搜索框里输入这些词，就能找到对应的功能。</p>
<div style="display: flex; flex-direction: column; gap: 10px; padding-bottom: 16px; border-bottom: 1px solid var(--border)"><span class="row"><b style="font-size: 14px; font-weight: 500">格式化 JSON</b><span class="sp"></span><button type="button" class="btn sm a">设为热键</button></span><span class="row" style="gap: 6px"><span class="chip">json</span><span class="chip">格式化</span><span class="chip">jq</span></span></div>
<div class="card" style="padding: 12px 14px; display: flex; flex-direction: column; gap: 8px">
<span class="row"><span class="lbl">位置</span><span class="mono note" style="flex: 1">~/Library/Application Support/com.ahatools.app/plugins/json-format</span></span>
<span class="row"><span class="lbl">权限</span><span class="note" style="flex: 1">读写剪贴板 · 不联网</span></span>
</div>
<span class="row"><button type="button" class="btn">在访达中显示</button><button type="button" class="btn">重新载入</button><span class="sp"></span><button type="button" class="btn g" style="color: var(--bad)">移除</button></span>
</div>'''
plist_html = plist(PLX, "JSON 格式化").replace("</div>", f'<span class="sp"></span><button type="button" class="btn g sm" style="justify-content: flex-start">{icon("folder", 14)}打开插件目录</button></div>')
boards.append(board("ExternalPlugins", "插件详情 · 外部插件", 880, 580, settings(plist_html, detail)))

# ---- 应用图标 ----
def squircle(content, bg):
    return f'''<svg width="168" height="168" viewBox="0 0 168 168" aria-hidden="true"><defs><linearGradient id="g{abs(hash(bg)) % 9999}" x1="0" y1="0" x2="0" y2="1">{bg}</linearGradient></defs>
<rect x="6" y="6" width="156" height="156" rx="36" fill="url(#g{abs(hash(bg)) % 9999})"></rect>{content}</svg>'''


tiles = '<rect x="46" y="46" width="32" height="32" rx="8" fill="none" stroke="#FAF9F6" stroke-width="7"></rect><rect x="90" y="46" width="32" height="32" rx="8" fill="none" stroke="#FAF9F6" stroke-width="7"></rect><rect x="46" y="90" width="32" height="32" rx="8" fill="none" stroke="#FAF9F6" stroke-width="7"></rect><rect x="90" y="90" width="32" height="32" rx="8" fill="#E8B465"></rect>'
serif_a = '<text x="84" y="118" text-anchor="middle" font-family="ui-serif, New York, Georgia, serif" font-size="96" font-weight="500" fill="#1D1C1A">A</text><path d="M116 40l4 10 10 4-10 4-4 10-4-10-10-4 10-4z" fill="#3A5A8C"></path>'
spark = '<circle cx="76" cy="76" r="26" fill="none" stroke="#FAF9F6" stroke-width="9"></circle><path d="M95 95l22 22" stroke="#FAF9F6" stroke-width="10" stroke-linecap="round"></path><path d="M118 40l3.5 9 9 3.5-9 3.5-3.5 9-3.5-9-9-3.5 9-3.5z" fill="#E8B465"></path>'
opts = [
    ("四格", "和菜单栏关掉网速时的标志一致；一格点亮表示「正在用的工具」", squircle(tiles, '<stop offset="0" stop-color="#4A6A9C"></stop><stop offset="1" stop-color="#2E4A75"></stop>')),
    ("衬线 A", "米白底配衬线字母，呼应界面里的衬线标题；火花表示「Aha」", squircle(serif_a, '<stop offset="0" stop-color="#FFFFFF"></stop><stop offset="1" stop-color="#EDEAE2"></stop>')),
    ("搜索火花", "放大镜表示⌥Space 搜索，火花表示灵感；最直白", squircle(spark, '<stop offset="0" stop-color="#3D3B36"></stop><stop offset="1" stop-color="#1F1E1C"></stop>')),
]
cards = ""
for name, desc, svg in opts:
    cards += f'''<div class="col" style="width: 230px; align-items: center; gap: 12px; text-align: center">{svg}<b style="font-size: 15px; font-weight: 500">{name}</b><span class="note">{desc}</span>
<span class="row" style="gap: 14px; margin-top: 4px"><span style="transform: scale(.38); width: 64px; height: 64px; display: flex; align-items: center; justify-content: center">{svg}</span><span style="transform: scale(.19); width: 32px; height: 32px; display: flex; align-items: center; justify-content: center">{svg}</span></span></div>'''
inner = f'''<div class="col" style="gap: 22px">
<span class="row" style="gap: 30px; align-items: flex-start">{cards}</span>
<p class="note">应用图标用在「应用程序」文件夹、Dock（打开网页应用时）、授权弹窗和关于页面。三个方向都只用设计规范里的颜色，不用 Claude / Anthropic 的元素；定了以后再画 1024px 的正式稿，导出 .icns。</p>
</div>'''
boards.append(board("AppIcon", "应用图标 · 三个方向", 780, 420, inner))

# ---- 超级面板 ----
ICONS.update({
    "drop": '<path d="M12 3.5c3 4 6 7.2 6 10.5a6 6 0 0 1-12 0c0-3.3 3-6.5 6-10.5z"></path>',
    "desk": '<rect x="3" y="5" width="18" height="12" rx="2"></rect><path d="M9 20h6"></path>',
    "lock2": '<rect x="5" y="11" width="14" height="9" rx="2"></rect><path d="M8 11V8a4 4 0 0 1 8 0v3"></path>',
    "term": '<rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="M7 10l3 2-3 2M12 15h5"></path>',
    "code": '<path d="M9 8l-4 4 4 4M15 8l4 4-4 4"></path>',
    "file+": '<path d="M6.5 3.5h7l4 4v13h-11z"></path><path d="M12 11v6M9 14h6"></path>',
    "path": '<path d="M5 12h10M11 8l4 4-4 4M19 5v14"></path>',
    "star": '<path d="M12 4l2.4 5 5.4.6-4 3.7 1.1 5.3L12 16l-4.9 2.6 1.1-5.3-4-3.7 5.4-.6z"></path>',
    "search": '<circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path>',
    "gear": '<circle cx="12" cy="12" r="3"></circle><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"></path>',
    "ocr": '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M8 10h8M8 14h5"></path>',
    "ask": '<path d="M5 18l-1 3 3.5-1.5A8 8 0 1 0 5 18z"></path><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5M12 16h.01"></path>',
})


def sp_shell(context, content, foot="⌥⇧ Space 呼出 · esc 关闭"):
    """The super panel: a small window at the mouse pointer."""
    return f'''<section class="win" style="width: 300px; height: 460px; border-radius: 12px">
<header class="row" style="height: 48px; padding: 0 10px 0 14px; border-bottom: 1px solid var(--border); flex-shrink: 0">{context}<span class="sp"></span>
<button type="button" class="ib" aria-label="搜索">{icon("search")}</button><button type="button" class="ib" aria-label="超级面板设置">{icon("gear")}</button></header>
{content}
<footer class="row" style="height: 30px; padding: 0 14px; border-top: 1px solid var(--border); font-size: 11px; color: var(--text-3); flex-shrink: 0">{foot}</footer>
</section>'''


def sp_grid(items, cols=3, h=88):
    cells = ""
    for name, ic in items:
        inner = icon(ic, 18) if ic in ICONS else f'<span style="font-weight: 600">{ic}</span>'
        extra = " border-style: dashed; background: transparent;" if ic == "plus" else ""
        cells += f'<span style="height: {h}px; border-radius: 10px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; font-size: 12px; text-align: center"><span class="tile" style="width: 38px; height: 38px; border-radius: 10px;{extra}">{inner}</span>{name}</span>'
    return f'<div style="display: grid; grid-template-columns: repeat({cols}, 1fr); gap: 2px; padding: 8px">{cells}</div>'


def sp_list(rows):
    out = '<div style="display: flex; flex-direction: column; gap: 1px; padding: 6px">'
    for i, (name, ic, meta) in enumerate(rows):
        bg = "background: var(--selected); " if i == 0 else ""
        out += f'<span class="row" style="{bg}height: 38px; padding: 0 10px; border-radius: 8px; gap: 12px"><span style="color: var(--text-2); display: flex">{icon(ic, 17)}</span><span style="flex: 1">{name}</span><span class="note" style="font-size: 11px">{meta}</span></span>'
    return out + "</div>"


def desk_with(panel, cursor_at=(300, 50)):
    """A faux desktop so the panel reads as appearing at the mouse pointer."""
    x, y = cursor_at
    return f'''<div style="position: relative; width: 760px; height: 540px; border-radius: 12px; overflow: hidden; background: linear-gradient(160deg, color-mix(in srgb, var(--desk) 80%, var(--accent)), var(--desk)); box-shadow: 0 0 0 1px var(--border)">
<div style="position: absolute; left: 40px; top: 40px; width: 520px; height: 380px; border-radius: 10px; background: var(--surface); box-shadow: 0 6px 24px rgba(0,0,0,.12); opacity: .75"></div>
<div style="position: absolute; left: {x}px; top: {y}px">{panel}</div>
<svg style="position: absolute; left: {x - 6}px; top: {y - 8}px" width="16" height="22" viewBox="0 0 16 22" aria-hidden="true"><path d="M1 1v17l4.5-4 3 7 3-1.4-3-6.6H15z" fill="#1D1C1A" stroke="#fff" stroke-width="1.2"></path></svg>
</div>'''


chip = lambda text, ic="": f'<span class="row" style="gap: 6px; min-width: 0"><span class="tile sm" style="width: 22px; height: 22px">{icon(ic, 13) if ic else ""}</span><span style="font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">{text}</span></span>'

mine = [("截图", "shot"), ("二维码", "qr"), ("翻译", "tr"), ("取色", "drop"), ("截图识字", "ocr"), ("DeepSeek", "D"), ("显示桌面", "desk"), ("锁屏", "lock2"), ("添加", "plus")]
ICONS["shot"] = '<path d="M7 3v14h14M3 7h14v14"></path>'
p1 = sp_shell(chip("我的面板", "star"), sp_grid(mine))
inner = f'''<div class="row" style="align-items: flex-start; gap: 36px">{desk_with(p1)}
<div class="col" style="width: 300px; gap: 12px; padding-top: 6px">
<b style="font-size: 15px; font-weight: 500">没有可识别的内容时</b>
<p class="note">按 ⌥⇧ Space（可改）或长按鼠标右键，面板出现在鼠标旁边，显示「我的面板」：自己挑的常用功能，九宫格。</p>
<p class="note">格子里可以放任何指令：插件功能、网页应用、应用、收藏的路径、系统动作（取色、显示桌面、锁屏）。右键格子可以移除或调整顺序，「添加」打开指令列表。</p>
<p class="note">右上角放大镜打开搜索面板，齿轮打开「设置 · 超级面板」。点功能后面板自动关闭；点面板外也关闭。</p>
</div></div>'''
boards.append(board("SuperPanelHome", "超级面板 · 我的面板", 1100, 540, inner))

p2 = sp_shell(chip("访达 · 设计稿", "folder"), sp_list([
    ("压缩目录下所有图片", "zip", "13 张"), ("复制路径", "path", "~/Documents/设计稿"), ("在终端中打开", "term", ""),
    ("用 VS Code 打开", "code", "自定义"), ("用 Claude Code 打开", "term", "自定义"), ("新建文件…", "file+", ""), ("收藏到快捷启动", "star", ""),
]) + '<div style="flex: 1"></div>' + f'<div class="row" style="padding: 6px 14px 10px; gap: 6px"><span class="note" style="font-size: 11px">我的面板</span><span class="sp"></span>' + "".join(f'<span class="tile sm">{icon(i, 13)}</span>' for i in ["shot", "qr", "tr", "drop", "ocr"]) + '</div>')
inner = f'''<div class="row" style="align-items: flex-start; gap: 36px">{desk_with(p2)}
<div class="col" style="width: 300px; gap: 12px; padding-top: 6px">
<b style="font-size: 15px; font-weight: 500">访达里选中了文件夹</b>
<p class="note">呼出时先看最前面的应用：是访达，就读出选中的项目（没选中时用当前窗口的文件夹），列出能对它做的事。标题显示应用和名字。</p>
<p class="note">内置动作按选中的类型出现：文件夹 → 压缩目录下所有图片；图片文件 → 压缩图片、识别二维码；任何文件 → 复制路径、在终端中打开、收藏。</p>
<p class="note">标「自定义」的是用户在设置里加的命令动作，例如 <span class="mono">code {{path}}</span>、<span class="mono">cd {{dir}} &amp;&amp; claude</span>。</p>
<p class="note">「我的面板」缩成底部一排小图标，仍然一点就用。↑↓ 选择，↵ 执行。</p>
</div></div>'''
boards.append(board("SuperPanelFinder", "超级面板 · 访达选中文件夹", 1100, 540, inner))

p3 = sp_shell(chip("Safari · 选中 42 个字", "globe"), f'''<div style="margin: 10px 10px 4px; padding: 10px 12px; border-radius: 10px; background: var(--sunken); display: flex; flex-direction: column; gap: 6px">
<span class="note" style="font-size: 11px">翻译 · deepseek-chat</span>
<span style="font-size: 13px; line-height: 1.55">Tauri 让你用网页前端构建更小、更快、更安全的桌面应用。</span>
<span class="row"><span class="sp"></span><button type="button" class="btn sm g">复制</button><button type="button" class="btn sm g">展开</button></span></div>''' + sp_list([
    ("问 DeepSeek", "ask", "网页应用"), ("生成二维码", "qr", ""), ("在搜索面板中打开", "search", ""), ("复制为纯文本", "copy", ""),
]))
inner = f'''<div class="row" style="align-items: flex-start; gap: 36px">{desk_with(p3)}
<div class="col" style="width: 300px; gap: 12px; padding-top: 6px">
<b style="font-size: 15px; font-weight: 500">任何应用里选中了文字</b>
<p class="note">读选中文字：先用辅助功能接口读（不碰剪贴板），读不到再模拟一次 ⌘C 并在读完后恢复原剪贴板。</p>
<p class="note">翻译直接在面板顶部给出结果（流式），不用再进翻译页面；「展开」进入完整的翻译页面。</p>
<p class="note">其余是对文字能做的事：交给网页应用、生成二维码、带进搜索面板（等于在搜索框粘贴，匹配到的插件都能用）。文字是网址时多一项「在浏览器中打开」。</p>
</div></div>'''
boards.append(board("SuperPanelText", "超级面板 · 选中文字", 1100, 540, inner))

PLS = ["截图|截", "二维码|码", "翻译|译", "网页应用|网", "图片压缩|压"]
nav_sp = settings("", "", nav_on="超级面板")
detail = f'''<div class="detail" style="gap: 14px">
<h1 style="margin: 0; font-family: var(--serif); font-size: 22px; font-weight: 500">超级面板</h1>
<div>
<div class="srow"><span class="st"><b>呼出热键</b><span>面板出现在鼠标旁边</span></span><span class="btn mono" style="min-width: 110px; font-size: 12px">⌥⇧ Space</span><span class="sw on"><i></i></span></div>
<div class="srow"><span class="st"><b>长按鼠标右键呼出</b><span>按住约 0.4 秒；短按仍是普通右键菜单</span></span><span class="sw"><i></i></span></div>
</div>
<span class="row"><span class="lbl">我的面板</span><span class="sp"></span><span class="note">拖动排序 · 最多 12 个</span></span>
<div class="row" style="gap: 6px; flex-wrap: wrap">{"".join(f'<span class="row" style="height: 30px; padding: 0 8px 0 4px; border-radius: 8px; background: var(--surface); border: 1px solid var(--border); gap: 6px; font-size: 12px"><span class="tile sm" style="width: 22px; height: 22px">{icon(i, 12) if i in ICONS else i}</span>{n}</span>' for n, i in mine[:-1])}<button type="button" class="btn sm a">{icon("plus", 13)}添加</button></div>
<span class="row" style="margin-top: 4px"><span class="lbl">自定义动作</span><span class="sp"></span><button type="button" class="btn sm">{icon("plus", 13)}新建动作</button></span>
<div class="card">
<div class="row" style="min-height: 52px; padding: 0 14px; gap: 12px; border-bottom: 1px solid var(--border)"><span class="st" style="gap: 2px"><b style="font-size: 13px">用 VS Code 打开</b><span class="mono" style="font-size: 11px">code {{path}}</span></span><span class="chip">文件 · 文件夹</span><span class="sw sm on"><i></i></span></div>
<div class="row" style="min-height: 52px; padding: 0 14px; gap: 12px"><span class="st" style="gap: 2px"><b style="font-size: 13px">用 Claude Code 打开</b><span class="mono" style="font-size: 11px">open -a Ghostty --args -e "cd {{dir}} &amp;&amp; claude"</span></span><span class="chip">文件夹</span><span class="sw sm on"><i></i></span></div>
</div>
<p class="note">命令里可用 <span class="mono">{{path}}</span> 选中项、<span class="mono">{{dir}}</span> 所在文件夹、<span class="mono">{{text}}</span> 选中文字；用系统 shell 执行，不弹终端。</p>
</div>'''
sp_settings = settings("", detail, nav_on="超级面板").replace('<span class="i">所有指令</span>', '<span class="i">所有指令</span>').replace('<span class="i">全局热键</span>', '<span class="i">全局热键</span>\n<span class="i on">超级面板</span>', 1)
boards.append(board("SuperPanelSettings", "设置 · 超级面板", 880, 580, sp_settings))

# ---- 功能图标 ----
# Two directions on one board. A (default, written to src/assets/icons): a luminous
# gradient tile with a fine top highlight and a two-tone white glyph. B: a tinted tile
# with the glyph in the feature colour, drawn with currentColor so it follows the theme.
# Glyphs sit on a 24-unit grid: "fill" parts are the soft second tone, "line" parts the
# 1.8px outline.
FEATURE_ICONS = [
    # key, 名称, 底色, 浅色调（fill）, 线条（line）
    ("launcher", "快捷启动", "#D08A3A", '<path d="M7 4h10v16l-5-3.5L7 20z"></path>', '<path d="M7 4h10v16l-5-3.5L7 20z"></path><path d="M12 8.2l.9 1.9 2 .3-1.5 1.4.4 2-1.8-1-1.8 1 .4-2-1.5-1.4 2-.3z"></path>'),
    ("hotkeys", "热键检测", "#5F6F86", '<rect x="3" y="6" width="18" height="12" rx="2.5"></rect>', '<rect x="3" y="6" width="18" height="12" rx="2.5"></rect><path d="M7 10h.01M10.3 10h.01M13.7 10h.01M17 10h.01M8 14.2h8"></path>'),
    ("screenshot", "截图", "#2F9488", '<rect x="7" y="7" width="10" height="10" rx="1"></rect>', '<path d="M7 3v14h14M3 7h14v14"></path>'),
    ("webapps", "网页应用", "#3F63A0", '<circle cx="12" cy="12" r="8.5"></circle>', ICONS["globe"]),
    ("settings", "设置", "#7A766C", '<circle cx="12" cy="12" r="6.4"></circle>', '<circle cx="12" cy="12" r="2.8"></circle><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M5.6 18.4l1.6-1.6M16.8 7.2l1.6-1.6"></path>'),
    ("qrcode", "生成二维码", "#3E8A5A", '<rect x="4" y="4" width="6" height="6" rx="1.2"></rect><rect x="14" y="4" width="6" height="6" rx="1.2"></rect><rect x="4" y="14" width="6" height="6" rx="1.2"></rect>', '<rect x="4" y="4" width="6" height="6" rx="1.2"></rect><rect x="14" y="4" width="6" height="6" rx="1.2"></rect><rect x="4" y="14" width="6" height="6" rx="1.2"></rect><path d="M14 14h2.5v2.5M20 14v6h-6M17.2 17.2h.01"></path>'),
    ("qrcode-scan", "识别二维码", "#3E8A5A", '<rect x="8" y="8" width="8" height="8" rx="1.5"></rect>', '<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16M3.5 12h17"></path>'),
    ("translate", "翻译", "#D9713A", '<rect x="11.5" y="9.5" width="10" height="11" rx="2.5"></rect>', ICONS["tr"]),
    ("compress", "图片压缩", "#C2553F", '<rect x="8.5" y="8.5" width="7" height="7" rx="1.5"></rect>', '<path d="M9 3.5V9H3.5M15 3.5V9h5.5M9 20.5V15H3.5M15 20.5V15h5.5"></path>'),
    ("hosts", "hosts 切换", "#3E7F96", '<rect x="4" y="4" width="16" height="7" rx="2"></rect>', '<rect x="4" y="4" width="16" height="7" rx="2"></rect><rect x="4" y="13" width="16" height="7" rx="2"></rect><path d="M8 7.5h.01M8 16.5h.01M12 7.5h4M12 16.5h4"></path>'),
    ("superpanel", "超级面板", "#8A5A9A", '<rect x="4" y="4" width="7" height="7" rx="2"></rect><rect x="13" y="4" width="7" height="7" rx="2"></rect>', '<rect x="4" y="4" width="7" height="7" rx="2"></rect><rect x="13" y="4" width="7" height="7" rx="2"></rect><rect x="4" y="13" width="7" height="7" rx="2"></rect><path d="M16.5 13.2l1 2.3 2.3 1-2.3 1-1 2.3-1-2.3-2.3-1 2.3-1z"></path>'),
    ("system-colorpicker", "取色", "#C4517A", '<path d="M5.5 18.5c0-1.4 1.1-3 1.1-3s1.1 1.6 1.1 3a1.1 1.1 0 0 1-2.2 0z"></path>', '<path d="M14.2 4.6l5.2 5.2-2 2-5.2-5.2z"></path><path d="M13.2 7.6L7 13.8V17h3.2l6.2-6.2"></path>'),
    ("system-desktop", "显示桌面", "#4F79B8", '<rect x="3" y="4" width="18" height="12" rx="2"></rect>', '<rect x="3" y="4" width="18" height="12" rx="2"></rect><path d="M9 20h6M12 16v4"></path>'),
    ("system-lock", "锁屏", "#4A4740", '<rect x="5" y="11" width="14" height="9" rx="2.2"></rect>', '<rect x="5" y="11" width="14" height="9" rx="2.2"></rect><path d="M8 11V8a4 4 0 0 1 8 0v3M12 14.5v2"></path>'),
    ("system-ocr", "截图识字", "#2E7AA8", '<rect x="7" y="8" width="10" height="8" rx="1.5"></rect>', '<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16M9 10.5h6M9 13.5h4"></path>'),
    ("sysmon", "系统监控", "#9A7A34", '<path d="M3 12h4l2-6 4 12 2-6h6v8H3z"></path>', '<path d="M3 12h4l2-6 4 12 2-6h6"></path>'),
    ("external", "外部插件", "#7470A8", ICONS["puzzle"], ICONS["puzzle"]),
]


def mix(hex_color, other, t):
    """Blend hex_color toward other (0..1)."""
    a = [int(hex_color[i:i + 2], 16) for i in (1, 3, 5)]
    b = [int(other[i:i + 2], 16) for i in (1, 3, 5)]
    return "#" + "".join(f"{round(x + (y - x) * t):02X}" for x, y in zip(a, b))


def feature_svg(key, color, fill, line, size=None):
    """Direction A: luminous tile, white two-tone glyph. 48-unit canvas."""
    top, bottom = mix(color, "#FFFFFF", 0.22), mix(color, "#000000", 0.14)
    g = f"bg-{key}"
    attrs = f' width="{size}" height="{size}"' if size else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"{attrs}>'
            f'<defs><linearGradient id="{g}" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" stop-color="{top}"></stop><stop offset=".55" stop-color="{color}"></stop><stop offset="1" stop-color="{bottom}"></stop></linearGradient>'
            f'<linearGradient id="{g}-hl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF" stop-opacity=".5"></stop><stop offset=".45" stop-color="#FFFFFF" stop-opacity="0"></stop></linearGradient></defs>'
            f'<rect width="48" height="48" rx="11.5" fill="url(#{g})"></rect>'
            f'<rect x=".6" y=".6" width="46.8" height="46.8" rx="10.9" fill="none" stroke="url(#{g}-hl)" stroke-width="1.2"></rect>'
            f'<g transform="translate(12 12)"><g fill="#FFFFFF" fill-opacity=".26" stroke="none">{fill}</g>'
            f'<g fill="none" stroke="#FFFFFF" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">{line}</g></g></svg>')


def soft_svg(color, fill, line, size):
    """Direction B: tinted tile, glyph in the feature colour (follows the theme via CSS)."""
    return (f'<span style="display: inline-flex; color: color-mix(in srgb, {color} 78%, var(--text))"><svg viewBox="0 0 48 48" width="{size}" height="{size}">'
            f'<rect width="48" height="48" rx="11.5" fill="currentColor" fill-opacity=".13"></rect>'
            f'<rect x=".5" y=".5" width="47" height="47" rx="11" fill="none" stroke="currentColor" stroke-opacity=".16"></rect>'
            f'<g transform="translate(12 12)"><g fill="currentColor" fill-opacity=".2" stroke="none">{fill}</g>'
            f'<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">{line}</g></g></svg></span>')


if len(sys.argv) > 2:
    icon_dir = Path(sys.argv[2])
    icon_dir.mkdir(parents=True, exist_ok=True)
    for key, _, color, fill, line in FEATURE_ICONS:
        (icon_dir / f"{key}.svg").write_text(feature_svg(key, color, fill, line) + "\n")


def icon_grid(render):
    cells = ""
    for key, name, color, fill, line in FEATURE_ICONS:
        cells += f'<div class="col" style="align-items: center; gap: 7px; width: 104px">{render(key, color, fill, line)}<span style="font-size: 12.5px; font-weight: 500; white-space: nowrap">{name}</span><span class="mono" style="font-size: 10px; color: var(--text-3); white-space: nowrap">{key}</span></div>'
    return f'<div style="display: grid; grid-template-columns: repeat(9, 104px); gap: 20px 6px">{cells}</div>'


def demo(render):
    rows = ""
    for i, sub in ((5, "二维码 · 插件功能"), (7, "翻译 · 插件功能"), (8, "图片压缩 · 自动匹配")):
        key, name, color, fill, line = FEATURE_ICONS[i]
        sel = "background: var(--selected); " if i == 5 else ""
        rows += f'<div class="row" style="{sel}height: 50px; padding: 0 12px; border-radius: 10px; gap: 14px">{render(key, color, fill, line, 32)}<span class="st" style="gap: 2px"><b style="font-size: 14px">{name}</b><span>{sub}</span></span></div>'
    return f'<div class="win" style="width: 360px; padding: 8px 10px">{rows}</div>'


a_render = lambda key, color, fill, line, size=50: feature_svg(key, color, fill, line, size)
b_render = lambda key, color, fill, line, size=50: soft_svg(color, fill, line, size)
inner = f'''<div class="col" style="gap: 18px">
<span class="row" style="gap: 10px"><b style="font-size: 15px; font-weight: 500">方向 A · 实色（默认，已导出到 src/assets/icons）</b><span class="note">渐变底 + 顶边高光 + 白色双色图形，像系统应用图标</span></span>
<div class="row" style="gap: 28px; align-items: flex-start">{icon_grid(a_render)}</div>
<div class="row" style="gap: 28px; align-items: flex-start">{demo(a_render)}<p class="note" style="max-width: 420px">图形 = 1.8px 白色线条 + 26% 白色的浅色面，给出层次；底色从提亮 22% 过渡到压暗 14%，顶边一道渐隐的高光。圆角 11.5/48。</p></div>
<div style="height: 1px; background: var(--border)"></div>
<span class="row" style="gap: 10px"><b style="font-size: 15px; font-weight: 500">方向 B · 柔和浅色</b><span class="note">浅色调底 + 彩色图形，更安静，跟随浅色 / 深色</span></span>
<div class="row" style="gap: 28px; align-items: flex-start">{icon_grid(b_render)}</div>
<div class="row" style="gap: 28px; align-items: flex-start">{demo(b_render)}<p class="note" style="max-width: 420px">底 = 功能色 13%，细边 16%，图形用功能色（和正文色混 22%，深色模式自动变亮）。更贴近界面「一个强调色，省着用」的克制；选它的话用内联 SVG 组件实现，不用图片文件。</p></div>
</div>'''
boards.append(board("FeatureIcons", "功能图标 · 两个方向", 1100, 1030, inner))

# ---- canvas.json ----
canvas_path = OUT / "canvas.json"
canvas = json.loads(canvas_path.read_text())
if not any(p["id"] == "next" for p in canvas["pages"]):
    canvas["pages"].insert(0, {"id": "next", "name": "后续功能"})
canvas["launch"] = {"view": "canvas", "page": "next"}
y = 0
for b in boards:
    canvas["boards"][b["file"]] = {"x": 0, "y": y, "w": b["w"], "h": b["h"], "title": b["title"], "page": "next"}
    if isinstance(canvas.get("order"), list) and b["file"] not in canvas["order"]:
        canvas["order"].append(b["file"])
    y += b["h"] + 120
canvas_path.write_text(json.dumps(canvas, ensure_ascii=False, indent=2))
print("\n".join(b["file"] for b in boards))
