# AhaTools 优化计划（对标 uTools 的手感与实用度）

> 2026-11-11 定稿。A–F 已实现，实现细节、偏差和真机确认项见 [HANDOFF.md](HANDOFF.md)「优化计划」一节；本文保留为当时的规格。

## Context

作者日常同时装着 uTools 和 AhaTools，觉得 AhaTools「不如 uTools 好用」。排查后问题分五类：

1. **Bug**：超级面板里点「复制文件路径」什么都没复制。
2. **不够智能**：搜索排序不记选择；不会自动带入刚复制的内容；只有「任意文字」一种文字匹配，识别不出 JSON、网址、IP 这类内容。
3. **缺小工具**：内网 IP、ping、JSON；作者追加：公网 IP / DNS / 端口占用、剪贴板历史、**进程占用查看与结束**（电脑卡顿时活动监视器太难用）。
4. **翻译慢**。
5. **其他问题**：作者暂时列不全，边用边记。

目标：按下面 A→G 的顺序逐阶段实现，每个阶段独立可交付。原 [docs/specs.md](docs/specs.md) 第 7 项「外部插件」顺延到本计划之后。

已查实的事实（实现时不用重新调查）：

- 复制路径：[superpanel.rs:330-341](src-tauri/src/superpanel.rs) 把访达路径塞进 `input = {"paths":[…]}`，经 `Run::Item` → `panel::open_feature`；[App.tsx:266](src/App.tsx) 调 `actions[key]({ input, content: undefined })`；而 [views.ts:73-82](src/views.ts) 的 `launcher/copy-path`、`copy-name` 只读 `content`，于是抛「先在搜索框粘贴或拖入文件」。`usage.json` 里有「复制文件路径」的使用记录，说明作者点的正是这一行。同一面板里还有一条能用的「文件 → 复制路径」（`Run::Copy`），两条重复，且成功后没有任何提示。
- 排序：[mod.rs:330](src-tauri/src/plugins/mod.rs) 只按模糊分排序；[usage.rs](src-tauri/src/usage.rs) 只存最近 21 项，不计次数、不参与排序。实测 `chr` 时 Charles / Cherry Studio / Google Chrome 同分，`c` 命中 61 个且前 8 个同分。
- 闪烁：[App.tsx:193](src/App.tsx) 每次按键先 `setItems([])`，会短暂落到「没有找到」分支（读代码得出，未真机确认）。
- 翻译链路：带入的文字也要等 400ms 防抖（[Translate.tsx:59](plugins/translate/Translate.tsx) `urgent` 初始为 false，[core.ts:119](plugins/translate/core.ts)）；每次请求新建 `reqwest::Client`（[translate.rs:330、697](src-tauri/src/plugins/translate.rs)），等于每次重新握手；单词释义要等完整 JSON 才显示。

## 执行约定

- **第 0 步**：把本计划存为 `docs/optimization-plan.md`，在 [docs/HANDOFF.md](docs/HANDOFF.md)「计划中的功能」表里加入 A–G 并注明外部插件顺延；各阶段开工时把规格细节补进 [docs/specs.md](docs/specs.md)。
- 每个阶段照 AGENTS.md 的流程：新界面先在 `docs/design/gen_boards.py` 出设计稿 → 实现 → `cd src-tauri && cargo test`、`bun test`、`bun run build` 全过 → `src/dev-mock.ts` 补假数据，浏览器核对浅色 / 深色与两种窗口尺寸 → 更新 HANDOFF 状态表和真机确认清单 → **提交前先问作者**（Conventional Commits + emoji）。
- 界面文案中文，命名统一 AhaTools。新插件照 specs「通用做法」：`plugins/<id>/plugin.json` + 页面，登记 `src/views.ts`、`BUILTIN_MANIFESTS`、`lib.rs` 的 `generate_handler!`，图标放 `src/assets/icons/`。
- 配置新字段都带 `#[serde(default)]` 并补「旧配置能读」测试；`src/config.ts` 同步类型。
- 外部命令一律参数数组调用，不经 shell。

---

## 阶段 A：修 bug 与搜索手感

### A1 超级面板复制路径

