import { formatAccelerator, screenshotToolName, type Action, type Config, type Manifest } from "@ahatools/sdk";

/** What a hotkey does, as a row title and a line under it. */
export function describeAction(action: Action, cfg: Config, manifests: Manifest[]) {
  switch (action.type) {
    case "togglePanel":
      return { title: "打开搜索面板", desc: "AhaTools" };
    case "screenshot":
      return { title: "截图", desc: `截图插件 · 当前交给${screenshotToolName(cfg)}` };
    case "openFeature": {
      const m = manifests.find((m) => m.id === action.plugin);
      const f = m?.features.find((f) => f.code === action.feature);
      return {
        title: f?.explain ?? action.feature,
        desc: action.plugin === "settings" ? "AhaTools" : `${m?.name ?? action.plugin}插件`,
      };
    }
    case "openWeb": {
      const web = cfg.webApps.find((w) => w.id === action.id);
      return { title: `打开 ${web?.name ?? action.id}`, desc: "网页应用 · 窗口在最前时再按一次就收起" };
    }
    case "forward": {
      const app = cfg.relayApps.find((a) => a.id === action.app);
      const name = app?.name ?? action.app;
      return {
        title: `转发给 ${name}`,
        desc: app ? `替你按下 ${name} 自己的热键 ${formatAccelerator(app.accelerator)}` : "未知应用",
      };
    }
  }
}

/** Everything a new hotkey can do, for the 「添加热键」 menu. */
export function actionChoices(
  cfg: Config,
  manifests: Manifest[],
): { group: string; label: string; detail?: string; action: Action }[] {
  return [
    { group: "常用", label: "打开搜索面板", action: { type: "togglePanel" } },
    { group: "常用", label: "截图", action: { type: "screenshot" } },
    ...manifests
      .filter((m) => m.id !== "screenshot" && m.id !== "webapps")
      .flatMap((m) =>
        m.features.map((f) => ({
          group: "插件功能",
          label: f.explain,
          detail: m.id === "settings" ? "AhaTools" : m.name,
          action: { type: "openFeature" as const, plugin: m.id, feature: f.code },
        })),
      ),
    ...cfg.webApps.map((w) => ({
      group: "网页应用",
      label: `打开 ${w.name}`,
      action: { type: "openWeb" as const, id: w.id },
    })),
    ...cfg.relayApps
      .filter((a) => !a.screenshot)
      .map((a) => ({ group: "转发给其他应用", label: `转发给 ${a.name}`, action: { type: "forward" as const, app: a.id } })),
  ];
}
