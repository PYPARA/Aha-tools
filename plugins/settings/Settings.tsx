import { useEffect, useState } from "react";
import { invoke, type PluginViewProps } from "@ahatools/sdk";
import type { Config } from "./types";
import HotkeysTab from "./HotkeysTab";
import ScreenshotTab from "./ScreenshotTab";

const TABS = [
  { id: "hotkeys", label: "热键" },
  { id: "screenshot", label: "截图" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export default function Settings({ setStatus, input }: PluginViewProps) {
  const [tab, setTab] = useState<Tab>(TABS.some((t) => t.id === input) ? (input as Tab) : "hotkeys");
  const [cfg, setCfg] = useState<Config | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    invoke<Config>("config_get").then(setCfg);
  }, []);

  useEffect(() => {
    setStatus(errors.length ? `有 ${errors.length} 个热键没能生效` : "改动立即生效");
  }, [errors, setStatus]);

  /** Saves and applies at once; hotkeys take effect without a restart. */
  const save = async (next: Config) => {
    setCfg(next);
    setErrors(await invoke<string[]>("config_set", { config: next }));
  };

  return (
    <div className="view">
      <div className="segmented" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? "active" : ""}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {errors.length > 0 && (
        <div className="banner warn" role="status">
          <span className="message">{errors.join("；")}</span>
        </div>
      )}
      {cfg && tab === "hotkeys" && <HotkeysTab cfg={cfg} save={save} />}
      {cfg && tab === "screenshot" && <ScreenshotTab cfg={cfg} save={save} />}
    </div>
  );
}
