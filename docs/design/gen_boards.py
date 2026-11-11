"""Generates the 「后续功能」 design boards for the AhaTools canvas.

Each board shows one screen twice, light and dark, using the v2 tokens from
docs/design-system.md. The canvas itself (claude.ai) is private to the owner, so the static copies next to
this file (docs/design/*.html) are what implementers look at.

Run: python3 gen_boards.py <canvas project dir> [src/assets/icons]
The optional second argument also writes the feature icons (direction A) as SVG files.
Use --static as the second argument to generate standalone light/dark HTML without a canvas.
"""
import json
import random
import sys
from pathlib import Path

OUT = Path(sys.argv[1])
STATIC = "--static" in sys.argv
OUT.mkdir(parents=True, exist_ok=True)

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
.sel{color:var(--text);font-family:inherit}
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
    if STATIC:
        themes = [("t-light", "浅色", "#3A5A8C"), ("t-dark", "深色", "#93B1E3")]
        panels = "\n".join(f'<div class="{cls}" style="width:{pw // 2}px;height:{h + 108}px;box-sizing:border-box;padding:40px;background:var(--desk);display:flex;flex-direction:column;gap:12px;--accent:{accent}"><div style="font-size:12px;color:var(--text-2)">{label}</div>{inner}</div>' for cls, label, accent in themes)
        (OUT / f"{name}.html").write_text(f'<!doctype html>\n<html lang="zh-CN"><meta charset="utf-8"><title>{title}</title>\n<!-- 由 docs/design/gen_boards.py --static 生成 -->\n<style>{CSS}</style><div style="width:{pw}px;display:flex">{panels}</div></html>\n')
        return {"file": f"{name}.html"}
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

# ---- 通用 · 再次打开时 ----
detail = f'''<div class="detail" style="gap: 0">
<h1 style="font-family: var(--serif); font-size: 22px; font-weight: 500; margin: 0 0 12px">通用</h1>
<div class="srow" style="min-height: 66px"><span class="st"><b>呼出快捷键</b><span>打开搜索面板</span></span><span class="btn mono">⌥ Space</span></div>
<div class="srow" style="min-height: 66px"><span class="st"><b>再次打开时</b><span>决定重新唤出面板后显示的页面</span></span><button type="button" class="sel" aria-label="再次打开时" style="font-family: inherit; color: var(--text)">回到上次的页面{icon("down", 12)}</button></div>
<div class="srow" style="min-height: 66px"><span class="st"><b>独占热键</b><span>AhaTools 的热键只有它自己响应</span></span><span class="sw on"><i></i></span></div>
<div class="srow" style="min-height: 66px"><span class="st"><b>拼音搜索</b><span>用全拼或首字母搜中文名，例如 wx 找到微信</span></span><span class="sw on"><i></i></span></div>
<div class="srow" style="min-height: 66px"><span class="st"><b>菜单栏网速</b><span>在菜单栏显示实时上传和下载速度</span></span><span class="sw on"><i></i></span></div>
<div class="srow" style="min-height: 66px"><span class="st"><b>开机自动启动</b><span>登录后在菜单栏运行</span></span><span class="sw"><i></i></span></div>
<div class="srow" style="min-height: 66px"><span class="st"><b>外观</b><span>浅色、深色或跟随系统</span></span><span class="sel">跟随系统{icon("down", 12)}</span></div>
</div>'''
boards.append(board("PanelBehavior", "设置 · 再次打开时", 880, 580, settings("", detail, nav_on="通用")))

# ---- 共享控件 · 下拉选择与细滚动条 ----
POPUP = "padding:6px;border-radius:10px;box-shadow:0 8px 24px rgba(30,25,15,.14)"
SEARCH = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"></circle><path d="m16 16 4 4"></path></svg>'
THUMB = "position:absolute;right:2px;width:4px;border-radius:999px;background:color-mix(in srgb,var(--text-2) 40%,transparent)"


def control_option(label, detail="", selected=False, active=False, disabled=False, below="", mono=False):
    """One row of the shared Select popup: active = keyboard / hover row, selected = current value."""
    bg = "background:var(--selected);" if active else ""
    fade = "opacity:.4;" if disabled else ""
    font = "font-family:var(--mono);font-size:12px" if mono else "font-size:13px"
    sub = f'<span style="display:block;font-size:11px;color:var(--text-2)">{below}</span>' if below else ""
    end = f'<span class="note">{detail}</span>' if detail else ""
    return f'<div style="display:flex;align-items:center;gap:8px;min-height:32px;padding:6px 10px;box-sizing:border-box;border-radius:6px;{bg}{fade}"><span style="flex:1;min-width:0;{font}">{label}{sub}</span>{end}{icon("check", 14) if selected else ""}</div>'


def search_field(text, typed=False):
    color, line = ("var(--text)", "var(--accent)") if typed else ("var(--text-3)", "var(--border)")
    return f'<div style="height:36px;display:flex;align-items:center;gap:8px;padding:0 8px 6px;margin-bottom:4px;box-sizing:border-box;border-bottom:1px solid {line};color:var(--text-2)">{SEARCH}<span style="font-size:13px;color:{color}">{text}</span></div>'


