# AhaTools 后续功能实现规格

写给接手实现的人（或 AI）。2026-10-29 写定。先读 [HANDOFF.md](HANDOFF.md) 的「接手指南」和「关键约束和坑」，再读 [design-system.md](design-system.md)，然后按本文的顺序一项一项做。

- **设计稿**：每项的界面在 [docs/design/](design/) 下有静态 HTML（浏览器直接打开，浅色、深色并排）。claude.ai 上的画布只有作者能看，以本目录为准。改设计时改 [docs/design/gen_boards.py](design/gen_boards.py) 再重新生成。
- **做法**：一项做完再做下一项；每项都要单元测试、`bun run build` 通过、在浏览器预览（`src/dev-mock.ts` 补假数据）核对浅色和深色，最后更新 HANDOFF 的状态表。
- **提交**：Conventional Commits + emoji，例如 `✨ feat(qrcode): …`；文档单独提交 `📝 docs: …`。
- **不做**：自研截图（截图交给系统 / 微信 / QQ，已有热键路由）。

## 通用做法（每个插件都一样）

现有代码就是范例，照着抄：网页应用插件（`plugins/webapps/`、`src-tauri/src/webapps.rs`、`src-tauri/src/plugins/webapps.rs`）是最完整的一份。

1. **清单**：`plugins/<id>/plugin.json`：`id`、`name`、`version`、`description`、`features[]`（`code`、`explain`、`cmds` 关键词、可选 `match`）。在 `src-tauri/src/plugins/mod.rs` 的 `BUILTIN_MANIFESTS` 里加 `include_str!`。
2. **页面**：`plugins/<id>/<View>.tsx`，只从 `@ahatools/sdk` 引入；在 `src/views.ts` 的 `views` 里登记 `"<id>/<code>"`。功能图标按第 0 项生成到 `src/assets/icons/` 后自动登记，由 SDK 的 `FeatureIcon` 显示。页面拿到 `PluginViewProps`：`onBack`、`setStatus`（写底栏右侧）、`input`（从搜索框带入的文字，例如 `qr hello` 的 `hello`，或 `match` 命中的整段输入）、`content`（本次输入的图片快照或文件路径，仅保留在内存）、`openFeature`（携带 `input` / `content` 切换插件页）。标题栏右侧按钮用 `<PageActions>`。
3. **插件设置**：写 `plugins/<id>/Settings.tsx`（拿到 `cfg`、`save`），登记到 `src/views.ts` 的 `pluginSettings`，会出现在 设置 → 已安装插件 → 该插件 →「设置」页签。
4. **不需要页面的功能**：登记到 `src/views.ts` 的 `actions`（例：`screenshot/take`）。
5. **配置**：加到 `src-tauri/src/config.rs` 的 `Config`（结构体整体有 `#[serde(default)]`，旧文件能读）并在 `Default` 里给默认值，同步 `src/config.ts` 的类型；补「旧配置能读」的测试。密钥一律存钥匙串，不进 config.json。
6. **原生能力**：Rust 模块 + `#[tauri::command]`，在 `src-tauri/src/lib.rs` 的 `generate_handler!` 里注册。耗时命令写成 `async`。调用系统工具优先用 macOS 自带命令（项目里已有 `sips`、`curl`、`screencapture`、`osascript`、`lsappinfo` 的用法）。
7. **热键**：能被热键触发的功能用 `hotkey::Action::OpenFeature`（插件详情的「设为热键」已经支持），特殊的才新增 `Action` 变体（参考 `OpenWeb`），并在 `plugins/settings/actions.ts` 的 `describeAction` / `actionChoices` 里补文案。
8. **文案**：中文，短句，说清楚会发生什么；不出现 aha 小写名，统一 AhaTools。

### 已有宿主能力：图片 / 文件联想与固定项排序

设计：[InputMatches.html](design/InputMatches.html)。搜索框显式粘贴图片或访达文件、拖入文件后，以附件条显示输入，按类型展示匹配功能；输入框改为筛选功能。清单 `match.image: true` 接受 RGBA 图片，`match.files` 接受扩展名列表（`*` 代表任意文件），`maxFiles` 限制数量。继续使用插件详情的 `disabledMatches` 开关。

SDK 的 `PluginContent` 是 `{ type: "image", name, image: { width, height, rgba } }` 或 `{ type: "files", paths }`，通过页面 / 动作的 `content` 传递；搜索请求仅传元数据，图片和本次路径不写入历史。使用 Worker 时复制像素缓冲，避免转移后破坏宿主保留的图片。二维码识别只接受一张图片；图片工具提供复制 / 保存 PNG，快捷启动提供复制路径 / 提取名称 / 单文件收藏预填。

