// The settings window: a sidebar of app-wide sections. Plugin-specific settings live in
// each plugin's detail page (已安装插件 → 设置), not here.

import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { BackIcon, invoke, type Config, type Manifest, type PluginViewProps } from "@ahatools/sdk";
import General from "./General";
import Hotkeys from "./Hotkeys";
import Plugins from "./Plugins";
import Commands from "./Commands";
import About from "./About";
import SuperPanel from "./SuperPanel";

type Section = "general" | "hotkeys" | "superpanel" | "plugins" | "commands" | "about";

const NAV: ({ id: Section; label: string } | { group: string })[] = [
  { id: "general", label: "通用" },
  { id: "hotkeys", label: "全局热键" },
  { id: "superpanel", label: "超级面板" },
  { group: "插件" },
  { id: "plugins", label: "已安装插件" },
  { id: "commands", label: "所有指令" },
  { group: "其他" },
  { id: "about", label: "关于 AhaTools" },
];

/** input: "hotkeys", or "plugins/<plugin id>[/<tab>]" to open a plugin's detail page. */
function parseInput(input?: string): { section: Section; plugin?: string; tab?: string } {
  const [section, plugin, tab] = (input ?? "").split("/");
  const known = NAV.some((n) => "id" in n && n.id === section);
  return known ? { section: section as Section, plugin, tab } : { section: "general" };
}

export interface SectionProps {
  cfg: Config;
  save: (cfg: Config) => void;
  manifests: Manifest[];
}

export default function Settings({ onBack, input }: PluginViewProps) {
  const initial = parseInput(input);
  const [section, setSection] = useState<Section>(initial.section);
  const [focusPlugin, setFocusPlugin] = useState(initial.plugin);
  const [cfg, setCfg] = useState<Config | null>(null);
  const [manifests, setManifests] = useState<Manifest[]>([]);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    invoke<Config>("config_get").then(setCfg);
    invoke<Manifest[]>("list_plugins").then(setManifests);
    // The popover and the exclusive switch elsewhere also change the config.
    const un = listen<Config>("config-changed", (e) => setCfg(e.payload));
    return () => {
      un.then((f) => f());
    };
  }, []);

  /** Saves and applies at once; hotkeys take effect without a restart. */
  const save = async (next: Config) => {
    setCfg(next);
    try {
      setErrors(await invoke<string[]>("config_set", { config: next }));
    } catch (e) {
      setErrors([`没能保存：${e}`]);
    }
  };

  const openPlugin = (id: string) => {
    setFocusPlugin(id);
    setSection("plugins");
  };

  const props = cfg && { cfg, save, manifests };

  return (
    <div className="settings">
      <nav className="side" aria-label="设置分类">
        <span className="side-head" data-tauri-drag-region>
          <button type="button" className="icon-btn sm" aria-label="返回搜索" onClick={onBack}>
            <BackIcon />
          </button>
          <strong>设置</strong>
        </span>
        {NAV.map((n) =>
          "group" in n ? (
            <span key={n.group} className="side-group">
              {n.group}
            </span>
          ) : (
            <button
              key={n.id}
              type="button"
              className="side-item"
              aria-current={section === n.id ? "page" : undefined}
              onClick={() => setSection(n.id)}
            >
              {n.label}
            </button>
          ),
        )}
      </nav>
      {props && section === "plugins" ? (
        <Plugins {...props} key={focusPlugin} initialPlugin={focusPlugin} initialTab={initial.tab} errors={errors} />
      ) : (
        <div className="content" data-tauri-drag-region>
          {errors.length > 0 && (
            <div className="banner" role="status">
              {errors.join("；")}
            </div>
          )}
          {props && section === "general" && <General {...props} />}
          {props && section === "hotkeys" && <Hotkeys {...props} />}
          {props && section === "superpanel" && <SuperPanel {...props} onOpenPlugins={() => setSection("plugins")} />}
          {props && section === "commands" && <Commands {...props} onOpenPlugin={openPlugin} />}
          {section === "about" && <About />}
        </div>
      )}
    </div>
  );
}