reopen = ["回到上次的页面", "超过 5 分钟回到搜索", "总是回到搜索"]
settings_options = "".join(control_option(label, selected=i == 0, active=i == 1) for i, label in enumerate(reopen))
action_options = "".join(control_option(label, detail) for label, detail in [("生成二维码", "二维码"), ("识别二维码", "二维码"), ("翻译", "翻译"), ("压缩图片", "图片压缩"), ("hosts 切换", "hosts")])
model_options = "".join(control_option(mid, below=name, mono=True, selected=mid == "custom-model-b", active=i == 0) for i, (mid, name) in enumerate([("custom-model-a", "自定义模型 A"), ("custom-model-b", "自定义模型 B"), ("custom-model-c", "")]))
up_options = "".join(control_option(label, selected=label == "系统截图", disabled=label == "钉钉（未安装）") for label in ["系统截图", "微信（未设置）", "QQ（未设置）", "钉钉（未安装）"])
combobox = lambda text, typed=True: f'<div style="position:relative"><div class="sel mono" style="width:100%;height:32px;font-size:12px;{"" if typed else "color:var(--text-3);"}{"border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 30%,transparent)" if typed else ""}">{text}<span style="width:30px;height:30px;margin-right:-10px;display:flex;align-items:center;justify-content:center;color:var(--text-2)">{icon("down", 12)}</span></div></div>'
inner = f'''<section class="win" style="width:880px;height:780px;padding:28px;gap:24px;box-sizing:border-box">
<h1 style="font:500 22px var(--serif);margin:0">下拉选择与滚动条</h1>
<div class="row" style="gap:32px;align-items:flex-start">
<div class="col" style="width:240px"><span class="lbl">设置行：靠右时右对齐</span>
<div class="row" style="justify-content:space-between"><span style="font-size:13px">再次打开时</span><span class="sel">回到上次的页面{icon("down", 12)}</span></div>
<div class="card" style="{POPUP};margin-top:-6px">{settings_options}</div>
<p class="note">弹层至少 240 宽；按钮靠右放不下时，右边与按钮对齐。暖灰底是键盘 / 悬停行，勾选是当前值。</p></div>
<div class="col" style="width:280px"><span class="lbl">动作菜单：始终带搜索</span>
<span class="btn" style="align-self:flex-end">添加热键</span>
<div class="card" style="{POPUP};margin-top:-6px">{search_field("搜索功能或插件…")}<div style="height:196px;position:relative;padding-right:8px;overflow:hidden"><div class="note" style="font-size:11px;padding:8px 10px 4px">插件功能</div>{action_options}<i style="{THUMB};top:4px;height:90px"></i></div></div>
<p class="note">按钮不带箭头，弹层与按钮右对齐。按功能名、插件名、分组过滤，多个关键词同时匹配。</p></div>
<div class="col" style="flex:1"><span class="lbl">模型：可手填的 Combobox</span>
{combobox("custom-model")}
<div class="card" style="{POPUP};margin-top:-6px">{model_options}</div>
<div class="card" style="{POPUP}"><div class="note" style="padding:10px">没有匹配的模型，可继续手动填写</div></div>
<p class="note">输入即过滤；↑↓ 选中后回车填入 ID，未选中时回车只收起，保留手填值。</p></div>
</div>
<div class="row" style="gap:32px;align-items:flex-start">
<div class="col" style="width:240px"><span class="lbl">下方空间不足：向上展开</span>
<div class="card" style="{POPUP}">{up_options}</div>
<span class="sel" style="margin-top:-6px;box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 30%,transparent)">系统截图{icon("down", 12)}</span>
<p class="note">弹层不超出窗口，最高 340。禁用项 40% 透明，键盘跳过。</p></div>
<div class="col" style="width:280px"><span class="lbl">超过 8 项：搜索与无结果</span>
<span class="sel" style="width:100%">预览配置 24{icon("down", 12)}</span>
<div class="card" style="{POPUP};margin-top:-6px">{search_field("zzz", typed=True)}<div class="note" style="padding:12px 10px 10px">没有匹配的选项</div></div>
<p class="note">打开时滚到当前值；空结果时回车不执行任何动作。</p></div>
<div class="col" style="flex:1"><span class="lbl">尺寸与状态</span>
<div class="row"><span class="sel">默认 30{icon("down", 12)}</span><span class="sel" style="height:26px;font-size:12px">小号 26{icon("down", 12)}</span></div>
<div class="row"><span class="sel" style="color:var(--text-2)">请选择协议{icon("down", 12)}</span><span class="sel" style="opacity:.4">禁用{icon("down", 12)}</span></div>
<span class="lbl" style="margin-top:12px">细滚动条</span>
<div class="row" style="gap:16px;align-items:stretch"><div class="card" style="width:120px;height:92px;position:relative;overflow:hidden"><div class="note" style="padding:8px 14px 0 10px">长列表、设置页、textarea 共用</div><i style="{THUMB};top:6px;height:40px"></i></div>
<p class="note" style="flex:1">轨道透明，占 8px；滑块可见宽 4px，取 --text-2 40%，悬停 60%。常驻显示，不随系统自动隐藏。</p></div></div>
</div></section>'''
boards.append(board("Controls", "共享控件 · 下拉选择与细滚动条", 880, 780, inner))
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
<span class="row"><span class="sel">工作配置 {icon("down",12)}</span><button class="btn g">配置服务</button></span>
<span class="row"><span class="sel" style="min-width: 110px">自动 · 其他译中文{icon("down", 12, 2)}</span><button type="button" class="ib" aria-label="交换方向">{icon("swap")}</button><span class="sel" style="min-width: 110px">中文{icon("down", 12, 2)}</span><span class="sp"></span><span class="seg"><span class="on">翻译</span><span>润色</span><span>解释</span></span></span>
<div style="flex: 1; min-height: 0; display: flex; gap: 14px">
<div class="ta" style="flex: 1">{src}</div>
<div class="ta" style="flex: 1; background: var(--sunken); border-color: transparent">{dst}<span style="display: inline-block; width: 2px; height: 16px; margin-left: 2px; vertical-align: -2px; background: var(--accent)"></span></div>
</div>
<span class="row"><span class="note">186 个字符</span><span class="sp"></span><span class="chip">工作配置 · 自填模型 · 正在输出</span><button type="button" class="btn sm g">停止</button><button type="button" class="btn sm">{icon("copy", 14)}复制译文</button></span>
</div>'''
boards.append(board("TranslateText", "翻译 · 段落", 880, 580, page(880, 580, "tr", "翻译", "翻译 · 大模型", '<span class="note">⌘↵ 重新翻译</span>', body, "esc 返回搜索 · ⌘C 复制译文", "粘贴或输入就开始翻译")))

# ---- 翻译 · 单词 ----
body = f'''<div class="body" style="flex-direction: column; gap: 14px">
<div class="row" style="gap: 14px; align-items: baseline">
<span style="font-family: var(--serif); font-size: 32px; font-weight: 500">serendipity</span>
<span class="mono note" style="font-size: 13px">/ˌserənˈdɪpəti/</span>

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
detail = f'''<div class="detail" style="overflow:auto">
<div class="dh"><span class="tile xl">{icon("tr",22)}</span><span><b>翻译</b><span class="note">多配置 · 流式翻译与单词释义</span></span></div>
<div class="seg"><span>关键词</span><span>自动匹配</span><span class="on">设置</span></div>
<div class="row"><span class="st"><b>服务配置</b><span>不可用时，可在翻译页手动切换备用配置</span></span><button class="btn">新增配置</button></div>
<div class="strip"><span class="st"><b>工作配置 · 当前</b><span>OpenAI Responses · 自填模型</span></span><button class="btn sm">编辑</button><button class="btn sm g">删除</button></div>
<div class="strip"><span class="st"><b>备用配置</b><span>Anthropic Messages · 自填模型</span></span><button class="btn sm">使用</button></div>
<div class="card" style="padding:12px;display:grid;gap:8px">
<span class="row"><label>名称</label><input class="inp" value="工作配置"></span>
<span class="row"><label>协议</label><span class="sel">OpenAI Responses</span></span>
<span class="row"><label>Base URL</label><input class="inp" value="https://gateway.example/v1"></span>
<span class="row"><label>API Key</label><input class="inp" type="password" value="example"><span class="note">保存在本机</span></span>
<span class="row"><label>模型</label><input class="inp" placeholder="输入模型 ID"><button class="btn sm">获取模型</button></span>
<span class="row"><button class="btn">测试连接</button><span class="note">首字 420 ms</span><span class="sp"></span><button class="btn p">保存配置</button></span>
</div></div>'''
boards.append(board("TranslateSettings", "插件详情 · 翻译设置", 880, 580, settings(plist(PL, "翻译"), detail)))

for name, title, message in [("TranslateEmpty", "翻译 · 未配置", "先添加一套翻译配置，填写接口地址、协议、模型和 API Key。"), ("TranslateError", "翻译 · 服务错误", "连接失败。可以重试，或手动选择备用配置。")]:
    body = f'<div class="body" style="flex-direction:column"><p>{message}</p><span class="row"><button class="btn">配置服务</button><button class="btn">重新翻译</button></span></div>'
    boards.append(board(name, title, 880, 580, page(880,580,"tr","翻译","自定义服务","",body,"esc 返回搜索","")))