固定项使用 `@dnd-kit/react` 的 sortable 和 `@dnd-kit/dom` 的输入 / 反馈插件，提供跟手提起、落点占位、180ms 让位与归位、跨行移动、边缘自动滚动、Esc / 失焦 / 窗口尺寸变化时取消、失败回退。末行空白也接受放到末尾；空格提起、方向键移动、空格或回车放下支持键盘排序，读屏指引为中文，并遵循系统「减少动态效果」。原生文件拖放独立。`usage_reorder_pinned(item, before?)` 在锁内按身份移动已有项目并写入 `usage.json`，保留其他固定项，不允许客户端整份覆盖。AhaTools 的截图路由在调用系统 / 第三方工具期间保留原来窗口，使用独立保护状态，结束后释放并恢复焦点。

## 0. 功能图标（先做，所有插件共用）

设计：[FeatureIcons.html](design/FeatureIcons.html)，两个方向，默认方向 A（实色渐变 + 白色双色图形）。方向 A 的 SVG 已经生成好，放在 `src/assets/icons/`，文件名就是 key。如果作者改选方向 B（浅色调底 + 彩色图形），不要用图片文件：把 `soft_svg()` 的结构写成 React 组件，用 `currentColor` 跟随主题。

| key | 用在 | key | 用在 |
| --- | --- | --- | --- |
| `launcher` | 快捷启动 | `compress` | 图片压缩 |
| `hotkeys` | 热键检测 | `hosts` | hosts 切换 |
| `screenshot` | 截图 | `superpanel` | 超级面板 |
| `webapps` | 网页应用（插件本身；单个网站仍用网站图标） | `system-colorpicker` | 取色 |
| `settings` | 设置 | `system-desktop` | 显示桌面 |
| `qrcode` | 生成二维码 | `system-lock` | 锁屏 |
| `qrcode-scan` | 识别二维码 | `system-ocr` | 截图识字 |
| `translate` | 翻译 | `sysmon` | 系统监控 |
| `external` | 外部插件的默认图标（插件自带 `icon.png` 时用它的） | | |

接线：

1. `src/feature-icons.ts` 里用 Vite 的 `import.meta.glob("./assets/icons/*.svg", { eager: true, query: "?url", import: "default" })` 生成 `featureIcons: Record<key, url>`，`src/views.ts` 重新导出。资源表独立于页面注册，避免 SDK 的共享 UI 与插件页面循环引用。
2. 加一个 `featureIconKey(plugin, feature?)`：先找 `"<plugin>-<feature>"`（如 `qrcode-scan`），再找 `"<plugin>"`，都没有时用 `external`。
3. 新组件 `FeatureIcon({ plugin, feature, size })` 渲染 `<img>`（`src/ui.tsx` 里，`aria-hidden`），替换现在用 `pluginIcons` 画灰色方块的地方：
   - `src/App.tsx` 的 `ItemIcon`：功能结果按 `item.action.feature` 选图标；
   - 首页格子；
   - 插件页标题栏；
   - 设置 → 已安装插件列表和插件详情头部；
   - 所有指令；
   - 「添加热键」菜单可不加。
4. 尺寸：搜索结果 32、首页格子 40、插件页标题栏 30、插件列表 26、插件详情头部 44、超级面板 38。
5. `pluginIcons`（线条图标）删掉，或只留给没有功能图标的地方。

以后每加一个功能，先在 `docs/design/gen_boards.py` 的 `FEATURE_ICONS` 加一行（key、名称、底色、24 格线条图形），运行：

```sh
python3 docs/design/gen_boards.py <画布目录> src/assets/icons
```

没有画布目录时，可以只抄 `feature_svg()` 的写法手动生成 SVG。

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

设计：[TranslateText.html](design/TranslateText.html)、[TranslateWord.html](design/TranslateWord.html)、[TranslateSettings.html](design/TranslateSettings.html)。2026-10-30 更新：采用多套纯自定义配置。

