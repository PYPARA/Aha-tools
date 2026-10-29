# AhaTools 后续功能实现规格

写给接手实现的人（或 AI）。2026-10-29 写定。先读 [HANDOFF.md](HANDOFF.md) 的「接手指南」和「关键约束和坑」，再读 [design-system.md](design-system.md)，然后按本文的顺序一项一项做。

- **设计稿**：每项的界面在 [docs/design/](design/) 下有静态 HTML（浏览器直接打开，浅色、深色并排）。claude.ai 上的画布只有作者能看，以本目录为准。改设计时改 [docs/design/gen_boards.py](design/gen_boards.py) 再重新生成。
- **做法**：一项做完再做下一项；每项都要单元测试、`bun run build` 通过、在浏览器预览（`src/dev-mock.ts` 补假数据）核对浅色和深色，最后更新 HANDOFF 的状态表。
- **提交**：Conventional Commits + emoji，例如 `✨ feat(qrcode): …`；文档单独提交 `📝 docs: …`。
- **不做**：自研截图（截图交给系统 / 微信 / QQ，已有热键路由）。

## 通用做法（每个插件都一样）

现有代码就是范例，照着抄：网页应用插件（`plugins/webapps/`、`src-tauri/src/webapps.rs`、`src-tauri/src/plugins/webapps.rs`）是最完整的一份。

1. **清单**：`plugins/<id>/plugin.json`：`id`、`name`、`version`、`description`、`features[]`（`code`、`explain`、`cmds` 关键词、可选 `match`）。在 `src-tauri/src/plugins/mod.rs` 的 `BUILTIN_MANIFESTS` 里加 `include_str!`。
2. **页面**：`plugins/<id>/<View>.tsx`，只从 `@ahatools/sdk` 引入；在 `src/views.ts` 的 `views` 里登记 `"<id>/<code>"`，`pluginIcons` 里登记图标（图标写在 `src/ui.tsx`，线条 1.6px）。页面拿到 `PluginViewProps`：`onBack`、`setStatus`（写底栏右侧）、`input`（从搜索框带入的文字，例如 `qr hello` 的 `hello`，或 `match` 命中的整段输入）。标题栏右侧按钮用 `<PageActions>`。
3. **插件设置**：写 `plugins/<id>/Settings.tsx`（拿到 `cfg`、`save`），登记到 `src/views.ts` 的 `pluginSettings`，会出现在 设置 → 已安装插件 → 该插件 →「设置」页签。
4. **不需要页面的功能**：登记到 `src/views.ts` 的 `actions`（例：`screenshot/take`）。
5. **配置**：加到 `src-tauri/src/config.rs` 的 `Config`（结构体整体有 `#[serde(default)]`，旧文件能读）并在 `Default` 里给默认值，同步 `src/config.ts` 的类型；补「旧配置能读」的测试。密钥一律存钥匙串，不进 config.json。
6. **原生能力**：Rust 模块 + `#[tauri::command]`，在 `src-tauri/src/lib.rs` 的 `generate_handler!` 里注册。耗时命令写成 `async`。调用系统工具优先用 macOS 自带命令（项目里已有 `sips`、`curl`、`screencapture`、`osascript`、`lsappinfo` 的用法）。
7. **热键**：能被热键触发的功能用 `hotkey::Action::OpenFeature`（插件详情的「设为热键」已经支持），特殊的才新增 `Action` 变体（参考 `OpenWeb`），并在 `plugins/settings/actions.ts` 的 `describeAction` / `actionChoices` 里补文案。
8. **文案**：中文，短句，说清楚会发生什么；不出现 aha 小写名，统一 AhaTools。

## 1. 二维码

设计：[QrGenerate.html](design/QrGenerate.html)、[QrScan.html](design/QrScan.html)。

- **插件**：`plugins/qrcode/`，两个功能：
  - `generate`「生成二维码」，`cmds: ["二维码", "qr", "qrcode"]`，`match: { text: true, minLength: 1 }`，任意文字都能在结果末尾出现「为『…』生成二维码」；
  - `scan`「识别二维码」，`cmds: ["识别二维码", "扫码", "scan"]`。
