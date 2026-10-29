# AhaTools：给 AI 的工作说明

macOS 菜单栏工具箱（Tauri 2 + Rust + React 19 + TypeScript，包管理 bun）。开工前按顺序读：

1. [docs/HANDOFF.md](docs/HANDOFF.md)：现状、目录结构、怎么运行和测试、关键约束和坑。
2. [docs/specs.md](docs/specs.md)：后续每个功能的实现规格，按里面的顺序做。
3. [docs/design-system.md](docs/design-system.md)：界面规范；每个新界面的设计稿静态版在 [docs/design/](docs/design/)。

规则：

- 界面文案和给作者的回复都用中文。
- 名称统一 AhaTools（bundle id `com.ahatools.app`），不要用 aha 小写名：作者电脑上有另一个叫 Aha 的应用。
- 每完成一项：`cd src-tauri && cargo test`、`bun run build` 都通过；在 `src/dev-mock.ts` 补假数据并在浏览器（`bun run tauri dev` 时打开 http://localhost:1420）核对浅色和深色；更新 HANDOFF 的状态表；需要真机权限的部分列给作者确认。
- 提交用 Conventional Commits + emoji（`✨ feat(scope): …`、`🐛 fix: …`、`📝 docs: …`），提交前先问作者。
- 不做自研截图；正式版发布放在所有功能之后。