- 插件 `translate/translate`，关键词「翻译 / fy / translate」，文字自动匹配至少 2 字，可独立关闭。
- `config.translate = { profiles: [{ id, name, protocol, baseUrl, model }], activeProfileId: null, direction: "auto" }`，默认列表为空。协议为 `openai-chat`、`openai-responses`、`anthropic-messages`。所有服务地址、模型与密钥由用户填写。Base URL 含版本前缀，只追加资源路径，不自动补 `/v1`。
- 每套密钥存系统钥匙串，service `com.ahatools.app`，account `translate:<id>`；不回传原密钥，不写配置和日志。更换协议或地址需重填密钥。配置与密钥保存 / 删除在后端协调，失败保留可恢复状态。
- 设置页签：配置增删改、当前配置、协议、地址、掩码密钥、模型手填与获取列表、测试连接（首个非空正文耗时）。模型查询失败仍可手填。首次保存自动启用，删除当前配置选第一套剩余配置。原生钥匙串弹窗用 `withPinned`。
- 三种流式适配：Chat `/chat/completions`、Responses `/responses`（`store:false`）、Messages `/messages`（`x-api-key`、`anthropic-version:2023-06-01`）。共用 SSE 解帧，处理 UTF-8 跨块、心跳、截断和错误。连接 10 秒、无正文 60 秒、总时限 180 秒；不自动重试或更换配置。
- `translate_start(id, profileId, text, mode, direction)`、`translate_stop(id)`；`translate-chunk/done/error` 均带请求 ID，只发给调用窗口。取消真正中止 HTTP，每个请求只结束一次。
- 翻译页左原文右结果，720px 以下上下排列；可直接切换配置并重译。输入停止 400ms 后请求，输入法组词时不发请求，⌘↵ 重译，停止保留部分结果。模式 / 方向 / 配置变化使旧请求失效。面板隐藏继续，离开页面取消。
- 方向「自动 / 英文→中文 / 中文→英文」；自动含中文译英文，其余译中文。润色保持原语言，解释用中文，这两种模式禁用方向选择。
- 单个英文词（允许词内连字符 / 撇号）且目标中文时生成 JSON：`phonetic`、`senses[{partOfSpeech,meaning,explanation}]`、`examples[{en,zh}]`、`synonyms`。流式时加载，完成校验再渲染；格式失败显示纯文本。本轮无朗读。
- ⌘C 有选区复制选区，无选区复制结果。未配置 / 缺密钥提供设置入口，返回恢复内存草稿；原文和结果不写历史。
- Rust 用本地模拟 HTTP / 密钥存储测试三种协议、模型、取消与失败恢复；Bun 测试请求状态和释义；浏览器 mock 验证深浅色与 880×580 / 600×400；真实接口、钥匙串和剪贴板由作者真机验收。

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

- 设计：[PanelBehavior.html](design/PanelBehavior.html)。本项已实现，真实多屏排列待作者验收。
- **搜索面板跟随鼠标所在屏幕**：每次唤出时重新定位，把面板水平居中、顶边放在该屏幕高度的 22% 处；位置限制在该屏可用区域内。macOS 使用 `NSEvent::mouseLocation()`、`NSScreen` 和 `NSWindow` 的统一逻辑点坐标，见 `window_position.rs`；不混用当前 Tauri 版本中缩放来源不同的鼠标 / 显示器 / 窗口物理坐标。屏幕断开时回退到距离鼠标最近的屏幕。
- **再次唤出时的行为**：设置 → 通用加一行「再次打开时」：
  - 「回到上次的页面」（现在的行为，默认）；
  - 「超过 5 分钟回到搜索」；
  - 「总是回到搜索」。

  配置 `panelReopen: "resume" | "afterFiveMinutes" | "search"`，默认 `resume`，旧配置自动补默认值。`panel.rs` 从实际隐藏开始计时，重复失焦不会延长计时；`panel-shown` 携带 `{ reset: boolean }`。重置时同步清空当前页面、搜索词和附件，恢复搜索尺寸、首页与焦点。已显示的窗口和直接指定功能的热键不受重置策略影响。保留二维码识别页时重新读取一次剪贴板，重置离开时直接释放页面资源。

- **多屏菜单栏弹窗定位**：点击时选择鼠标所在的 `NSScreen`，用该屏幕的缩放还原托盘图标横坐标，纵向以该屏幕自己的菜单栏底边计算。与搜索面板共用 AppKit 逻辑点坐标和可用区域约束，支持负坐标、上下排列与混合缩放；不使用弹窗上一次所在屏幕的缩放比例。

## 10. 最后：发布

见 [HANDOFF.md](HANDOFF.md) 文末「最后：发布正式版并替换 eul」。第一步是换上定稿的应用图标。