- **生成**：npm `qrcode`（`toString(text, { type: "svg", errorCorrectionLevel, margin: 1 })`）。左边 textarea（初值 = `input`），右边 300px 预览，白底黑码，深色模式也是白底；容错 低/中/较高/高 = L/M/Q/H，默认 M。
  - 「复制图片」：前端用 canvas 画 PNG，再用 `@tauri-apps/plugin-clipboard-manager` 的 `writeImage` 写剪贴板（已有权限 `clipboard-manager:allow-write-image`）。
  - 「保存 PNG…」：`@tauri-apps/plugin-dialog` 的 `save()`，加一个 Rust 命令 `qr_save_png(path, bytes)` 写文件。调用对话框时包 `withPinned`，否则面板失焦会隐藏。
  - ⌘C 复制图片。
- **识别**：进入页面就读剪贴板图片（`readImage()` → RGBA），用 npm `jsqr` 解码。成功时在图上框出位置（jsqr 返回四个角点）。网址显示「在浏览器中打开」（`openPath`），其他文字只复制。剪贴板没图时显示提示，并支持把图片拖进窗口（Tauri 窗口拖放事件拿到文件路径，用 Rust 读文件成字节）。
- **验收**：`qr hello` → 生成页带入 hello；复制后能在微信里粘贴出二维码图片；截一张含二维码的图后进入识别，能读出内容。

## 2. 翻译

设计：[TranslateText.html](design/TranslateText.html)、[TranslateWord.html](design/TranslateWord.html)、[TranslateSettings.html](design/TranslateSettings.html)。

- **插件**：`plugins/translate/`，功能 `translate`「翻译」，`cmds: ["翻译", "fy", "translate"]`，`match: { text: true, minLength: 2 }`（插件详情「自动匹配」页签可关）。
- **配置**：`config.translate = { provider: "deepseek" | "openai" | "custom", baseUrl, model, direction: "auto" }`。默认 DeepSeek：`https://api.deepseek.com/v1`、`deepseek-chat`。API key 用 `keyring` crate 存钥匙串（service `com.ahatools.app`，account `translate`），提供命令 `translate_set_key(key)` / `translate_has_key()`，前端只显示掩码。
- **后端**：`src-tauri/src/plugins/translate.rs`，命令 `translate_start(id, text, mode)`。
  - 用 `reqwest`（`rustls-tls`、`stream`）POST `{baseUrl}/chat/completions`，`stream: true`，解析 SSE 的 `data:` 行。
  - 每段文字 `emit("translate-chunk", { id, delta })`，结束 `translate-done`，出错 `translate-error`；`translate_stop(id)` 能中止。
  - 提示词按模式：翻译（自动方向：含中文就译英文，否则译中文）、润色、解释。
  - 只有一个英文单词时，要求模型输出 JSON：音标、词性、释义、例句（英文 + 中文）、近义词，前端按单词版式显示。
- **前端**：段落版左原文右译文，译文流式追加，有光标；底部显示模型名和「停止 / 复制译文」。输入停止 400ms 后自动翻译，⌘↵ 立即重新翻译。
- **设置页签**：服务、接口地址、模型、API Key（更换）、默认方向、「测试连接」（发一个极短请求，显示首字耗时或错误原文）。
- **验收**：粘贴一段英文，搜索结果末尾出现「翻译」，进入后流式出中文；没填 key 时页面提示去设置，不报错；key 不出现在 config.json 里。

## 3. 图片压缩

设计：[Compress.html](design/Compress.html)。流程参考 uTools：**先压到临时目录，原图不动，再由用户决定**覆盖原图、另存到原目录或复制。

- **插件**：`plugins/compress/`，功能 `compress`「压缩图片」，`cmds: ["压缩", "图片压缩", "compress", "tinypng"]`，`match: { files: ["png", "jpg", "jpeg", "webp"] }`。
- **入口**：
  - 拖文件到搜索面板：面板监听窗口拖放事件，把路径交给 `match.files` 命中的功能，`input` 传路径数组的 JSON；
  - 页面内拖入或「选择文件…」；
  - 超级面板「压缩目录下所有图片」（见第 4 项）。文件夹只取第一层，不递归。
- **后端**：`src-tauri/src/plugins/compress.rs`，命令 `compress_start(batch_id, paths, quality, to_webp)`，用 rayon 并行。
  - PNG：`imagequant`（有损，GPL，自用可以）+ `oxipng`；JPEG：`mozjpeg`；WebP：`webp` crate。
  - 输出到 `~/Library/Caches/com.ahatools.app/compress/<batch_id>/` 同名文件。
  - 每张完成 `emit("compress-progress", { batchId, path, before, after, status })`。
  - 不支持的格式（svg、gif）标「跳过」；压完反而更大的，保留原图并标「已是最小」。
