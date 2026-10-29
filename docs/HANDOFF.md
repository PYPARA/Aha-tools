# AhaTools 任务清单与接手说明

更新于 2026-10-28。骨架功能、热键路由和第二版界面都已可用，代码在 `main`（未推送，仓库还没有远程）。目前只以 `bun run tauri dev` 调试版运行，暂不打正式包，先继续开发。本轮开发计划：热键路由 + 设置界面（已完成）、第二版界面（已完成）、二维码、hosts 切换、图片压缩、翻译。

## 当前状态

| 功能 | 状态 | 验证情况 |
| --- | --- | --- |
| 菜单栏网速（方案 A 双行） | 完成 | 离线渲染预览核对过，真机已确认 |
| 点击菜单栏的弹出面板 | 完成 | 浏览器按实际尺寸核对深浅色，真机已确认 |
| ⌥Space 搜索面板（第二版：最近使用、已固定、⌘1–9；右键原生菜单固定 / 取消 / 从最近使用删除，或 ⌘D；再次唤出回到上次的页面） | 完成 | 浏览器预览核对；真机待确认应用图标 |
| 窗口尺寸：搜索 / 插件页两种大小，拖边缘可调，各自记住（`window.json`） | 完成 | 待真机确认 |
| 快捷启动（应用 + 收藏路径） | 完成 | 单元测试：中文应用名、路径类型 |
| 拼音搜索（全拼、首字母，可在设置里关） | 完成 | 单元测试 |
| 真实应用图标（`sips` 转换 .icns 并缓存） | 完成 | 单元测试找图标文件；真机待确认显示 |
| 独占热键（事件拦截） | 完成 | 真机确认 uTools 不再同时弹出 |
| 热键占用检测 | 完成，有盲区 | 见「已知问题」 |
| 开机自动启动 | 完成 | 还没在正式版上验证 |
| 插件机制 + 内置插件 | 完成 | 快捷启动、热键检测、截图、设置 |
| 插件输入（`fy hello` 带入文字；清单 `match` 匹配任意文字） | 完成 | 单元测试 |
| 设置窗口（第二版：通用、全局热键、已安装插件、所有指令、关于），改动立即生效 | 完成 | 浏览器预览核对深浅色；真机待确认 |
| 插件详情页（关键词 / 自动匹配 / 设置），截图设置在截图插件的「设置」页签 | 完成 | 浏览器预览核对 |
| 网页应用（内置 DeepSeek，可自己加网站；独立常驻窗口，关掉只是收起；登录和窗口位置保留；新窗口链接用默认浏览器打开；自动使用网站图标） | 完成 | 单元测试搜索；浏览器预览设置页签；真机待确认 |
| 外观（跟随系统 / 浅色 / 深色）、菜单栏网速开关（关闭后显示 AhaTools 标志） | 完成 | 浏览器预览核对；网速开关待真机确认 |
| 截图热键路由（系统截图 / 微信 / QQ / 钉钉） | 完成 | 浏览器预览核对；代按第三方应用待真机确认 |
| ⌥Space 等热键转发给 uTools | 完成 | 待真机确认 |