# ---- hosts 切换 ----
schemes = [("系统原始", "只读 · 备份于首次应用前", None, True), ("开发环境", "5 条", True, False), ("测试环境", "4 条", False, False), ("屏蔽广告", "212 条", False, False)]
items = ""
for name, meta, on, locked in schemes:
    sel = " background: var(--selected);" if name == "开发环境" else ""
    ctrl = f'<span style="color: var(--text-3)">{icon("lock", 14)}</span>' if locked else f'<span class="sw sm{" on" if on else ""}"><i></i></span>'
    items += f'<div class="row" style="height: 50px; padding: 0 10px; border-radius: 8px;{sel}"><span class="st" style="gap: 1px"><b style="font-size: 13px">{name}</b><span style="font-size: 11px">{meta}</span></span>{ctrl}</div>\n'
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
<span class="row"><input class="inp" style="width: 180px; font-weight: 500" value="开发环境"><span class="dot" style="background: var(--warn)"></span><span class="note">有改动未应用 · 应用后保存</span><span class="sp"></span><button type="button" class="btn g sm">复制</button><button type="button" class="btn g sm" style="color: var(--bad)">删除</button></span>
<pre class="ta mono" style="flex: 1; font-size: 12.5px; line-height: 1.75; white-space: pre; overflow: hidden">{hosts}</pre>
<div class="col" style="gap:8px"><p class="note">每行「IP 空格 主机名」，支持 IPv6、别名和 # 注释</p><span class="row" style="flex-wrap:wrap"><button type="button" class="btn g" style="color:var(--bad)">恢复原始 hosts…</button><span class="sp"></span><button type="button" class="btn">查看当前生效内容</button><button type="button" class="btn p">应用</button></span></div>
</div>
</div>'''
boards.append(board("Hosts", "hosts 切换", 880, 580, page(880, 580, "globe", "hosts 切换", "hosts", '<span class="row"><span class="dot" style="background: var(--ok)"></span><span class="note">已生效：开发环境 · 10:42</span></span>', body, "esc 返回搜索 · ⌘S 应用", "修改系统时需要管理员授权")))

# Hosts interaction states: readonly preview, validation and confirmations.
host_states = [
    ("校验错误", "第 2 行：IP 地址不合法；api.local.test 与系统第 8 行冲突。点击错误定位，启用方案有错时禁止应用。", "修改或关闭方案"),
    ("关闭的方案有错误", "仍可应用其他方案并保存。关闭方案的错误保留提示。", "应用"),
    ("尚未备份 · 系统原始", "只读显示当前系统 hosts，首次应用前创建备份。查看当前生效内容可刷新，Esc 关闭查看。", "查看当前生效内容"),
    ("有改动未应用", "返回搜索、打开设置或切换插件前，选择应用并离开、放弃改动或继续编辑。收起窗口保留草稿。", "应用并离开 · 放弃改动 · 继续编辑"),
    ("恢复原始 hosts？", "移除 AhaTools 标记段，关闭已保存方案并丢弃草稿。系统其他内容保留。", "取消 · 恢复原始 hosts"),
    ("正在等待授权或应用…", "操作期间禁用编辑、离页与重复提交；授权取消后保留草稿。", "正在应用…"),
    ("系统已写入，方案保存失败", "保留草稿，重新读取实际系统状态。DNS 刷新失败单独显示，可再次应用重试。", "重新应用"),
]
state_cards = "".join(f'<div class="card col" style="padding:16px;gap:8px"><b style="font-weight:500">{title}</b><p class="note">{description}</p><span style="font-size:12px;color:var(--accent)">{action}</span></div>' for title, description, action in host_states)
boards.append(board("HostsStates", "hosts 切换 · 交互状态", 880, 880, f'<div class="win" style="width:880px;box-sizing:border-box;padding:24px;gap:12px">{state_cards}</div>'))

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


pop = f'''<div class="win" role="dialog" aria-label="AhaTools 菜单" style="width: 300px; max-height: 720px; border-radius: 12px; padding: 14px 12px 8px; gap: 16px; box-sizing: border-box; overflow-y: auto">
<div class="row" style="padding: 0 4px; align-items: baseline"><span class="lbl">网速</span><span class="sp"></span><span class="note" style="font-size: 11px">Wi‑Fi · en0</span></div>
<div class="row" style="padding: 0 4px; gap: 18px"><span style="font-size: 18px; font-weight: 500">↓ 3.4<span class="note"> MB/s</span></span><span style="font-size: 18px; font-weight: 500">↑ 120<span class="note"> KB/s</span></span></div>
<div class="col" style="gap: 8px; padding: 0 4px">
<svg width="268" height="44" viewBox="0 0 268 44" aria-label="最近 60 秒网速曲线"><path d="M0 38 L22 30 L44 34 L66 20 L88 25 L110 18 L132 26 L154 14 L176 22 L198 10 L220 17 L242 12 L268 20" stroke="var(--accent)" fill="none" stroke-width="1.5"/><path d="M0 42 L66 39 L132 40 L198 38 L268 41" stroke="var(--text-2)" fill="none" stroke-dasharray="3 3"/></svg>
<span class="note" style="font-size: 10px">最近 60 秒　开机以来 ↓ 12.4 GB · ↑ 1.8 GB</span>
</div>
<div style="height: 1px; flex-shrink: 0; background: var(--border); margin: 0 -12px"></div>
<div class="col" style="gap: 16px; padding: 0 4px">
<div class="col" style="gap: 6px"><span class="row"><span class="lbl" style="width: 40px">CPU</span><span style="font-weight: 500">23%</span><span class="sp"></span></span><span class="note" style="font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">最忙进程：Cursor 11%</span>
<svg width="268" height="28" viewBox="0 0 268 28" fill="none" aria-hidden="true"><path d="M0 20 {spark(3, 18)} L268 28 L0 28Z" fill="var(--accent)" opacity=".10"></path><path d="M0 20 {spark(3, 18)}" stroke="var(--accent)" stroke-width="1.5" stroke-linejoin="round"></path></svg></div>
<div class="col" style="gap: 6px"><span class="row"><span class="lbl" style="width: 40px">内存</span><span style="font-weight: 500">11.2</span><span class="note">/ 16 GB</span><span class="sp"></span><span class="note" style="font-size: 11px">压力正常</span></span><span class="bar"><i style="width: 70%"></i></span></div>
<div class="col" style="gap: 6px"><span class="row"><span class="lbl" style="width: 40px">电池</span><span style="font-weight: 500">86%</span><span class="sp"></span><span class="note" style="font-size: 11px">充电中 · 约 25 分钟充满</span></span><span class="bar"><i style="width: 86%; background: var(--ok)"></i></span></div>
<div class="row"><span class="lbl" style="width: 40px">磁盘</span><span style="font-weight: 500">212 GB</span><span class="note">可用 / 494 GB</span></div>
</div>
<div style="height: 1px; background: var(--border); margin: 0 -12px"></div>
<div class="col" style="gap: 1px">
<span class="row" style="height: 30px; padding: 0 8px">打开搜索面板<span class="sp"></span><span class="mono" style="font-size: 11px; color: var(--text-3)">⌥ Space</span></span>
<span class="row" style="height: 30px; padding: 0 8px">截图工具<span class="sp"></span><span class="note">QQ</span>{icon("chev", 12, 2)}</span>
<span class="row" style="height: 30px; padding: 0 8px">独占热键<span class="sp"></span><span class="note" style="color: var(--ok)">已生效</span><span class="sw sm on"><i></i></span></span>
</div>
<div style="height: 1px; flex-shrink: 0; background: var(--border); margin: 0 -12px"></div>
<div class="col" style="gap: 1px">
<span class="row" style="height: 30px; padding: 0 8px; border-radius: 6px; background: var(--hover)">设置…<span class="sp"></span><span class="mono" style="font-size: 11px; color: var(--text-3)">⌘ ,</span></span>
<span class="row" style="height: 30px; padding: 0 8px">开机自动启动<span class="sp"></span><span class="sw sm"><i></i></span></span>
<span class="row" style="height: 30px; padding: 0 8px">退出 AhaTools<span class="sp"></span><span class="mono note">⌘ Q</span></span>
</div>
</div>'''
side = f'''<div class="col" style="gap: 16px; width: 360px">
<span class="lbl">菜单栏显示</span>
<div class="row" style="height: 40px; padding: 0 14px; border-radius: 10px; background: var(--menubar); box-shadow: 0 0 0 1px var(--border); justify-content: flex-end; gap: 16px; font-size: 12px; font-weight: 500">
<span class="row" style="gap: 6px"><span class="mono" style="font-size: 10px; line-height: 11px; display: flex; flex-direction: column; align-items: flex-end"><span>120 KB/s</span><span>3.4 MB/s</span></span></span>
<span class="row" style="gap: 4px">{icon("cpu", 14)}23%</span>
<span>10月30日 周五 11:20</span>
</div>
<p class="note">设置 → 通用 → 菜单栏显示：网速（默认）、CPU、内存可以多选，新开启的项目排在末尾。CPU 和内存显示使用率。都不选时只显示 AhaTools 标志。</p>
<div class="card" style="padding: 4px 16px">
<div class="srow" style="min-height: 52px"><span class="st"><b style="font-size: 13px">网速</b></span><span class="sw on"><i></i></span></div>
<div class="srow" style="min-height: 52px"><span class="st"><b style="font-size: 13px">CPU</b></span><span class="sw on"><i></i></span></div>
<div class="srow" style="min-height: 52px"><span class="st"><b style="font-size: 13px">内存</b></span><span class="sw"><i></i></span></div>
</div>
<p class="note">弹出面板打开时每秒刷新全部指标。收起后只采集菜单栏已选的 CPU 或内存；未选时停止系统采样。弹窗高度随内容收紧，空间不足时可滚动。</p>
<span class="lbl" style="margin-top: 8px">截图工具 · 展开</span>
<div class="col" style="gap: 6px; width: 276px">
<div class="card" style="{POPUP}">{"".join(control_option(label, selected=label == "QQ", active=label == "微信") for label in ["系统截图", "微信", "QQ", "钉钉（未设置）"])}</div>
<span class="row" style="height: 30px; padding: 0 8px; border-radius: 6px; background: var(--hover); font-size: 13px">截图工具<span class="sp"></span><span class="note">QQ</span>{icon("chev", 12, 2)}</span>
</div>
<p class="note">共享 Select 的整行样式：左边标签，右边当前值和 ›。弹层宽同行宽，按空间向上或向下展开，盖在监控区上方，不改变弹窗高度。</p>
</div>'''
boards.append(board("SystemMonitor", "菜单栏 · 系统监控", 760, 780, f'<div class="row" style="align-items: flex-start; gap: 40px">{pop}{side}</div>'))

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
# ---- 超级面板第二版（2026-11-03）：按插件「自动匹配」列功能，固定走右键，高度随内容 ----
ICON_DIR = Path(__file__).resolve().parents[2] / "src/assets/icons"
ICONS.update({
    "term": '<rect x="3.5" y="5" width="17" height="14" rx="2"></rect><path d="M7.5 10l3 2.5-3 2.5M12.5 15h4"></path>',
    "newfile": '<path d="M6.5 3.5h7l4 4v13h-11z"></path><path d="M12 11v6M9 14h6"></path>',
    "code": '<path d="M9 8l-4 4 4 4M15 8l4 4-4 4"></path>',
    "pin": '<path d="M9 4h6l-1 5 3 3v2H7v-2l3-3zM12 14v6"></path>',
    "more": '<circle cx="6" cy="12" r="1.2"></circle><circle cx="12" cy="12" r="1.2"></circle><circle cx="18" cy="12" r="1.2"></circle>',
})


def ficon(key, size=26):
    """A real feature icon from src/assets/icons, so boards match the app."""
    svg = (ICON_DIR / f"{key}.svg").read_text().strip()
    return svg.replace("<svg ", f'<svg width="{size}" height="{size}" style="display: block; flex-shrink: 0" aria-hidden="true" ', 1)


def site(letter, size=26):
    """Stand-in for a web app favicon."""
    return f'<span style="width: {size}px; height: {size}px; border-radius: {size * .24:.0f}px; background: #4D6BFE; color: #fff; display: flex; align-items: center; justify-content: center; font-size: {size * .46:.0f}px; font-weight: 600; flex-shrink: 0">{letter}</span>'


def line_tile(name, size=26):
    """System actions keep the quiet line style; feature icons carry the colour."""
    return f'<span class="tile" style="width: {size}px; height: {size}px; border-radius: {size * .26:.0f}px">{icon(name, size * .58)}</span>'


PINS = [("截图", ficon("screenshot", 34)), ("生成二维码", ficon("qrcode", 34)), ("取色", ficon("system-colorpicker", 34)),
        ("截图识字", ficon("system-ocr", 34)), ("DeepSeek", site("D", 34)), ("显示桌面", ficon("system-desktop", 34)), ("锁屏", ficon("system-lock", 34))]
PINS_SM = [("截图", ficon("screenshot", 24)), ("生成二维码", ficon("qrcode", 24)), ("取色", ficon("system-colorpicker", 24)), ("截图识字", ficon("system-ocr", 24)),
           ("DeepSeek", site("D", 24)), ("显示桌面", ficon("system-desktop", 24)), ("锁屏", ficon("system-lock", 24))]


def sp2_shell(context, content, foot="⌥⇧ Space 呼出 · ↑↓ 选择 · ↵ 执行 · esc 关闭"):
    """Width fixed at 300; height follows the content (at most 460, then the middle scrolls)."""
    return f'''<section class="win" style="width: 300px; border-radius: 12px">