- **结果操作**：
  - **覆盖原图**：先确认，再把临时文件拷回原路径；
  - **另存到原目录**：`name.min.ext`；
  - **复制所有 ⌘C**：把临时文件作为文件列表写进剪贴板。需要 Rust 用 NSPasteboard 写 `NSFilenamesPboardType` / file URLs，`objc2-app-kit`；或者先用 `osascript` 的 `set the clipboard to {POSIX file "…", …}`。
  - 每行的复制按钮复制单张。
- **历史**：顶部分段控件显示最近几批（「2 分钟前 · 13 张」），只保留本次运行期间的，临时目录在应用启动时清空。
- **验收**：拖入 10 张 PNG，逐行出进度，原文件修改时间不变；点「复制所有」后在访达里 ⌘V 能粘贴出压缩后的文件。

## 4. 超级面板（参考 uTools）

设计：[SuperPanelHome.html](design/SuperPanelHome.html)、[SuperPanelFinder.html](design/SuperPanelFinder.html)、[SuperPanelText.html](design/SuperPanelText.html)、[SuperPanelSettings.html](design/SuperPanelSettings.html)。

**是什么**：在鼠标旁边弹出的小面板（300×460），按当前上下文列出能做的事：
- 访达里选中了文件或文件夹 → 文件动作；
- 任何应用里选中了文字 → 文字动作；
- 都没有 → 「我的面板」九宫格。

点完自动关闭，点面板外关闭，esc 关闭。

### 窗口和呼出

- **窗口**：新窗口 label `super`，加载 `index.html?view=super`（`src/main.tsx` 路由到新组件 `src/SuperPanel.tsx`）。透明、无边框、置顶、失焦隐藏，照 `src-tauri/src/popover.rs` 的写法，新文件 `src-tauri/src/superpanel.rs`；加入 `capabilities/default.json` 的 `windows`。
- **位置**：用 `app.cursor_position()` 取鼠标位置，面板左上角放在鼠标右下方 8pt 处，并夹在鼠标所在屏幕内（参考 `popover::toggle` 的夹取）。
- **热键**：新增 `hotkey::Action::SuperPanel`，默认绑定 `Alt+Shift+Space`（启用）。`dispatch` 里先读上下文，再显示面板（顺序重要：面板一显示，最前面的应用就变成 AhaTools 了）。
- **长按鼠标右键（设置里开关，默认关）**：在 `src-tauri/src/hotkey/tap.rs` 的事件拦截里加右键按下 / 抬起（事件类型 3 / 4）。
  - 按下时先吞掉并记时间；
  - 400ms 内抬起：用 `CGEventCreateMouseEvent` 在原位置补发一次右键按下 + 抬起（带 `SYNTHETIC_MARK`，让拦截放行），普通右键菜单照常出现；
  - 按满 400ms：弹出超级面板，并吞掉之后的抬起。
  - 需要「辅助功能」权限，已有。

### 读上下文（`src-tauri/src/context.rs`）

```rust
pub struct Context { app_name: String, bundle_id: String, kind: Kind /* None | Files | Text */, paths: Vec<String>, dir: Option<String>, text: Option<String> }
```

- **最前面的应用**：`lsappinfo front` 得到 ASN，再 `lsappinfo info -only bundleid,name <asn>`（`relay.rs` 有解析 lsappinfo 的例子）。
- **访达**（`com.apple.finder`）：用 `osascript` 读选中项。
  ```applescript
  tell application "Finder" to set s to selection as alias list
  ```
  - 逐个取 POSIX path；
  - 没选中时取 `target of front Finder window`，没有窗口时取桌面；
  - `dir` = 选中的是文件夹时用它自己，否则用它的上级目录。
  - 第一次会弹「AhaTools 想要控制访达」的授权框，要在文档里提示；被拒绝时退回「我的面板」。
- **选中文字**（非访达）：
  1. 先用辅助功能接口读焦点元素的 `kAXSelectedTextAttribute`（`AXUIElementCreateSystemWide` → `kAXFocusedUIElementAttribute` → 选中文字），不碰剪贴板；
  2. 读不到再模拟 ⌘C（`tap::post_shortcut`）：记下剪贴板的 changeCount，等 150ms；有变化就读文字，然后把原来的文字内容写回去。原来是图片时无法恢复，这一点写进已知问题。
- **网址**：文字是网址时 `kind` 仍为 Text，动作里多「在浏览器中打开」。

### 动作