1. **宿主统一输入**：在 [src/search-content.tsx](src/search-content.tsx)（或 sdk）加 `contentFromInput(input)`，把 `{"paths":[…]}` 解析成 `{ type: "files", paths }`。[App.tsx](src/App.tsx) 的 `receiveRequest` 和 `open` 在 `content` 为空时用它补上，`actions` 与页面都只认 `content`。`Scan.tsx:103`、`Compress.tsx` 的自行解析保留兼容。顺带修好「管理收藏的路径」把 JSON 当名称预填的问题（[Manage.tsx:16](plugins/launcher/Manage.tsx)）。
2. **去重**：[superpanel.rs](src-tauri/src/superpanel.rs) `build` 的匹配列表里过滤掉 `launcher/copy-path`、`launcher/copy-name`；「文件」组保留「复制路径」，新增「复制文件名」（同为 `Run::Copy`，不弹搜索面板）。
3. **反馈**：`Run::Copy` 成功后 `relay::notify("已复制路径")`（与 `Run::Save` 一致）。
4. 把 `build` 里生成文件动作的部分抽成纯函数，补 Rust 测试：文件上下文只出现一条复制路径，内容是逐行路径；Bun 测试覆盖 `contentFromInput`。

### A2 搜索排序会学习

- [usage.rs](src-tauri/src/usage.rs)：`Usage` 增加 `stats`（每项使用次数、最后使用时间）和 `picks`（输入词 → 选中项计数，输入词取小写去空格；总量上限约 500 条，按最久未用淘汰）。项的键沿用 `same()` 的身份（`plugin` + 去掉 input 的 `action`）。启动时载入内存，`usage_record` 增加可选参数 `query`，写盘同时更新内存，搜索不再每次读文件。
- [mod.rs](src-tauri/src/plugins/mod.rs) `search_with_disabled`：最终分 = 模糊分 + 前缀 / 词首命中加成 + 使用频率加成（对数、按时间衰减）+「这个输入上次选的就是它」的强加成（保证置顶）。同分时依次按最近使用、标题更短、字典序，结果顺序必须稳定。
- 降噪：低于最高分约 40% 的结果丢弃；单字符输入只留前缀 / 词首 / 拼音首字母命中。
- [App.tsx](src/App.tsx) `run()` 调 `usage_record` 时带上当前 `query`。
- 测试：选过 Chrome 后 `chr` 置顶；没选过时前缀优先于子序列；旧 `usage.json` 可读；`picks` 淘汰。

### A3 小修

- [App.tsx:193](src/App.tsx)：去掉每次按键的 `setItems([])`，保留上一批结果直到新结果返回；查询清空时才清。
- [launcher.rs](src-tauri/src/plugins/launcher.rs) `scan_apps`：对非 `.app` 的子目录再向下扫一层（本机漏了 `~/Applications/Chrome Apps.localized` 下 4 个）。

真机确认：访达选中单个 / 多个文件，超级面板「复制路径」「复制文件名」粘贴到文本编辑器正确，并有通知；连续几次用 `chr` 选 Chrome 后它排第一。

---

## 阶段 B：翻译提速

全部在 [plugins/translate/](plugins/translate/) 与 [translate.rs](src-tauri/src/plugins/translate.rs)。

1. **带入文字立即请求**：`Translate.tsx` 的 `urgent` 初始值改为 `Boolean(input)`，从搜索框、超级面板进入不再等防抖。
2. **复用连接**：`client()` 改为全局 `OnceLock<Client>`（保留现有超时与不跟随重定向的设置），翻译、模型列表、测试连接共用，省掉每次握手。
3. **打字防抖**：`core.ts` 的 400ms 改为 250ms；40 字以内 150ms。
4. **不让密钥检查挡路**：页面不再等 `translate_has_key` 返回才发首个请求；后端缺密钥时返回明确错误，页面据此显示「配置服务」。
5. **推理模型**：配置加可选的「附加请求参数（JSON）」`profiles[].extraBody`，在 `request_body`（translate.rs:509）里浅合并，用户可按自己服务填关闭思考的参数。设置页给出说明和校验，不替用户猜各家字段。
6. **结果缓存**：内存 LRU（约 50 条，键为配置 id + 模型 + 模式 + 方向 + 原文），重复内容直接显示；不落盘，改配置时清空。
7. **单词释义流式显示**：提示词改为按行输出的轻量格式（音标 / 词性释义 / 例句各占行），边收边渲染，不再等完整 JSON；`parseWord`、`wordText` 及测试同步。
8. **耗时可见**：结果底栏显示「首字 0.8s · 共 2.1s」，便于区分是服务慢还是本地慢。

测试：`tests/translate.test.ts` 补带入即发、缓存命中、流式释义解析；Rust 补 `extraBody` 合并（三种协议）与旧配置兼容。`?translateMock=` 加 `cached`、`extra-body`。
真机确认：`fy hello` 回车后首字时间较之前明显缩短；同一句再翻一次秒出；作者现用的 DeepSeek 配置填附加参数后生效。

---

## 阶段 C：进程管理（新插件 `processes`）

「看所有程序的占用，卡顿时直接结束」。关键词：进程、占用、卡顿、结束进程、活动监视器、process、kill、top。