<header class="row" style="height: 44px; padding: 0 8px 0 12px; gap: 8px; border-bottom: 1px solid var(--border); flex-shrink: 0">{context}<span class="sp"></span>
<button type="button" class="ib" style="width: 26px; height: 26px" aria-label="打开搜索面板">{icon("search", 15)}</button><button type="button" class="ib" style="width: 26px; height: 26px" aria-label="超级面板设置">{icon("gear", 15)}</button></header>
{content}
<footer class="row" style="height: 28px; padding: 0 12px; border-top: 1px solid var(--border); font-size: 11px; color: var(--text-3); flex-shrink: 0">{foot}</footer>
</section>'''


def sp2_context(mark, text):
    return f'<span class="row" style="gap: 8px; min-width: 0">{mark}<span style="font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">{text}</span></span>'


def sp2_grid(pins, add=True, hover=None):
    """「我的面板」: four columns, up to 12. 「＋」 opens the search panel to pin from there."""
    cells = ""
    for i, (name, ic) in enumerate(pins):
        bg = " background: var(--selected);" if i == 0 else (" background: var(--hover);" if i == hover else "")
        cells += f'<span style="height: 70px; border-radius: 9px;{bg} display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; font-size: 11px; text-align: center; white-space: nowrap">{ic}{name}</span>'
    if add:
        cells += f'<span style="height: 70px; border-radius: 9px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; font-size: 11px; color: var(--text-2)"><span class="tile" style="width: 34px; height: 34px; border-radius: 9px; border-style: dashed; background: transparent">{icon("plus", 16)}</span>固定</span>'
    return f'<div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 2px; padding: 8px">{cells}</div>'


def sp2_group(label, rows, first_selected=False):
    """A labelled group of rows. Each row: (mark, title, meta)."""
    out = f'<div style="padding: 4px 6px 2px"><div class="note" style="font-size: 11px; padding: 2px 8px 2px; color: var(--text-3)">{label}</div>'
    for i, (mark, title, meta) in enumerate(rows):
        bg = "background: var(--selected); " if first_selected and i == 0 else ""
        out += f'<span class="row" style="{bg}height: 32px; padding: 0 8px; border-radius: 7px; gap: 10px">{mark}<span style="flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">{title}</span><span class="note" style="font-size: 11px; white-space: nowrap">{meta}</span></span>'
    return out + "</div>"


def sp2_strip(pins):
    """「我的面板」 under context actions: one row of five, icon plus name, never scrolls.
    Four pins and 「全部」, which switches the panel to the full grid."""
    cells = ""
    for name, ic in pins[:4]:
        cells += f'<span style="min-width: 0; height: 50px; border-radius: 8px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px">{ic}<span style="max-width: 100%; font-size: 10.5px; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis">{name}</span></span>'
    cells += f'<span style="min-width: 0; height: 50px; border-radius: 8px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px"><span class="tile" style="width: 24px; height: 24px; border-radius: 6px">{icon("more", 14)}</span><span style="font-size: 10.5px; color: var(--text-2)">全部 {len(pins)}</span></span>'
    return f'<div style="padding: 4px 6px 6px; border-top: 1px solid var(--border)"><div class="note" style="font-size: 11px; padding: 2px 8px 0; color: var(--text-3)">我的面板</div><div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 2px">{cells}</div></div>'


def native_menu(items, at=None, active=0):
    """A macOS context menu, drawn to explain right-click actions."""
    pos = f"position: absolute; left: {at[0]}px; top: {at[1]}px; " if at else ""
    rows = ""
    for i, item in enumerate(items):
        if item == "-":
            rows += '<span style="display: block; height: 1px; margin: 4px 8px; background: var(--border)"></span>'
            continue
        text, key = item if isinstance(item, tuple) else (item, "")
        on = "background: var(--accent); color: var(--on-accent); " if i == active else ""
        rows += f'<span class="row" style="{on}height: 22px; padding: 0 10px; margin: 0 5px; border-radius: 4px; font-size: 13px"><span class="sp">{text}</span><span style="opacity: .6; font-size: 12px">{key}</span></span>'
    return f'<div style="{pos}min-width: 190px; padding: 5px 0; border-radius: 8px; background: var(--surface); box-shadow: 0 10px 30px rgba(0,0,0,.2), 0 0 0 1px var(--border); color: var(--text)">{rows}</div>'


def sp2_board(panel, title, notes, extra="", cursor_at=(300, 50)):
    return f'''<div class="row" style="align-items: flex-start; gap: 36px">{desk_with(panel + extra, cursor_at)}
