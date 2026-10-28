import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  BackIcon,
  formatAccelerator,
  hidePanel,
  invoke,
  NoResultIcon,
  openPath,
  PathIcon,
  PuzzleIcon,
  SearchIcon,
  type Manifest,
  type SearchItem,
} from "@ahatools/sdk";
import { pluginIcons, views } from "./views";
import "./styles.css";

type Active = { plugin: string; feature: string; input?: string } | null;

const KIND_LABEL: Record<SearchItem["kind"], string> = { app: "应用", saved: "收藏", feature: "功能" };


function ResultIcon({ item }: { item: SearchItem }) {
  if (item.kind === "app") {
    return (
      <span className="tile initial" aria-hidden="true">
        {item.title.charAt(0).toUpperCase()}
      </span>
    );
  }
  if (item.kind === "saved") {
    return (
      <span className="tile" aria-hidden="true">
        <PathIcon kind={item.icon} size={18} />
      </span>
    );
  }
  const Icon = pluginIcons[item.plugin] ?? PuzzleIcon;
  return (
    <span className="tile feature" aria-hidden="true">
      <Icon size={18} />
    </span>
  );
}

function Hint({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="hint">
      <kbd>{keys}</kbd>
      {label}
    </span>
  );
}

export default function App() {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<SearchItem[]>([]);
  const [selected, setSelected] = useState(0);
  const [active, setActive] = useState<Active>(null);
  const [manifests, setManifests] = useState<Manifest[]>([]);
  const [hotkey, setHotkey] = useState("⌥Space");
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    invoke<Manifest[]>("list_plugins").then(setManifests);
    invoke<{ accelerator: string; action: { type: string }; enabled: boolean }[]>("hotkey_bindings").then((bs) => {
      const b = bs.find((b) => b.enabled && b.action.type === "togglePanel");
      if (b) setHotkey(formatAccelerator(b.accelerator));
    });
    const unShown = listen("panel-shown", () => {
      setActive(null);
      setError(null);
      requestAnimationFrame(() => inputRef.current?.select());
    });
    const unOpen = listen<{ plugin: string; feature: string; input?: string }>("open-feature", (e) =>
      open(e.payload),
    );
    return () => {
      unShown.then((f) => f());
      unOpen.then((f) => f());
    };
  }, []);

  useEffect(() => {
    let stale = false;
    invoke<SearchItem[]>("search", { query }).then((r) => {
      if (!stale) {
        setItems(r);
        setSelected(0);
      }
    });
    return () => {
      stale = true;
    };
  }, [query]);

  useEffect(() => {
    listRef.current?.children[selected]?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const crumbs = useMemo(() => {
    if (!active) return null;
    const m = manifests.find((m) => m.id === active.plugin);
    const f = m?.features.find((f) => f.code === active.feature);
    return { plugin: m?.name ?? active.plugin, feature: f?.explain ?? active.feature };
  }, [active, manifests]);

  const shortcuts = useMemo(
    () =>
      manifests.flatMap((m) =>
        m.features.map((f) => ({ plugin: m.id, feature: f.code, label: f.explain, keyword: f.cmds[0] })),
      ),
    [manifests],
  );

  function open(target: { plugin: string; feature: string; input?: string }) {
    setStatus("");
    setError(null);
    setActive(target);
  }

  const back = () => {
    setActive(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const run = async (item: SearchItem | undefined) => {
    if (!item) return;
    setError(null);
    if (item.action.type === "openPath") {
      try {
        await openPath(item.action.path);
        setQuery("");
      } catch (e) {
        setError(String(e));
      }
    } else {
      open({ plugin: item.plugin, feature: item.action.feature, input: item.action.input });
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.metaKey && e.key === ",") {
      e.preventDefault();
      open({ plugin: "settings", feature: "general" });
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      if (active) back();
      else if (query) setQuery("");
      else hidePanel();
      return;
    }
    if (active) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(items[selected]);
    }
  };

  const View = active ? views[`${active.plugin}/${active.feature}`] : null;
  const hasQuery = query.trim() !== "";

  let body: React.ReactNode;
  let hints: React.ReactNode;
  let right: string;
  if (active) {
    body = View ? (
      <View key={`${active.plugin}/${active.feature}/${active.input ?? ""}`} onBack={back} setStatus={setStatus} input={active.input} />
    ) : (
      <div className="state">
        <span className="note">
          插件页面不存在：{active.plugin}/{active.feature}
        </span>
      </div>
    );
    hints = <Hint keys="esc" label="返回" />;
    right = status;
  } else if (items.length > 0) {
    body = (
      <ul className="results" ref={listRef}>
        {items.map((item, i) => (
          <li
            key={`${item.plugin}:${item.title}:${item.subtitle}`}
            className={`result${i === selected ? " selected" : ""}`}
            onMouseMove={() => setSelected(i)}
            onClick={() => run(item)}
          >
            <ResultIcon item={item} />
            <span className="text">
              <span className="title">{item.title}</span>
              <span className="subtitle">{item.subtitle}</span>
            </span>
            {i === selected ? (
              <span className="go">
                <kbd>↵</kbd>
                {item.kind === "feature" ? "进入" : "打开"}
              </span>
            ) : (
              <span className="kind">{KIND_LABEL[item.kind]}</span>
            )}
          </li>
        ))}
      </ul>
    );
    hints = (
      <>
        <Hint keys="↑↓" label="选择" />
        <Hint keys="↵" label="打开" />
        <Hint keys="esc" label="关闭" />
      </>
    );
    right = `${items.length} 个结果`;
  } else if (hasQuery) {
    body = (
      <div className="state">
        <span className="badge">
          <NoResultIcon />
        </span>
        <div className="headline">
          <strong>没有找到「{query.trim()}」</strong>
          <span>检查一下拼写；常用但搜不到的文件或网址，可以加进收藏</span>
        </div>
        <button type="button" className="btn" onClick={() => open({ plugin: "launcher", feature: "manage" })}>
          管理收藏
        </button>
      </div>
    );
    hints = <Hint keys="esc" label="清空" />;
    right = "0 个结果";
  } else {
    body = (
      <div className="state">
        <div className="headline">
          <strong>输入关键词开始搜索</strong>
          <span>应用名中英文都能搜，收藏的路径排在最前面</span>
        </div>
        {shortcuts.length > 0 && (
          <div className="shortcuts">
            <span>常用功能</span>
            {shortcuts.map((s) => {
              const Icon = pluginIcons[s.plugin] ?? PuzzleIcon;
              return (
                <button
                  type="button"
                  key={`${s.plugin}/${s.feature}`}
                  className="shortcut"
                  onClick={() => open({ plugin: s.plugin, feature: s.feature })}
                >
                  <span className="tile sm" aria-hidden="true">
                    <Icon />
                  </span>
                  <span className="label">{s.label}</span>
                  {s.keyword && <kbd>{s.keyword}</kbd>}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
    hints = <Hint keys="esc" label="关闭" />;
    right = `${hotkey} 随时唤出`;
  }

  return (
    <div className="panel" onKeyDown={onKeyDown}>
      {active && crumbs ? (
        <header className="panel-header crumbs" data-tauri-drag-region>
          <button type="button" className="back" onClick={back} aria-label="返回搜索">
            <BackIcon />
          </button>
          <span className="parent">{crumbs.plugin}</span>
          <span className="sep" aria-hidden="true">
            /
          </span>
          <span className="current">{crumbs.feature}</span>
        </header>
      ) : (
        <header className="panel-header" data-tauri-drag-region>
          <span className="search-icon">
            <SearchIcon />
          </span>
          <label htmlFor="q" className="sr-only">
            搜索
          </label>
          <input
            id="q"
            ref={inputRef}
            autoFocus
            spellCheck={false}
            autoComplete="off"
            placeholder="搜索应用、收藏或功能…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </header>
      )}

      <main className="panel-body">{body}</main>

      <footer className="panel-footer">
        <span className="hints">{hints}</span>
        {error ? <span className="error">{error}</span> : <span>{right}</span>}
      </footer>
    </div>
  );
}
