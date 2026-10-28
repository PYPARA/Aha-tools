# AhaTools 任务清单与接手说明

更新于 2026-10-28。骨架功能和热键路由都已可用，代码在 `main`（未推送，仓库还没有远程）。目前只以 `bun run tauri dev` 调试版运行，暂不打正式包，先继续开发。本轮开发计划：热键路由 + 设置界面（已完成）、二维码、hosts 切换、图片压缩、翻译。

## 当前状态

| 功能 | 状态 | 验证情况 |
| --- | --- | --- |
| 菜单栏网速（方案 A 双行） | 完成 | 离线渲染预览核对过，真机已确认 |
| 点击菜单栏的弹出面板 | 完成 | 浏览器按实际尺寸核对深浅色，真机已确认 |
| ⌥Space 搜索面板 | 完成 | 浏览器预览核对过四种状态 |
| 快捷启动（应用 + 收藏路径） | 完成 | 单元测试：中文应用名、路径类型 |
| 独占热键（事件拦截） | 完成 | 真机确认 uTools 不再同时弹出 |
| 热键占用检测 | 完成，有盲区 | 见「已知问题」 |
| 开机自动启动 | 完成 | 还没在正式版上验证 |
| 插件机制 + 内置插件 | 完成 | 快捷启动、热键检测、设置 |
| 插件输入（`fy hello` 带入文字；清单 `match` 匹配任意文字） | 完成 | 单元测试 |
| 设置页：热键录制、开关、动作，改动立即生效 | 完成 | 浏览器预览核对；真机待确认 |
| 截图热键路由（系统截图 / 微信 / QQ / 钉钉） | 完成 | 浏览器预览核对；代按第三方应用待真机确认 |
| ⌥Space 等热键转发给 uTools | 完成 | 待真机确认 |

Rust 单元测试 19 个全部通过。界面设计稿：[AhaTools 界面设计](https://claude.ai/artifact/MvKZXwUow89G1yPLrWDhgE)（仅本人可见，以「第二版」页面为准）；设计规范见 [design-system.md](design-system.md)，最初的设计需求见 [design-brief.md](design-brief.md)。

**待实现：第二版界面**。设计已定稿待确认：搜索面板改为 760×500、空状态显示最近使用和已固定；设置和插件页放大到 880×580，设置侧栏只保留通用、全局热键、已安装插件、所有指令、关于；截图、翻译做成插件，各自的设置放在插件详情的「设置」页签。

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
| 代按第三方应用依赖对方的设置 | 微信、QQ、钉钉、uTools 要先在各自设置里把快捷键改成暗号键（⌃⌥⇧⌘1/2/3/0）；对方升级后可能被重置 | 设置页有「5 秒后代按」帮助录入；失效时重新录一次 |
| 截图转发目标没在运行时退回系统截图 | 用系统通知提示 | 有意为之 |
| 搜索不支持拼音 | 中文应用名只能打汉字或英文名 | 加拼音全拼和首字母匹配 |
| 搜索结果里的应用图标是首字占位 | 不如真实图标好认 | 用系统接口读取应用图标 |
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
| P2 | 拼音搜索、真实应用图标、跟随鼠标所在屏幕 | 见「已知问题」 | 未开始 |
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
  panel.rs        搜索面板窗口（label "panel"）：显示、失焦隐藏
  hotkey/         热键路由（mod.rs）、独占拦截和代按（tap.rs）、占用检测（probe.rs）
  relay.rs        转发目标应用：代按暗号键、是否安装 / 运行、系统通知
  screenshot.rs   截图路由：系统截图或转发给选中的应用
  plugins/        插件注册与搜索汇总（mod.rs）、快捷启动（launcher.rs）
  config.rs       配置读写（config_get / config_set 命令，保存后立即生效）
src/
  App.tsx         搜索面板界面
  MenuPopover.tsx 菜单栏弹出面板界面
  sdk.ts, ui.tsx  插件可用的接口和图标，统一从 "@ahatools/sdk" 引入
  views.ts        内置插件页面和插件图标的注册表
  styles.css      设计变量和通用组件样式，变量名与设计稿一致
plugins/<id>/     每个插件一个目录：plugin.json + 页面组件
docs/             设计需求、本文档
```

### 添加一个插件

1. 新建 `plugins/<id>/plugin.json`，每个功能的 `cmds` 是搜索关键词。
2. 每个功能写一个页面 `plugins/<id>/<View>.tsx`，只从 `@ahatools/sdk` 引入宿主接口和图标；页面可以调用 `setStatus` 往底栏右侧写文字。
3. 在 `src/views.ts` 里登记页面（键为 `"<id>/<功能 code>"`）和插件图标。
4. 在 `src-tauri/src/plugins/mod.rs` 的 `BUILTIN_MANIFESTS` 里加上这个 `plugin.json`。
5. 需要原生能力时，加 `src-tauri/src/plugins/<id>.rs` 并在 `lib.rs` 注册命令；要往每次搜索里贡献结果，就实现 `SearchProvider` 并在清单里设 `"searchProvider": true`。

### 关键约束和坑

- 所有命名统一用 AhaTools，不用 aha，避免和本机另一个 Aha 应用（bundle id `app.aha.desktop.next`，数据在 `~/Library/Application Support/aha*` 和 `~/.aha-next`）混淆。bundle id 是 `com.ahatools.app`，程序名 `ahatools`，插件接口别名 `@ahatools/sdk`。
- 数据只存在 `~/Library/Application Support/com.ahatools.app/`（`config.json`、`launcher.json`，以后的外部插件放 `plugins/`）；网页缓存在 `~/Library/Caches/com.ahatools.app` 和 `~/Library/WebKit/com.ahatools.app`，由系统自动生成。不要在用户主目录下建隐藏文件夹。改 bundle id 会换数据目录，`config.rs` 里有从旧目录 `com.aha.tools` 一次性迁移的逻辑。
- 菜单栏图标刷新必须用 `set_icon_with_as_template`：`set_icon` 会丢掉模板标记，图标在深色菜单栏上变成黑字看不见。
- 独占热键用的是事件拦截，需要「辅助功能」权限；没授权时自动退回共享模式，授权后无需重启即可切换。从终端跑 dev 时，权限会算到启动它的终端程序头上。
- 热键检测只能发现独占注册的热键和系统快捷键，见「已知问题」。
- 菜单栏应用没有自己的应用菜单，⌘Q 等快捷键要在页面里自己处理（弹出面板里已处理 ⌘Q）。
- 两个窗口都是透明无边框的，圆角和底色由页面自己画（`.panel`、`.popover`）。
- 代按的按键事件带有标记（`tap.rs` 的 `SYNTHETIC_MARK`），拦截回调见到标记直接放行，否则 AhaTools 会拦住自己发出的按键。
- 录制热键时调用 `hotkey_set_recording` 暂停所有全局热键（`HotkeyRecorder` 组件已处理），否则正在录的组合键会被触发或吞掉。
- 配置结构改动要保持旧 `config.json` 能读：`Config` 带 `#[serde(default)]`，新字段取默认值；`config.rs` 里有对应测试。