<div class="col" style="width: 300px; gap: 12px; padding-top: 6px">
<b style="font-size: 15px; font-weight: 500">{title}</b>
{"".join(f'<p class="note">{n}</p>' for n in notes)}
</div></div>'''


# 首页：没有可识别的内容
home = sp2_shell(sp2_context(ficon("superpanel", 22), "我的面板"), sp2_grid(PINS, hover=5))
search_menu = native_menu([("固定到首页", "⌘D"), "固定到超级面板", "-", "从「最近使用」中删除"], active=1)
cell_menu = native_menu(["移到最前", "从超级面板移除"], active=1)
inner = sp2_board(home, "没有可识别的内容时：我的面板", [
    "四列，最多 12 个，顺序与设置里一致；名字用功能的全名（「生成二维码」），和搜索、设置一致。窗口宽 300，高度跟内容走，空位不留白。",
    "<b>怎么固定</b>：主要在搜索面板里，对任意结果（插件功能、网页应用、应用、收藏路径）右键 →「固定到超级面板」：",
    f'</p>{search_menu}<p class="note">',
    "超级面板上有上下文时，对匹配出来的功能右键也能「固定到超级面板」。末尾的「固定」格子打开搜索面板，并提示「右键结果即可固定」。",
    f'右键已固定的格子：</p>{cell_menu}<p class="note">右上角放大镜打开搜索面板，齿轮打开「设置 · 超级面板」。点功能后面板自动关闭；点面板外、esc 也关闭。',
])
boards.append(board("SuperPanelHome", "超级面板 · 我的面板", 1100, 540, inner))

# 访达：选中文件夹
finder = sp2_shell(sp2_context(line_tile("folder", 22), "访达 · 设计稿"),
    sp2_group("匹配的功能", [(ficon("compress", 24), "压缩图片", "13 张")], first_selected=True)
    + sp2_group("文件", [(line_tile("copy", 24), "复制路径", ""), (line_tile("term", 24), "在终端中打开", ""), (line_tile("newfile", 24), "新建空白文件", "未命名.txt"), (line_tile("star", 24), "收藏到快捷启动", "")])
    + sp2_group("自定义动作", [(line_tile("code", 24), "用 VS Code 打开", ""), (line_tile("term", 24), "用 Claude Code 打开", "")])
    + sp2_strip(PINS_SM))
match_menu = native_menu(["固定到超级面板", "-", "插件设置…"], at=(150, 90), active=0)
inner = sp2_board(finder, "访达里选中了文件 / 文件夹", [
    "<b>匹配的功能</b>：和搜索面板拖入文件用同一套规则——各插件清单里的「自动匹配」（文件类型、数量、图片）。文件夹按里面的文件匹配，例如有图片就出现「压缩图片 · 13 张」；「识别二维码」只收一张图片，所以选文件夹时不出现。在插件详情里关掉「自动匹配」的功能不出现。以后装的插件也自动出现，不用改超级面板。",
    "<b>文件</b>：AhaTools 自带的文件操作，各用自己的线条图标；只在适用时出现（新建文件只给单个文件夹，终端要求同一个父目录）。",
    "<b>自定义动作</b>：设置里启用、并且适用于当前类型的命令。",
    "底部是「我的面板」：一行五格，图标下面带名字，不滚动。放前 4 个固定项，第 5 格「全部 N」切换到完整网格（esc 或返回键回到上下文动作）；固定项不超过 5 个时直接全部显示。右键匹配的功能可以固定。",
], extra=match_menu, cursor_at=(300, 30))
boards.append(board("SuperPanelFinder", "超级面板 · 访达选中文件夹", 1100, 540, inner))

# 选中文字
text = sp2_shell(sp2_context(line_tile("globe", 22), "Safari · 选中 37 个字"),
    '<div style="margin: 8px 10px 2px; padding: 8px 10px; border-radius: 8px; background: var(--sunken)"><div style="font-size: 12px; line-height: 1.5; color: var(--text-2); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden">Tauri lets you build smaller, faster, and more secure desktop applications with a web frontend.</div></div>'
    + sp2_group("匹配的功能", [(ficon("translate", 24), "翻译", "点按后翻译"), (ficon("qrcode", 24), "生成二维码", ""), (site("D", 24), "问 DeepSeek", "复制后打开")], first_selected=True)
    + sp2_group("文字", [(line_tile("search", 24), "在搜索面板中打开", ""), (line_tile("copy", 24), "复制为纯文本", "")])
    + sp2_strip(PINS_SM))
inner = sp2_board(text, "任何应用里选中了文字", [
    "顶部灰底显示选中的内容（最多两行），确认读到的是什么。读取方式不变：先用辅助功能接口，读不到再代按 ⌘C 并恢复剪贴板。",
    "<b>匹配的功能</b>：按插件清单的文字匹配（最少字数、正则），例如翻译、生成二维码；每个网页应用一项「问 …」。选中的是网址时多一项「在浏览器中打开」。",
    "<b>文字</b>：带进搜索面板（等于在搜索框粘贴，所有匹配都能用）、复制为纯文本。",
    "<b>不会自动翻译</b>：呼出面板时不发任何请求，选中的文字也不会发给翻译服务。点「翻译」或选中它按 ↵ 才开始；本版进入翻译页并带入文字，第二步再把结果直接显示在面板里，同样是点了才翻译。",
])
boards.append(board("SuperPanelText", "超级面板 · 选中文字", 1100, 540, inner))

# 设置
def sp2_pin_cell(name, ic, hover=False):
    badge = f'<span style="position: absolute; top: 3px; right: 3px; width: 16px; height: 16px; border-radius: 8px; background: var(--surface); box-shadow: 0 0 0 1px var(--border-strong); color: var(--text-2); display: flex; align-items: center; justify-content: center">{icon("x", 10, 2)}</span>' if hover else ""
    bg = " background: var(--hover);" if hover else ""
    return f'<span style="position: relative; height: 70px; border-radius: 9px;{bg} display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; font-size: 11px; white-space: nowrap">{ic}{name}{badge}</span>'


pin_cells = "".join(sp2_pin_cell(n, ic, hover=(i == 2)) for i, (n, ic) in enumerate(PINS))
pin_cells += f'<span style="height: 70px; border-radius: 9px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; font-size: 11px; color: var(--text-2)"><span class="tile" style="width: 34px; height: 34px; border-radius: 9px; border-style: dashed; background: transparent">{icon("plus", 16)}</span>添加</span>'
cmd = "osascript -e 'on run argv' -e 'tell application &quot;Terminal&quot;' …"
detail = f'''<div class="detail" style="gap: 12px; overflow: hidden">
<div><h1 style="margin: 0; font-family: var(--serif); font-size: 22px; font-weight: 500">超级面板</h1><p class="note" style="margin-top: 2px">在鼠标旁边处理选中的文字和文件</p></div>
<div class="card" style="padding: 0 14px">
<div class="srow" style="min-height: 52px"><span class="st"><b>呼出热键</b><span>面板出现在鼠标旁边</span></span><span class="btn mono" style="min-width: 100px; font-size: 12px">⌥⇧ Space</span><span class="sw on"><i></i></span></div>
<div class="srow" style="min-height: 52px"><span class="st"><b>长按鼠标右键呼出</b><span>按住约 0.4 秒；短按和右键拖动不受影响</span></span><span class="sw on"><i></i></span></div>
<div class="srow" style="min-height: 52px"><span class="st"><b>匹配的功能</b><span>按各插件的「自动匹配」开关决定是否出现</span></span><button type="button" class="btn sm">在已安装插件中管理</button></div>
</div>
<span class="row" style="margin-top: 2px"><span class="lbl">我的面板</span><span class="sp"></span><span class="note">{len(PINS)} / 12 · 拖动排序</span></span>
<div class="card" style="display: grid; grid-template-columns: repeat(8, 1fr); gap: 2px; padding: 6px">{pin_cells}</div>
<p class="note" style="margin-top: -4px">也可以在搜索结果上右键「固定到超级面板」。悬停格子出现 × 移除。</p>
<span class="row" style="margin-top: 2px"><span class="lbl">自定义动作</span><span class="sp"></span><button type="button" class="btn sm">{icon("plus", 13)}新建动作</button></span>
<div class="card" style="padding: 0 14px">
<div class="srow" style="min-height: 52px; gap: 12px"><span class="st" style="min-width: 0"><b style="font-size: 13px">用 VS Code 打开</b><span class="mono" style="font-size: 11px">code {{path}}</span></span><span class="chip">文件 · 文件夹 · 图片</span><span class="sw sm on"><i></i></span><button type="button" class="ib" style="width: 24px; height: 24px" aria-label="更多">{icon("more", 15)}</button></div>
<div class="srow" style="min-height: 52px; gap: 12px"><span class="st" style="min-width: 0"><b style="font-size: 13px">用 Claude Code 打开</b><span class="mono" style="font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">{cmd}</span></span><span class="chip">文件夹</span><span class="sw sm"><i></i></span><button type="button" class="ib" style="width: 24px; height: 24px" aria-label="更多">{icon("more", 15)}</button></div>
</div>
</div>'''
sp_settings = settings("", detail, nav_on="超级面板").replace('<span class="i">全局热键</span>', '<span class="i">全局热键</span>\n<span class="i on">超级面板</span>', 1)
boards.append(board("SuperPanelSettings", "设置 · 超级面板", 880, 580, sp_settings))

# ---- 超级面板首版补充 ----
boards.append(board("SuperPanelCommand", "超级面板 · 编辑动作", 880, 580, settings("", '''<div class="detail" style="gap:16px"><h1 style="font-family:var(--serif);font-weight:500">编辑动作</h1><label>名称<input value="用 VS Code 打开"></label><label>命令<textarea class="mono" style="height:120px">code {path}</textarea></label><p class="note">占位符单独作为参数，不要加引号。支持 {path}、{dir}、{text}、{name}。</p><div class="row">适用于：文件 · 文件夹 · 图片</div><div class="row"><button class="btn a">保存动作</button><button class="btn">取消</button></div><p class="note">命令后台执行；需要长期运行时，请让命令打开终端。</p></div>''', nav_on="超级面板")))
boards.append(board("OcrResult", "截图识字 · 结果", 880, 580, page(880, 580, "ocr", "截图识字", "系统动作", "", '''<div class="body"><div class="col" style="width:100%;gap:16px"><div class="row"><span class="note">已复制识别文字 · 全程在本机完成</span><span class="sp"></span><button class="btn">重新截图</button><button class="btn a">复制全部</button></div><textarea style="flex:1;resize:none;padding:16px;font-size:14px;line-height:1.8">AhaTools 让常用工具触手可及。
Build something useful.</textarea></div></div>''', "Esc 返回搜索 · ⌘C 复制文字", "本机识别")))
boards.append(board("SuperPanelUnavailable", "超级面板 · 暂无依赖插件", 1100, 540, desk_with(sp_shell(chip("我的面板", "star"), sp_grid([("截图","shot"),("二维码","qr"),("取色","drop"),("截图识字","ocr"),("DeepSeek","D"),("显示桌面","desk"),("锁屏","lock2"),("添加","plus")])))))

# ---- 功能图标 ----
# Two directions on one board. A (default, written to src/assets/icons): a luminous
# gradient tile with a fine top highlight and a two-tone white glyph. B: a tinted tile
# with the glyph in the feature colour, drawn with currentColor so it follows the theme.
# Glyphs sit on a 24-unit grid: "fill" parts are the soft second tone, "line" parts the
# 1.8px outline.
FEATURE_ICONS = [
    ("images", "图片工具", "#548C9A", '<rect x="3.5" y="4" width="17" height="16" rx="2"></rect>', '<rect x="3.5" y="4" width="17" height="16" rx="2"></rect><circle cx="8.5" cy="9" r="1.5"></circle><path d="M4 17l5-5 3 3 3-4 5 6"></path>'),
    ("images-save", "保存图片为 PNG", "#548C9A", '<path d="M4 14h16v6H4z"></path>', '<path d="M12 3v12m-4-4 4 4 4-4M4 15v5h16v-5"></path>'),
    ("images-copy", "复制图片", "#548C9A", '<rect x="8" y="8" width="13" height="13" rx="2"></rect>', '<rect x="8" y="8" width="13" height="13" rx="2"></rect><path d="M15 8V3H3v12h5"></path>'),
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
    ("processes", "进程管理", "#5F8A3E", '<rect x="4" y="4" width="16" height="16" rx="2.5"></rect>', '<rect x="4" y="4" width="16" height="16" rx="2.5"></rect><path d="M8 9h8M8 12h5M8 15h7"></path>'),
    ("network", "网络工具", "#2F7FB5", '<circle cx="12" cy="13" r="7.5"></circle>', '<path d="M4.5 10.5a10.5 10.5 0 0 1 15 0M7.5 13.5a6.3 6.3 0 0 1 9 0"></path><circle cx="12" cy="17" r="1.2"></circle>'),
    ("json", "JSON 工具", "#8A7230", '<rect x="8.5" y="8" width="7" height="8" rx="1.5"></rect>', '<path d="M9 4H8a2 2 0 0 0-2 2v3.5a2.5 2.5 0 0 1-2 2.5 2.5 2.5 0 0 1 2 2.5V18a2 2 0 0 0 2 2h1M15 4h1a2 2 0 0 1 2 2v3.5a2.5 2.5 0 0 0 2 2.5 2.5 2.5 0 0 0-2 2.5V18a2 2 0 0 1-2 2h-1"></path>'),
    ("clipboard", "剪贴板历史", "#946B4A", '<rect x="5" y="5" width="14" height="16" rx="2.5"></rect>', '<rect x="5" y="5" width="14" height="16" rx="2.5"></rect><path d="M9 5V3.5h6V5M9 11h6M9 15h4"></path>'),
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


if len(sys.argv) > 2 and not STATIC:
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

# ---- 进程管理（优化计划阶段 C） ----
def proc_row(name, mark, count, cpu, mem, level="", selected=False, child=False, locked=False):
    color = {"bad": "var(--bad)", "warn": "var(--warn)"}.get(level, "var(--text)")
    bg = "background: var(--selected);" if selected else ""
    pad = "padding-left: 46px;" if child else ""
    tile = "" if child else f'<span class="tile sm">{mark}</span>'
    acts = ('<span class="row" style="gap: 6px"><button type="button" class="btn sm">退出</button><button type="button" class="btn sm g" style="color: var(--bad)">强制结束</button></span>'
            if selected else (f'<span class="note" title="属于系统">{icon("lock", 13)}</span>' if locked else ""))
    sub = f'<span class="note" style="font-size: 11px">{count}</span>' if count else ""
    return (f'<tr style="{bg}"><td style="{pad}"><span class="row" style="gap: 10px">{tile}<span style="display: flex; flex-direction: column">'
            f'<span>{name}</span>{sub}</span></span></td><td class="mono" style="color: {color}; text-align: right">{cpu}</td>'
            f'<td class="mono" style="text-align: right">{mem}</td><td style="text-align: right">{acts}</td></tr>')
rows = "".join([
    proc_row("Google Chrome", "G", "▾ 23 个进程", "86.4%", "3.1 GB", "warn", selected=True),
    proc_row("Google Chrome Helper (Renderer)", "", "", "61.2%", "820 MB", "warn", child=True),
    proc_row("Google Chrome", "", "", "14.8%", "410 MB", child=True),
    proc_row("WindowServer", icon("cpu", 13), "系统进程", "32.5%", "118 MB", locked=True),
    proc_row("微信", "微", "4 个进程", "6.1%", "1.4 GB"),
    proc_row("Visual Studio Code", "V", "12 个进程", "3.8%", "1.9 GB"),
    proc_row("node", icon("term", 13), "/opt/homebrew/bin/node", "2.2%", "240 MB"),
])
body = f'''<div class="body" style="flex-direction: column; gap: 14px">
<span class="row" style="gap: 12px"><span class="sel" style="width: 300px; justify-content: flex-start; color: var(--text-3)">{icon("search", 14)}筛选应用、进程或 PID</span><span class="sp"></span>
<span class="note">CPU 合计 <b class="mono" style="color: var(--text)">38%</b>（10 核）</span><span class="note">内存 <b class="mono" style="color: var(--text)">12.4 / 16 GB</b> · 压力正常</span></span>
<table><thead><tr><th>名称</th><th style="width: 90px; text-align: right">CPU ▾</th><th style="width: 90px; text-align: right">内存</th><th style="width: 190px"></th></tr></thead><tbody>
{rows}</tbody></table>
</div>'''
boards.append(board("Processes", "进程管理", 880, 580, page(880, 580, "cpu", "进程管理", "系统 · 每 2 秒刷新", '<span class="seg"><span class="on">按应用</span><span>全部进程</span></span>', body,
    "↑↓ 选择 · → 展开 · ⌘⌫ 退出 · ⌥⌘⌫ 强制结束", "418 个进程")))
confirm = '''<section class="win" style="width: 880px; padding: 16px 20px"><span class="row" style="gap: 12px"><span style="color: var(--bad)">强制结束「Google Chrome」及 23 个进程？</span><span class="note">未保存的内容会丢失；普通退出会让应用先询问保存。</span><span class="sp"></span><button type="button" class="btn sm">取消</button><button type="button" class="btn sm" style="color: var(--bad); border-color: var(--bad)">强制结束</button></span></section>'''
boards.append(board("ProcessesConfirm", "进程管理 · 强制结束确认（页面底部）", 880, 70, confirm))

# ---- 场景匹配（优化计划阶段 D） ----
def search_win(query, rows, foot_left, foot_right, chip=""):
    out = ""
    for mark, title, sub, key, on in rows:
        bg = "background: var(--selected);" if on else ""
        out += (f'<div class="row" style="height: 50px; padding: 0 12px; border-radius: 8px; {bg}">{mark}<span style="flex: 1; display: flex; flex-direction: column">'
                f'<span>{title}</span><span class="note" style="font-size: 11px">{sub}</span></span><span class="note mono">{key}</span></div>')
    head = chip + (f'<span style="font-size: 18px">{query}</span>' if query else '<span style="font-size: 18px; color: var(--text-3)">筛选适用功能</span>')
    return f'''<section class="win" style="width: 520px; height: 400px">