- **采集**（新文件 `src-tauri/src/plugins/processes.rs`）：`/bin/ps -Axo pid=,ppid=,pcpu=,rss=,user=,comm=` 解析，沿用 [sysmon.rs](src-tauri/src/sysmon.rs) 的 `command_output` 与解析风格；本用户进程可再用 `libc::proc_pid_rusage` 取 `phys_footprint`，取不到退回 RSS（界面注明与活动监视器口径可能不同）。
- **按应用聚合**：可执行路径含 `.app/` 的归到最外层 `.app`，显示应用图标（复用 `launcher::app_icon`）、中文名（复用 `localized_name`）、CPU 合计、内存合计、进程数，可展开看子进程；另有「全部进程」平铺视图。
- **刷新**：页面可见时每 2 秒采样，面板收起或离开页面即停（参照 sysmon 的条件变量按需采样）；事件只发给面板窗口。
- **交互**：按 CPU / 内存排序；搜索过滤（复用 `plugins::match_text`，支持拼音）；顶部显示总 CPU 与内存压力（复用 `sysmon_snapshot`）；占用高的行加醒目标记。
- **结束**：「退出」对应用发正常退出、对进程发 SIGTERM；「强制结束」SIGKILL，需二次确认。不能结束 AhaTools 自身；`kernel_task`、`launchd`、`WindowServer`、`loginwindow` 等给出警告并默认禁用。无权限（root 进程）时提示原因，本轮不做提权。
- **入口**：搜索；菜单栏弹窗「最忙进程」一行点击直达（[SystemMonitor.tsx](src/SystemMonitor.tsx)）；可在插件详情绑热键。
- 设计稿 `Processes.html`；假数据 `?procMock=normal|busy|empty|error|kill-denied`。
- 测试：`ps` 输出解析（带空格和中文的路径、百分比超过 100）、聚合、排序、受保护名单。

真机确认：数值与活动监视器大致吻合；结束一个测试应用和一个普通进程；root 进程提示正确；离开页面后不再采样。

---

## 阶段 D：场景匹配（让搜索面板「懂」当前内容）

### D1 自动带入刚复制的内容

- 新文件 `src-tauri/src/clipboard_watch.rs`：后台线程约每 500ms 读 `clipboard::change_count()`，记录最近一次变化的时间和类型（文字 / 图片 / 文件）。带 `org.nspasteboard.ConcealedType`、`TransientType` 标记的复制（密码管理器）不计。阶段 F 的剪贴板历史在这个监听上加存储。
- [panel.rs](src-tauri/src/panel.rs) 的 `PanelShown` 增加 `clipboard: { changeCount, ageMs, kind }`（只有元数据）。
- [App.tsx](src/App.tsx) 收到 `panel-shown` 时，若停在搜索首页、输入为空、没有附件、`ageMs` 在阈值内且这个 `changeCount` 没带入过，则自动带入：文件 / 图片复用 [search-content.tsx](src/search-content.tsx) 现有读取（把 `paste` 里的读取逻辑抽成 `loadClipboard()`）；单行且不超过 100 字的文字填进输入框并全选；更长或多行的文字作为「文字附件」（`PluginContent` 新增 `{ type: "text", text }`，Rust 侧 `MatchContent::Text`）。esc 或退格移除；不写入历史。
- 设置 → 通用加「自动带入刚复制的内容」：关 / 3 秒 / 5 秒（默认）/ 10 秒，配置 `clipboardAutoPaste`。

### D2 按内容类型匹配

- 新文件 `src-tauri/src/plugins/detect.rs`：识别 `url`、`json`、`ip`、`domain`、`port`、`path`，纯函数带测试。清单 `match` 增加 `types: [...]`；[mod.rs](src-tauri/src/plugins/mod.rs) 的 `Match::accepts` 接入。
- 排序分三档：`关键词 + 文字`（现有 10000）> **类型命中**（新，排在普通模糊结果之前）> 任意文字匹配（保持末尾）。粘贴一段 JSON 时「格式化 JSON」排第一，粘贴域名时「ping」「DNS 查询」在前。
- 把二维码的标题特例（mod.rs:280-287）抽成清单字段 `matchTitle`（如 `为「{input}」生成二维码`），`usage.rs` 的标题特例随之删除，存储时统一用功能名。
- 超级面板的 `context_matches` 走同一套规则，类型命中排在前。

### D3 没有结果时给出路

「没有找到」页改为可直接执行的列表：用默认浏览器搜索、问各网页应用（复用超级面板的 `Run::Ask` 逻辑）、翻译、收藏为路径。