- **内置动作**（Rust 返回动作列表给前端，前端只负责显示和回调 `superpanel_run(action_id)`）：
  - **文件夹**：压缩目录下所有图片（显示张数；打开压缩页面并带入路径）、复制路径、在终端中打开（`open -a Terminal <dir>`）、新建文件…（在 dir 里建「未命名.txt」，重名时加序号，然后在访达中选中它）、收藏到快捷启动（`launcher_add`）。
  - **图片文件**：再多压缩图片、识别二维码（读文件）。
  - **任何文件**：复制路径、在终端中打开（所在目录）、收藏到快捷启动。
  - **文字**：
    - 翻译：面板顶部直接流式显示结果，复用 `translate_start`；「展开」进入翻译页面；
    - 问网页应用：每个网页应用一项。先把文字写进剪贴板，再 `webapps::open`，然后提示「已复制，粘贴即可」；不往网页注入脚本；
    - 生成二维码；
    - 在搜索面板中打开：显示面板并把文字填进搜索框，新增事件 `panel-query`；
    - 复制为纯文本；
    - 网址：在浏览器中打开。
- **自定义动作**（设置里增删）：`config.superPanel.actions: [{ id, name, command, when: ["file" | "folder" | "image" | "text"], enabled }]`。
  - 执行：`/bin/sh -c <command>`，不开终端。
  - 占位符：`{path}` 选中项（多个用空格隔开）、`{dir}`、`{text}`、`{name}`。**替换时每个值都要做 shell 单引号转义**（`'` → `'\''`），否则文件名里的特殊字符会执行命令。
  - 默认带两条示例，都默认关闭：
    - 「用 VS Code 打开」`code {path}`；
    - 「用 Claude Code 打开」：在终端里执行 `cd {dir} && claude`。
- **我的面板**：`config.superPanel.pinned`，格式同 `usage.rs` 的 `SearchItem`，最多 12 个，可以放任何指令、应用、网页应用、系统动作。设置里能增删、拖动排序；面板上右键格子可以移除。默认：截图、二维码、翻译、取色、截图识字、DeepSeek、显示桌面、锁屏。
- **有上下文时**：「我的面板」缩成底部一排小图标（设计稿 SuperPanelFinder）。
- **键盘**：↑↓ 选择，↵ 执行，esc 关闭。

### 设置

设置侧栏在「全局热键」下面加「超级面板」，内容见 SuperPanelSettings：
- 呼出热键（录制 + 开关）；
- 长按右键开关；
- 我的面板；
- 自定义动作列表，含新建 / 编辑：名称、命令、适用于哪些类型。

### 配套的系统动作（新插件 `plugins/system/`）

超级面板默认格子会用到，也能从搜索框直接用：
- **取色**：用 `NSColorSampler`（`objc2-app-kit`，需要 block2 回调），取到后把 `#RRGGBB` 写进剪贴板并发系统通知。
- **显示桌面**：调用 `CoreDockSendNotification("com.apple.showdesktop.awake")`（私有接口，dlsym 动态取，失败时退回模拟 F11）。
- **锁屏**：模拟 ⌃⌘Q（系统锁屏快捷键，`tap::post_shortcut`）。
- **截图识字（OCR）**：`screencapture -i` 存临时文件，再用 Vision（`objc2-vision` 的 `VNRecognizeTextRequest`，语言 zh-Hans、en-US）识别，结果写剪贴板并在超级面板或通知里显示前几行。工作量最大，可以放到本项最后做。

### 验收

- 在访达选中一个有图片的文件夹，按 ⌥⇧Space，面板出现在鼠标旁，第一项是「压缩目录下所有图片 · N 张」，点了进入压缩页面并开始压缩。
- 在 Safari 选中一段英文，按 ⌥⇧Space，面板顶部出现中文译文。
- 什么都没选时显示九宫格；长按右键（开启后）能呼出，短按右键菜单照常。
- 自定义命令对含空格和引号的文件名也能正确执行。

## 5. hosts 切换

设计：[Hosts.html](design/Hosts.html)。

- **插件**：`plugins/hosts/`，功能 `hosts`「hosts 切换」，`cmds: ["hosts", "host"]`。
- **数据**：`~/Library/Application Support/com.ahatools.app/hosts.json`：`[{ id, name, content, enabled }]`。另有只读的「系统原始」：首次应用前把当前 `/etc/hosts` 备份到同目录 `hosts.original`。
- **应用**：
  - 把 `/etc/hosts` 里 `# --- AhaTools start ---` 到 `# --- AhaTools end ---` 之间换成所有启用方案的内容拼接，标记段外的内容保持不动；
  - 写到临时文件，再执行：
    ```sh
    osascript -e 'do shell script "cp <tmp> /etc/hosts && dscacheutil -flushcache && killall -HUP mDNSResponder" with administrator privileges'
    ```
  - 每次应用要一次系统密码。以后可改成特权辅助进程（SMAppService），本轮不做。