Rust 单元测试 23 个全部通过。界面设计稿：[AhaTools 界面设计](https://claude.ai/artifact/MvKZXwUow89G1yPLrWDhgE)（仅本人可见，以「第二版」页面为准）；设计规范见 [design-system.md](design-system.md)，最初的设计需求见 [design-brief.md](design-brief.md)。

**第二版界面已实现**：搜索面板 760×500，空状态显示最近使用和已固定；进入设置或插件页时窗口放大到 880×580（`set_panel_large`，保持顶边和水平中心不动）；设置侧栏只有通用、全局热键、已安装插件、所有指令、关于；截图是独立插件，它的设置在插件详情的「设置」页签。以后的翻译等插件同样把设置放在自己的「设置」页签（`src/views.ts` 的 `pluginSettings`）。

## 下一步：发布正式版并替换 eul

调试版依附在终端上，关掉终端或重启电脑就没了。按顺序做完，才能卸载 eul。

- [ ] 在项目目录运行 `bun run tauri build`，产物是 `src-tauri/target/release/bundle/macos/AhaTools.app`
- [ ] 把 AhaTools.app 拷进 `/Applications`，退出 dev，打开正式版（没有开发者签名，首次打开可能要右键 → 打开）
- [ ] 在正式版的弹出面板里打开「开机自动启动」：启动项记录的是当时那个程序的路径，在 dev 版里开会指向调试程序
- [ ] 给正式版授权「辅助功能」，独占 ⌥Space 才会生效；dev 版的授权不会沿用
- [ ] 观察一两天：网速一直正常、重启后会自动出来，再卸载 eul
- [ ] 给仓库配置远程（比如 GitHub）并推送，现在代码只在本机

## 已知问题与技术债

都不影响日常使用，前两项在发布正式版时最容易碰到。

| 问题 | 影响 | 建议处理 |
| --- | --- | --- |
| 没有开发者证书签名，每次重新打包后「辅助功能」授权会失效 | 独占热键退回共享模式，要在系统设置里重新勾选 | 用固定证书签名，或接受每次更新后重新授权 |
| 热键占用检测有盲区 | 以非独占方式注册热键的程序（不少 Electron 应用）、用事件拦截的程序（如 Karabiner）都查不到；「未发现占用」不等于空闲 | 靠热键路由统一接管，不再依赖检测 |
| 代按第三方应用依赖对方的设置 | 微信、QQ、钉钉、uTools 要先在各自设置里把快捷键改成暗号键（⌃⌘1/2/3/0；最初用 ⌃⌥⇧⌘，QQ 录下来只剩 ⌘⌃，已改默认并自动迁移未确认的旧值）；对方升级后可能被重置；有的应用不收某些修饰键，对方记下的和暗号键不一致时，把暗号键改成对方显示的组合 | 用户勾选「已设好」（`relayApps[].ready`）之前，截图退回系统截图并通知、转发直接提示，不会按了没反应；「5 秒后代按」帮助录入 |
| 截图转发目标没在运行时退回系统截图 | 用系统通知提示 | 有意为之 |
| 拼音多音字只取常用读音 | 例如「音乐」只认 yinle | 需要时改用多音字全部读音 |
| 只有资源目录里有 .icns 的应用能显示真实图标 | 图标只放在 Assets.car 里的应用显示首字占位 | 改用 NSWorkspace 取图标 |
| 搜索面板固定出现在主屏幕中央 | 多显示器时可能出现在别的屏幕 | 显示在鼠标所在的屏幕 |
| 菜单栏图标要读系统字体文件 `SFNS.ttf` | 系统改了字体位置会退回纯文字显示 | 改用系统文字接口绘制，或内置字体 |
| 网速只统计 Wi‑Fi、有线、USB 共享等真实网卡 | 开 VPN 时和 eul 的数字不同 | 有意为之，避免重复计算；需要时再做成选项 |
| 应用图标还是 Tauri 默认图标 | 在「应用程序」和授权弹窗里不好认 | 设计一个专属图标 |

## 计划中的功能

按优先级排列。P1 是最初需求里还没做的部分。

| 优先级 | 任务 | 要点 | 状态 |
| --- | --- | --- | --- |
| P1 | 截图热键路由 | 一个截图热键，在设置或弹出面板里选系统截图 / 微信 / QQ / 钉钉；第三方应用由 AhaTools 代按它的暗号键 | 完成，待真机确认 |
| P1 | ⌥Space 整合开关 | 热键动作选「转发给 uTools」即可 | 完成，待真机确认 |
| P1 | 热键设置界面 | 设置页「热键」「截图」两个分区，改动立即生效 | 完成 |
| P1 | 二维码 | 生成二维码（npm `qrcode`）；识别剪贴板图片里的二维码（npm `jsqr`） | 进行中 |
| P1 | hosts 切换 | 多套 hosts 方案切换，写 `/etc/hosts` 需要管理员权限：先每次弹系统授权，以后改成常驻的特权辅助进程；切换后刷新 DNS 缓存 | 未开始 |
| P2 | 图片压缩 | Rust 侧用 oxipng / mozjpeg / webp；pngquant 的核心库是 GPL 许可，自用没问题 | 未开始 |
| P2 | 翻译 | 先接大模型（OpenAI 兼容接口，流式），API key 存钥匙串 | 未开始 |
| P2 | 拼音搜索、真实应用图标 | 见「已知问题」 | 完成 |
| P2 | 搜索面板跟随鼠标所在屏幕 | 见「已知问题」 | 未开始 |
| P3 | 外部插件加载 | 从 `~/Library/Application Support/com.ahatools.app/plugins` 读取插件，沿用现有 `plugin.json` 格式和 `@ahatools/sdk` 接口 | 未开始 |
| P3 | 自研截图 | 需要 ScreenCaptureKit，可能要通过 Swift 桥接 | 未开始 |
| P3 | 其他系统监控 | eul 的 CPU、内存、电池等，按需做成插件 | 未开始 |

## 接手指南

### 运行

```bash
bun install
bun run tauri dev
```

- 改 `src/`、`plugins/` 下的前端代码会热更新；改 `src-tauri/` 下的 Rust 代码会自动重新编译并重启应用。
- 只看界面不想启动应用：dev 运行时，用普通浏览器打开 `http://localhost:1420`（搜索面板）或 `http://localhost:1420/index.html?view=menu`（菜单栏弹出面板），会自动用 `src/dev-mock.ts` 里的假数据。正式打包不包含这些假数据。
- 测试：在 `src-tauri/` 下运行 `cargo test`。
- 菜单栏图标预览：在 `src-tauri/` 下运行 `AHATOOLS_PREVIEW=out.pgm cargo test preview -- --ignored`，输出深色背景下的图标。

### 目录结构

```
src-tauri/src/
  lib.rs          应用启动、菜单栏图标
  netspeed.rs     网速采样、菜单栏图标绘制、60 秒历史
  popover.rs      菜单栏弹出面板窗口（label "menu"）
  panel.rs        搜索面板窗口（label "panel"）：显示、失焦隐藏、搜索 / 插件页两种尺寸
  usage.rs        最近使用和已固定（usage.json）
  favicon.rs      网页应用的网站图标：读页面的 icon 声明（优先 apple-touch-icon），curl 下载、sips 转 PNG 并缓存；下载被拦的网站（如 ChatGPT 的 Cloudflare）在网页窗口加载完后从页面里补取
  webapps.rs      网页应用窗口（label "web-<id>"）：创建、收起而不关闭、记住位置（webapps.json）
  hotkey/         热键路由（mod.rs）、独占拦截和代按（tap.rs）、占用检测（probe.rs）
  relay.rs        转发目标应用：代按暗号键、是否安装 / 运行、系统通知
  screenshot.rs   截图路由：系统截图或转发给选中的应用
  plugins/        插件注册、搜索汇总和拼音匹配（mod.rs）、快捷启动和应用图标（launcher.rs）、网页应用搜索（webapps.rs）
  config.rs       配置读写（config_get / config_set 命令，保存后立即生效）
src/
  App.tsx         搜索面板界面，以及插件页的外框（标题栏、底栏）
  MenuPopover.tsx 菜单栏弹出面板界面
  sdk.ts, ui.tsx  插件可用的接口、图标和组件，统一从 "@ahatools/sdk" 引入
  config.ts       config.json 的类型（与 config.rs 对应）
  views.ts        内置插件的页面、直接执行的功能、图标、「设置」页签的注册表
  styles.css      设计变量和通用组件样式，变量名与 design-system.md 一致
plugins/<id>/     每个插件一个目录：plugin.json + 页面组件
plugins/settings/ 设置窗口（整窗自绘，不用插件页外框）
docs/             设计需求、本文档
```

### 添加一个插件

1. 新建 `plugins/<id>/plugin.json`，每个功能的 `cmds` 是搜索关键词。
2. 每个功能写一个页面 `plugins/<id>/<View>.tsx`，只从 `@ahatools/sdk` 引入宿主接口和图标；页面可以调用 `setStatus` 往底栏右侧写文字。
3. 在 `src/views.ts` 里登记页面（键为 `"<id>/<功能 code>"`）和插件图标；不需要页面、选中就直接执行的功能登记在 `actions`；插件有自己的设置时，写一个设置组件登记在 `pluginSettings`，会出现在插件详情的「设置」页签。页面右上角的按钮用 `<PageActions>` 放。
4. 在 `src-tauri/src/plugins/mod.rs` 的 `BUILTIN_MANIFESTS` 里加上这个 `plugin.json`。
5. 需要原生能力时，加 `src-tauri/src/plugins/<id>.rs` 并在 `lib.rs` 注册命令；要往每次搜索里贡献结果，就实现 `SearchProvider` 并在清单里设 `"searchProvider": true`。

### 关键约束和坑

- 所有命名统一用 AhaTools，不用 aha，避免和本机另一个 Aha 应用（bundle id `app.aha.desktop.next`，数据在 `~/Library/Application Support/aha*` 和 `~/.aha-next`）混淆。bundle id 是 `com.ahatools.app`，程序名 `ahatools`，插件接口别名 `@ahatools/sdk`。
- 数据只存在 `~/Library/Application Support/com.ahatools.app/`（`config.json`、`launcher.json`、`usage.json`、`window.json`、`webapps.json`，以后的外部插件放 `plugins/`）；应用图标缓存在 `~/Library/Caches/com.ahatools.app/icons`；网页缓存在 `~/Library/Caches/com.ahatools.app` 和 `~/Library/WebKit/com.ahatools.app`，由系统自动生成。不要在用户主目录下建隐藏文件夹。改 bundle id 会换数据目录，`config.rs` 里有从旧目录 `com.aha.tools` 一次性迁移的逻辑。
- 菜单栏图标刷新必须用 `set_icon_with_as_template`：`set_icon` 会丢掉模板标记，图标在深色菜单栏上变成黑字看不见。
- 独占热键用的是事件拦截，需要「辅助功能」权限；没授权时自动退回共享模式，授权后无需重启即可切换。从终端跑 dev 时，权限会算到启动它的终端程序头上。
- 热键检测只能发现独占注册的热键和系统快捷键，见「已知问题」。
- 菜单栏应用没有自己的应用菜单，⌘Q 等快捷键要在页面里自己处理（弹出面板里已处理 ⌘Q）。面板的 esc、⌘, 等快捷键监听在 window 上（`App.tsx`），不要挂在某个元素上，否则没有聚焦输入框的页面收不到。
- 两个窗口都是透明无边框的，圆角和底色由页面自己画（`.panel`、`.settings`、`.popover`）。弹出面板的高度写死在 `popover.rs` 的 `HEIGHT`，改了内容要一起调。
- 应用菜单（`lib.rs` 的 `setup_menu`）不显示，但网页里的 ⌘C / ⌘V / ⌘A / ⌘Z 靠它生效；故意没有 ⌘Q，免得在网页应用窗口里误按退出整个 AhaTools。⌘W 收起窗口，⌘R 重新加载网页应用。
- 网页应用窗口不在 `capabilities/default.json` 的窗口列表里，外部网站调用不了 AhaTools 的任何命令；加新窗口时保持这一点。
- 新界面先在设计稿上画，再按 [design-system.md](design-system.md) 实现：选中和悬停用暖灰，不用强调色铺底。
- 代按的按键事件带有标记（`tap.rs` 的 `SYNTHETIC_MARK`），拦截回调见到标记直接放行，否则 AhaTools 会拦住自己发出的按键。
- 录制热键时调用 `hotkey_set_recording` 暂停所有全局热键（`HotkeyRecorder` 组件已处理），否则正在录的组合键会被触发或吞掉。结束录制会从 config.json 重新注册，和保存新热键可能同时发生，所以两者都在 `hotkey/mod.rs` 的 `APPLYING` 锁里执行。录制时组合键由事件拦截（`tap.rs`）直接捕获并发出 `hotkey-recorded` 事件，不依赖网页能否收到按键（实测网页收不到）；没装拦截时才退回网页的 keydown。面板隐藏时 `stop_recording` 会结束录制，否则所有热键（包括 ⌥Space）会一直暂停。终端里的 `[hotkey]`、`[config]` 日志可以看录制和保存是否发生。
- 配置结构改动要保持旧 `config.json` 能读：`Config` 带 `#[serde(default)]`，新字段取默认值；`config.rs` 里有对应测试。