<header class="row" style="height: 58px; padding: 0 18px; gap: 12px; border-bottom: 1px solid var(--border)">{icon("search", 18) if not chip else ""}{head}</header>
<div style="flex: 1; padding: 8px">{out}</div>
<footer class="foot"><span>{foot_left}</span><span>{foot_right}</span></footer></section>'''
fi = lambda key: ficon(key, 30)
url_rows = [(fi("launcher"), "在浏览器中打开「https://example.com/docs」", "快捷启动 · 适用于网址", "↵ 打开", True),
            (fi("qrcode"), "为「https://example.com/docs」生成二维码", "二维码", "⌘2", False),
            (fi("translate"), "翻译", "翻译 · 「https://example.com/docs」", "⌘3", False)]
miss_rows = [(fi("qrcode"), "为「zzqqxx」生成二维码", "二维码 · 「zzqqxx」", "↵ 打开", True),
             (fi("translate"), "翻译", "翻译 · 「zzqqxx」", "⌘2", False),
             (f'<span class="tile">{icon("search", 15)}</span>', "在网上搜索「zzqqxx」", "google.com · 用默认浏览器打开", "⌘3", False),
             (site("D", 30), "问 DeepSeek", "复制后打开，粘贴即可提问", "⌘4", False),
             (fi("launcher"), "收藏「zzqqxx」", "快捷启动 · 收藏一个路径或网址", "⌘5", False)]
chip = f'<span class="chip" style="height: 30px; gap: 6px">{icon("img", 13)}{{ "name": "AhaT… · 40 字<span style="margin-left: 4px">×</span></span>'
json_rows = [(fi("json"), "格式化 JSON", "JSON 工具 · 适用于 JSON", "↵ 打开", True), (fi("qrcode"), "生成二维码", "二维码", "⌘2", False), (fi("translate"), "翻译", "翻译", "⌘3", False)]
inner = f'''<div class="row" style="align-items: flex-start; gap: 28px">
<div class="col" style="gap: 8px"><span class="note">刚复制网址，5 秒内按 ⌥Space：自动填入，适用于网址的功能排最前</span>{search_win("https://example.com/docs", url_rows, "↑↓ 选择 · ⌘1–9 直接打开", "3 个结果")}</div>
<div class="col" style="gap: 8px"><span class="note">复制多行 JSON：作为附件，退格或 esc 移除</span>{search_win("", json_rows, "方向键 选择 · ↵ 打开 · esc 移除内容", "3 个匹配功能", chip)}</div>
<div class="col" style="gap: 8px"><span class="note">没有名称匹配：追加网上搜索、问网页应用、收藏</span>{search_win("zzqqxx", miss_rows, "↑↓ 选择 · ⌘1–9 直接打开", "没有名称匹配的结果 · 可在网上搜索")}</div>
</div>'''
boards.append(board("SceneMatching", "搜索面板 · 场景匹配", 1620, 440, inner))

# ---- 网络工具与 JSON（优化计划阶段 E） ----
def net_tabs(on):
    return '<span class="seg">' + "".join(f'<span class="{"on" if t == on else ""}">{t}</span>' for t in ["本机 IP", "Ping", "DNS 查询", "端口占用"]) + "</span>"
def net_row(label, value, kind=""):
    return (f'<div class="row" style="height: 40px; padding: 0 8px; border-bottom: 1px solid var(--border)"><span style="width: 180px">{label}</span>'
            f'<span class="mono" style="flex: 1">{value}</span><span class="note">{kind}</span><span class="ib" style="width: 26px; height: 26px">{icon("copy", 14)}</span></div>')
ip_body = f'''<div class="body" style="flex-direction: column; gap: 10px">
<span class="row"><b class="note" style="font-weight: 500">本机地址</b><span class="sp"></span><span class="btn g sm">刷新</span></span>
<div style="border-top: 1px solid var(--border)">{net_row('Wi-Fi <span class="note">· en0</span>', "192.168.1.23", "IPv4")}{net_row('Wi-Fi <span class="note">· en0</span>', "2408:8207:6c40:1d0::a1", "IPv6")}{net_row('VPN <span class="note">· utun4</span>', "198.18.0.1", "IPv4")}{net_row('默认网关 <span class="note">· en0</span>', "192.168.1.1")}</div>
<b class="note" style="font-weight: 500; margin-top: 6px">公网 IP</b>
<div class="row" style="padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px"><span class="note" style="flex: 1">点按查询，会向 api.ipify.org 发送一次请求</span><span class="btn sm">查询公网 IP</span></div>
</div>'''
bars = "".join(f'<i style="display:block;width:14px;height:{h}%;border-radius:3px 3px 0 0;background:color-mix(in srgb,var(--accent) 70%,transparent)"></i>' for h in [72, 88, 64, 96, 70, 80, 61])
ping_body = f'''<div class="body" style="flex-direction: column; gap: 12px">
<span class="row"><span class="sel mono" style="flex: 1">github.com</span><span class="btn">停止</span></span>
<span class="row" style="gap: 28px">{"".join(f'<span style="display:flex;flex-direction:column"><span class="note" style="font-size:11px">{k}</span><span style="font-size:15px">{v}</span></span>' for k, v in [("已发送", "7"), ("收到", "6"), ("丢包", '<span style="color: var(--warn)">14.3%</span>'), ("平均", "39.2 ms"), ("最快 / 最慢", "29.4 / 46.9 ms")])}</span>
<span class="row" style="align-items: flex-end; gap: 4px; height: 48px">{bars}</span>
<pre class="mono" style="margin: 0; flex: 1; padding: 10px 12px; border-radius: 8px; background: var(--sunken); font-size: 11.5px; line-height: 1.6">PING github.com (140.82.112.3): 56 data bytes
64 bytes from 140.82.112.3: icmp_seq=0 ttl=52 time=38.000 ms
Request timeout for icmp_seq 1
64 bytes from 140.82.112.3: icmp_seq=2 ttl=52 time=46.184 ms</pre></div>'''
boards.append(board("Network", "网络工具 · 本机 IP 与 Ping", 1820, 580, f'<div class="row" style="align-items: flex-start; gap: 40px">{page(880, 580, "globe", "本机 IP", "网络工具", net_tabs("本机 IP"), ip_body, "esc 返回搜索", "")}{page(880, 580, "globe", "Ping", "网络工具", net_tabs("Ping"), ping_body, "esc 返回搜索", "")}</div>'))
json_body = '''<div class="body" style="flex-direction: column; gap: 12px">
<span class="row" style="gap: 16px"><span class="seg"><span class="on">格式化</span><span>压缩</span><span>转义</span><span>去转义</span></span><span class="sel">2 个空格</span><span class="note">键名排序</span><span class="sw sm"><i></i></span><span class="note">树形查看</span><span class="sw sm"><i></i></span></span>
<div class="row" style="flex: 1; align-items: stretch; gap: 12px">
<pre class="mono" style="flex: 1; margin: 0; padding: 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); font-size: 12px">{
  "name": "AhaTools"
  "version": 1
}</pre>
<div style="flex: 1; padding: 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); display: flex; flex-direction: column; gap: 8px; align-items: flex-start"><span style="color: var(--bad)">第 3 行第 3 列：缺少逗号：上一项后面需要逗号</span><span class="btn sm">定位到出错处</span></div>
</div></div>'''
boards.append(board("Json", "JSON 工具 · 格式错误定位", 880, 580, page(880, 580, "code", "格式化 JSON", "JSON 工具", '<span class="btn sm">复制结果</span>', json_body, "esc 返回搜索", "⌘C 复制结果")))

# ---- 剪贴板历史（优化计划阶段 F） ----
def clip_row(mark, name, meta, on=False, pin=False):
    bg = "background: var(--selected);" if on else ""
    tag = '<span class="chip">固定</span>' if pin else ""
    return (f'<div class="row" style="height: 46px; padding: 0 8px; border-radius: 6px; {bg}"><span class="tile sm">{icon(mark, 13)}</span>'
            f'<span style="flex: 1; display: flex; flex-direction: column; min-width: 0"><span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis">{name}</span>'
            f'<span class="note" style="font-size: 11px">{meta}</span></span>{tag}</div>')
clip_rows = "".join([
    clip_row("code", "ssh deploy@10.0.3.21 -p 2222", "终端 · 12:38", pin=True),
    clip_row("globe", "https://github.com/tauri-apps/tauri/releases", "Safari · 刚刚", on=True),
    clip_row("img", "图片 · 1280 × 720", "截图 · 10 分钟前"),
    clip_row("folder", "首页.png 等 2 个文件", "访达 · 昨天 17:38"),
])
clip_body = f'''<div class="body" style="flex-direction: column; gap: 12px">
<span class="row" style="gap: 12px"><span class="sel" style="width: 260px; justify-content: flex-start; color: var(--text-3)">{icon("search", 14)}搜索复制过的内容</span><span class="seg"><span class="on">全部</span><span>文字</span><span>图片</span><span>文件</span></span></span>
<div class="row" style="flex: 1; align-items: stretch; gap: 16px">
<div style="flex: 5; border-top: 1px solid var(--border)">{clip_rows}</div>
<div style="flex: 6; display: flex; flex-direction: column; gap: 12px"><div style="flex: 1; padding: 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); display: flex; flex-direction: column"><span style="flex: 1">https://github.com/tauri-apps/tauri/releases</span><span class="note">来自 Safari · 刚刚 · 44 字</span></div>
<span class="row" style="gap: 8px"><span class="btn p sm">粘贴</span><span class="btn sm">{icon("copy", 13)}复制</span><span class="btn g sm">固定</span><span class="btn g sm" style="color: var(--bad)">删除</span></span></div>
</div></div>'''
intro = '''<div class="body" style="align-items: center; justify-content: center"><div style="max-width: 460px; padding: 24px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); display: flex; flex-direction: column; gap: 12px">
<b style="font-family: var(--serif); font-size: 20px; font-weight: 500">记下复制过的内容</b>
<p class="note">开启后，复制的文字、图片和文件会保存在这台 Mac 上，可以搜索后再次粘贴。</p>
<p class="note">· 内容不加密地保存在 AhaTools 数据目录，只有你的账户能读取，不会上传。<br>· 1Password、钥匙串等密码管理器复制的内容和标记为隐私的复制不会保存。<br>· 默认最多 500 条、保留 30 天，固定的记录不受限制；随时可以暂停或清空。</p>
<span class="row"><span class="btn p">开启剪贴板历史</span><span class="btn g">设置</span></span></div></div>'''
actions = '<span class="btn g sm">暂停记录</span><span class="btn g sm">清空</span><span class="btn g sm">设置</span>'
boards.append(board("ClipboardHistory", "剪贴板历史 · 列表与首次开启", 1820, 580, f'<div class="row" style="align-items: flex-start; gap: 40px">{page(880, 580, "copy", "剪贴板历史", "剪贴板历史", actions, clip_body, "esc 返回搜索", "↵ 粘贴 · ⌘C 复制 · ⌘P 固定 · ⌘⌫ 删除")}{page(880, 580, "copy", "剪贴板历史", "默认关闭，开启前说明保存方式", "", intro, "esc 返回搜索", "")}</div>'))

# ---- canvas.json ----
if STATIC:
    print("\n".join(b["file"] for b in boards))
    sys.exit(0)

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