设计稿更新 `InputMatches.html`、`PanelBehavior.html`；假数据 `window.__AHATOOLS_PANEL_MOCK__.show({ clipboard })`。
真机确认：复制文字 / 图片 / 访达文件后 5 秒内按 ⌥Space 自动带入，超时不带入；从密码管理器复制的不带入；同一次复制不重复带入。

---

## 阶段 E：网络工具与 JSON

先加一个宿主小能力：`ItemAction::Copy { text }`（搜索结果直接给答案，回车复制并提示）。涉及 `mod.rs`、`src/sdk.ts`、`App.tsx` 的 `run`、`usage.rs`（这类结果不进最近使用）、`superpanel.rs` 的 `Run::Item`、`dev-mock.ts`。

### E1 网络工具（新插件 `network`，一个页面四个页签，各为一个 feature）

- **本机 IP**（`ip`、内网ip、本机ip、公网ip）：用 `libc::getifaddrs` 列出真实网卡的 IPv4 / IPv6（网卡筛选规则复用 [netspeed.rs](src-tauri/src/netspeed.rs)），加默认网关。搜索 `ip` 时结果行直接显示内网 IP，回车复制。公网 IP **点击才查询**，请求地址可在插件设置里改。
- **ping**（`ping 域名`；类型匹配 `domain` / `ip` / `url` 取主机名）：`/sbin/ping -c 10`，逐行事件流式显示，汇总丢包率与平均延迟，可停止，离开页面即结束子进程。主机名先校验字符。
- **DNS 查询**（`dns 域名`）：`/usr/bin/dig +short` 查 A / AAAA / CNAME / MX / TXT，可指定 DNS 服务器；同时给出系统实际解析结果，并标明是否被 hosts 插件的方案覆盖。
- **端口占用**（`port 3000`、端口；类型匹配 `port`）：`/usr/sbin/lsof -nP -iTCP -sTCP:LISTEN` 列出端口、进程、PID、用户，可搜索；「结束进程」复用阶段 C 的命令与确认。

### E2 JSON 工具（新插件 `json`，纯前端）

关键词 json、格式化；类型匹配 `json`。左输入右结果：格式化（2 / 4 空格）、压缩、转义 / 去转义、按键排序、树形折叠查看；错误标出行列并可点击定位；⌘C 无选区时复制结果。超过约 1MB 放到 Worker（参照二维码识别）。

设计稿 `Network.html`、`Json.html`；假数据 `?netMock=…`、`?jsonMock=…`。测试：Rust 覆盖网卡筛选、ping / dig / lsof 输出解析、主机名校验；Bun 覆盖 JSON 各操作与错误定位。
真机确认：内网 IP 与系统设置一致；ping 可中途停止；占用 3000 端口的进程能查到并结束。

---

## 阶段 F：剪贴板历史（新插件 `clipboard`）

- **记录**：在 D1 的监听上保存文字、图片（PNG 文件）、文件（只存路径）。跳过带隐藏 / 临时标记的内容，并支持按前台应用排除（默认排除常见密码管理器）。相同内容去重并提到最前。
- **存储**：`~/Library/Application Support/com.ahatools.app/clipboard/`，`history.json` 索引 + 图片文件，权限 600；默认保留 500 条 / 30 天，可调。**明文保存在本机**，设置里写明，并提供「暂停记录」「清空」。首次进入页面时说明并一键开启，默认不开。
- **页面**：列表 + 预览，搜索，按类型筛选；↵ 粘贴回之前的前台应用（收起面板 → 写剪贴板 → `relay::press("Super+KeyV")`，没有辅助功能权限时退化为只复制）；⌘C 只复制；固定、删除。
- 可在插件详情绑热键。设计稿 `ClipboardHistory.html`；假数据 `?clipMock=…`。
- 测试：去重、条数与天数淘汰、隐藏标记跳过、索引损坏时不丢其余数据。

真机确认：复制文字 / 截图 / 文件都进历史；回车粘贴到原应用；密码管理器复制的不记录；暂停后不再记录。

---

## 阶段 G：真机问题收集（贯穿）

- 新建 `docs/issues.md`：作者日常用正式版，随手记「现象 / 步骤 / 期望」，每攒一批集中修。
- 每个阶段结束用 `bun run release` 出正式版装到 `/Applications`，作者过一遍该阶段的真机确认项；顺带消化 HANDOFF 里约 50 条历史未勾选项中与本阶段相关的部分。

## 验证（每个阶段都做）

1. `cd src-tauri && cargo test`、`bun test`、`bun run build`。
2. `bun run tauri dev` 时浏览器打开 `http://localhost:1420`（超级面板 `?view=super&superMock=…`，功能页 `?open=<插件>/<功能>`），用新增的假数据参数核对浅色、深色及 880×580 / 600×400。
3. 列出需要真机权限的确认项交给作者，更新 HANDOFF。
