import { formatAccelerator, featureAction, PuzzleIcon, sameAction } from "@ahatools/sdk";
import { pluginIcons } from "../../src/views";
import type { SectionProps } from "./Settings";

/** Every feature of every plugin, with its keywords and hotkey. */
export default function Commands({ cfg, manifests, onOpenPlugin }: SectionProps & { onOpenPlugin: (id: string) => void }) {
  const rows = manifests.flatMap((m) => m.features.map((f) => ({ m, f })));
  return (
    <>
      <div className="content-head">
        <span>
          <h1 className="page-h1">所有指令</h1>
          <span className="note">在搜索框输入关键词就能找到；点一行去插件详情设热键</span>
        </span>
      </div>
      <ul className="list">
        {rows.map(({ m, f }) => {
          const Icon = pluginIcons[m.id] ?? PuzzleIcon;
          const b = cfg.hotkeys.find((b) => b.enabled && sameAction(b.action, featureAction(m.id, f.code)));
          const clickable = m.id !== "settings";
          return (
            <li
              key={`${m.id}/${f.code}`}
              onClick={clickable ? () => onOpenPlugin(m.id) : undefined}
              style={{ height: "auto", minHeight: 54, padding: "8px 10px" }}
            >
              <span className="tile" aria-hidden="true">
                <Icon />
              </span>
              <span className="info">
                <span className="name">{f.explain}</span>
                <span className="path">
                  {m.id === "settings" ? "AhaTools" : m.name} · {f.cmds.join("、")}
                </span>
              </span>
              {b && <span className="mono note">{formatAccelerator(b.accelerator)}</span>}
            </li>
          );
        })}
      </ul>
    </>
  );
}