- **校验**：每行「IP 空格 域名」或 `#` 注释；不合法的行在编辑器里标红，有错时不让应用。
- **其他**：「查看当前生效内容」只读显示 `/etc/hosts`；「恢复原始 hosts」把标记段整个移除。
- **单元测试**：标记段的插入、替换、移除，原有内容不丢。

## 6. 系统监控

设计：[SystemMonitor.html](design/SystemMonitor.html)。

- **数据**（`src-tauri/src/sysmon.rs`）：
  - CPU：`host_processor_info` 两次采样的差；最忙的应用用 `ps -Ao pcpu,comm -r | head -2`；
  - 内存：`host_statistics64` 的 active + wired + compressed，加上 `sysctl hw.memsize`；内存压力用 `sysctl kern.memorystatus_vm_pressure_level`；
  - 电池：`pmset -g batt` 解析百分比、是否在充电、剩余时间；
  - 磁盘：`statfs("/")`。
- **采样**：只在弹出面板显示时每秒采样一次（面板 `menu-shown` 开始，隐藏时停）。菜单栏选择显示 CPU 或内存时才常驻采样。
- **菜单栏**：`config.menubar = ["netspeed", "cpu", "memory"]`（顺序即显示顺序），替代现有的 `netspeed: bool`，要写迁移：旧值 true 对应 `["netspeed"]`，false 对应 `[]`。绘制扩展 `netspeed.rs` 的 Renderer：CPU 显示「芯片图标 + 23%」。都不选时显示四格标志（`render_idle`）。
- **弹出面板**：网速下面加 CPU（曲线 + 最忙应用）、内存条、电池条、磁盘可用，调整 `popover.rs` 的 `HEIGHT`。

## 7. 外部插件

设计：[ExternalPlugins.html](design/ExternalPlugins.html)。

- **加载**：启动时扫描 `~/Library/Application Support/com.ahatools.app/plugins/<id>/plugin.json`，与内置清单合并；`manifest` 加 `source: "builtin" | "external"`、`path`、`author`、`permissions`。
- **页面**：外部插件的页面是 `<id>/index.html`，在一个新窗口（或面板内 iframe）里用 Tauri 自定义协议 `ahaplugin://<id>/` 加载。不能直接 import React 组件：外部代码不经过构建。
- **接口**：给外部页面注入精简的 `window.ahatools`（剪贴板读写、`openPath`、`setStatus`、`input`），按 `permissions` 字段放行。每个外部插件一个 capability，不给通用命令。
- **管理**：设置 → 已安装插件分「内置 / 外部」两组；外部插件可启用 / 停用（`config.disabledPlugins`）、重新载入、移除（移到废纸篓，不直接删）、在访达中显示；列表底部「打开插件目录」。
- **说明文档**：写一份 `docs/plugin-api.md` 说明目录结构和 `window.ahatools` 接口。

## 8. 应用图标

设计：[AppIcon.html](design/AppIcon.html)。三个方向里作者选定了**衬线 A**（2026-10-29）：米白渐变圆角方形，中间是衬线大写 A（New York 风格，近黑 `#1D1C1A`），右上角一颗墨蓝 `#3A5A8C` 四角火花。接下来画 1024×1024 正式稿（macOS 圆角方形，边距按苹果模板），用 `bun run tauri icon <png>` 生成 `src-tauri/icons/` 下的各尺寸文件。不使用任何 Claude / Anthropic 品牌元素。

## 9. 小项

- **搜索面板跟随鼠标所在屏幕**：`panel::show` 里用 `app.cursor_position()` 找到所在显示器（`app.monitor_from_point`），把面板水平居中、顶边放在该屏幕高度的 22% 处。
- **再次唤出时的行为**：设置 → 通用加一行「再次打开时」：
  - 「回到上次的页面」（现在的行为，默认）；
  - 「超过 5 分钟回到搜索」；
  - 「总是回到搜索」。

  `panel.rs` 记录隐藏时间，`panel-shown` 事件带上「是否重置」，`App.tsx` 据此 `setActive(null)`。

## 10. 最后：发布

见 [HANDOFF.md](HANDOFF.md) 文末「最后：发布正式版并替换 eul」。第一步是换上定稿的应用图标。
