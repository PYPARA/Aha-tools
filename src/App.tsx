import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Menu } from "@tauri-apps/api/menu";
import {
  AppIcon,
  BackIcon,
  formatAccelerator,
  hidePanel,
  invoke,
  openPath,
  PageActionsSlot,
  PathIcon,
  FeatureIcon,
  SearchIcon,
  SlidersIcon,
  useAppearance,
  WebIcon,
  type Binding,
  type Config,
  type PathKind,
  type Manifest,
  type SearchItem,
} from "@ahatools/sdk";
import { actions, fullPageViews, views, type Target } from "./views";
import "./styles.css";

interface Home {
  recent: SearchItem[];
  pinned: SearchItem[];
}

/** Recent items shown before 「展开」: one row of the grid. */
const COLUMNS = 7;

/** Web app id → its current address, for site icons. Read from config rather than the
 * item, so entries in 最近使用 saved before an address change (or without one) still match. */
const WebAppUrls = createContext<Map<string, string>>(new Map());

function ItemIcon({ item, large }: { item: SearchItem; large?: boolean }) {
  const webUrls = useContext(WebAppUrls);
  if (item.action.type === "openWeb") {
    const url = webUrls.get(item.action.id) ?? item.icon;
    if (url) return <WebIcon url={url} name={item.title} large={large} />;
  }
  if (item.kind === "app" && item.action.type === "openPath") {
    return <AppIcon path={item.action.path} name={item.title} large={large} />;
  }
  if (item.kind !== "saved") return <FeatureIcon plugin={item.plugin} feature={item.action.type === "feature" ? item.action.feature : undefined} size={large ? 40 : 32} />;
  return <span className={large ? "tile lg" : "tile"} aria-hidden="true"><PathIcon kind={item.icon as PathKind | undefined} size={large ? 18 : 16} /></span>;
}

/** Identity of a result for pinning; a feature is the same with or without input text. */
function pinKey(item: SearchItem) {
  const a = item.action.type === "feature" ? { type: "feature", feature: item.action.feature } : item.action;
  return `${item.plugin}|${JSON.stringify(a)}`;
}

/** Grid cells laid out as rows of COLUMNS across both sections, for arrow-key moves. */
function moveInGrid(sections: number[], index: number, key: string) {
  const cells: { row: number; col: number }[] = [];
  let row = 0;
  for (const count of sections) {
    for (let i = 0; i < count; i++) cells.push({ row: row + Math.floor(i / COLUMNS), col: i % COLUMNS });
    row += Math.ceil(count / COLUMNS);
  }
  const cur = cells[index];
  if (!cur) return 0;
  if (key === "ArrowLeft") return Math.max(0, index - 1);
  if (key === "ArrowRight") return Math.min(cells.length - 1, index + 1);
  const targetRow = cur.row + (key === "ArrowDown" ? 1 : -1);
  const inRow = cells.map((c, i) => ({ ...c, i })).filter((c) => c.row === targetRow);
  if (inRow.length === 0) return index;
  return (inRow.find((c) => c.col === cur.col) ?? inRow[inRow.length - 1]).i;
}

export default function App() {
  useAppearance();
  const [query, setQuery] = useState("");
  const [searchRevision, setSearchRevision] = useState(0);
  const [items, setItems] = useState<SearchItem[]>([]);
  const [selected, setSelected] = useState(0);
  const [active, setActive] = useState<Target | null>(null);
  const [manifests, setManifests] = useState<Manifest[]>([]);
  const [home, setHome] = useState<Home>({ recent: [], pinned: [] });
  const [expanded, setExpanded] = useState(false);
  const [hotkey, setHotkey] = useState("⌥ Space");
  const [status, setStatus] = useState("");
  const [flash, setFlash] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const lastRequest = useRef(0);
  const activeRef = useRef<Target | null>(null);
  activeRef.current = active;

  const [webUrls, setWebUrls] = useState<Map<string, string>>(new Map());
  const loadHome = () => invoke<Home>("usage_home").then(setHome);
  const loadWebUrls = (cfg: Config) => setWebUrls(new Map((cfg.webApps ?? []).map((w) => [w.id, w.url])));
  const loadHotkey = () =>
    invoke<Binding[]>("hotkey_bindings").then((bs) => {
      const b = bs.find((b) => b.enabled && b.action.type === "togglePanel");
      setHotkey(b ? formatAccelerator(b.accelerator) : "");
    });

  useEffect(() => {
    invoke<Manifest[]>("list_plugins").then(setManifests);
    loadHome();
    loadHotkey();
    invoke<Config>("config_get").then(loadWebUrls);
    const subs = [
      // Like uTools, coming back shows the page that was open; esc returns to search.
      listen("panel-shown", () => {
        setError(null);
        if (activeRef.current) return;
        setExpanded(false);
        setSelected(0);
        loadHome();
        requestAnimationFrame(() => inputRef.current?.select());
      }),
      listen<Target & { query?: string }>("open-feature", (e) => receiveRequest(e.payload)),
      listen<Target & { query?: string }>("panel-query", (e) => receiveRequest(e.payload)),
      listen<Config>("config-changed", (e) => {
        loadHotkey();
        loadWebUrls(e.payload);
        setSearchRevision((v) => v + 1);
      }),
    ];
    let live = true;
    Promise.all(subs).then(() => invoke<(Target & { query?: string }) | null>("panel_pending")).then((r) => { if (live && r) receiveRequest(r); });
    return () => { live = false; subs.forEach((s) => s.then((f) => f())); };
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
  }, [query, searchRevision]);

  // Search is compact; plugin and settings pages get the larger window.
  useEffect(() => {
    invoke("set_panel_large", { large: active !== null });
  }, [active]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(""), 2000);
    return () => clearTimeout(t);
  }, [flash]);

  const hasQuery = query.trim() !== "";
  const pinnedKeys = useMemo(() => new Set(home.pinned.map(pinKey)), [home.pinned]);

  /** Shown when nothing has been used yet: every plugin feature. */
  const allFeatures = useMemo<SearchItem[]>(
    () =>
      manifests
        .filter((m) => m.id !== "settings")
        .flatMap((m) =>
          m.features.map((f) => ({
            title: f.explain,
            subtitle: m.name,
            score: 0,
            plugin: m.id,
            kind: "feature" as const,
            action: { type: "feature" as const, feature: f.code },
          })),
        ),
    [manifests],
  );

  const recent = expanded ? home.recent : home.recent.slice(0, COLUMNS);
  const sections = home.recent.length || home.pinned.length ? [recent, home.pinned] : [allFeatures];
  const gridItems = sections.flat();
  const visible = hasQuery ? items : gridItems;

  useEffect(() => {
    if (hasQuery) listRef.current?.children[selected]?.scrollIntoView({ block: "nearest" });
  }, [selected, hasQuery]);

  function open(target: Target) {
    setStatus("");
    setError(null);
    setActive(target);
  }

  function receiveRequest(request: Target & { query?: string }) {
    if (request.id && request.id <= lastRequest.current) return;
    if (request.id) { lastRequest.current = request.id; void invoke("panel_ack", { id: request.id }); }
    if (request.query !== undefined && request.query !== null) {
      setActive(null); setQuery(request.query); setError(null); setSelected(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      const act = !request.viewOnly && actions[`${request.plugin}/${request.feature}`];
      if (act) Promise.resolve(act({ input: request.input, open })).catch((e) => setError(String(e)));
      else open(request);
    }
  }

  const back = () => {
    setActive(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const run = async (item: SearchItem | undefined) => {
    if (!item) return;
    setError(null);
    invoke("usage_record", { item });
    if (item.action.type === "openWeb") {
      setQuery("");
      invoke("webapp_open", { id: item.action.id }).catch((e) => setError(String(e)));
      return;
    }
    if (item.action.type === "openPath") {
      try {
        await openPath(item.action.path);
        setQuery("");
      } catch (e) {
        setError(String(e));
      }
      return;
    }
    const key = `${item.plugin}/${item.action.feature}`;
    if (actions[key]) {
      setQuery("");
      try { await actions[key]({ input: item.action.input, open }); } catch (e) { setError(String(e)); }
    } else {
      open({ plugin: item.plugin, feature: item.action.feature, input: item.action.input });
    }
  };

  const togglePin = async (item: SearchItem | undefined) => {
    if (!item) return;
    const pinned = await invoke<boolean>("usage_toggle_pin", { item });
    setFlash(pinned ? `已固定「${item.title}」` : `已取消固定「${item.title}」`);
    loadHome();
  };

  const forget = async (item: SearchItem) => {
    await invoke("usage_forget", { item });
    setFlash(`已从最近使用中删除「${item.title}」`);
    loadHome();
  };

  /** Right-click menu, native like uTools': pin / unpin, and remove from 最近使用. */
  const showItemMenu = async (e: React.MouseEvent, item: SearchItem, inRecent: boolean) => {
    e.preventDefault();
    const pinned = pinnedKeys.has(pinKey(item));
    const entries = [
      { text: pinned ? "取消固定" : "固定到首页", accelerator: "CmdOrCtrl+D", action: () => togglePin(item) },
      ...(inRecent ? [{ text: "从「最近使用」中删除", action: () => forget(item) }] : []),
    ];
    try {
      const menu = await Menu.new({ items: entries });
      await menu.popup();
    } catch {
      // No native menus in the browser preview.
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
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
    if (e.metaKey && e.key.toLowerCase() === "d") {
      e.preventDefault();
      togglePin(visible[selected]);
    } else if (e.metaKey && /^[1-9]$/.test(e.key) && hasQuery) {
      e.preventDefault();
      run(items[Number(e.key) - 1]);
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(visible[selected]);
    } else if (hasQuery && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      setSelected((s) => Math.max(0, Math.min(s + (e.key === "ArrowDown" ? 1 : -1), items.length - 1)));
    } else if (!hasQuery && e.key.startsWith("Arrow")) {
      // Left/right stay in the text box while there's text to move through.
      if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && query) return;
      e.preventDefault();
      setSelected((s) => moveInGrid(sections.map((x) => x.length), s, e.key));
    }
  };

  // On the window, not the panel element: pages without a focused field (热键检测)
  // would otherwise never see esc.
  const keyHandler = useRef(onKeyDown);
  keyHandler.current = onKeyDown;
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const openSettings = useCallback(() => open({ plugin: "settings", feature: "general" }), []);

  // ---- Plugin and settings pages ----

  if (active) {
    const key = `${active.plugin}/${active.feature}`;
    const View = views[key];
    const viewEl = View ? (
      <View key={`${key}/${active.id ?? ""}/${active.input ?? ""}`} onBack={back} setStatus={setStatus} input={active.input} openFeature={open} />
    ) : (
      <div className="state">
        <span className="note">插件页面不存在：{key}</span>
      </div>
    );
    if (fullPageViews.has(key)) {
      return <div className="fill">{viewEl}</div>;
    }
    const m = manifests.find((m) => m.id === active.plugin);
    const f = m?.features.find((f) => f.code === active.feature);

    return (
      <div className="panel">
        <header className="page-head" data-tauri-drag-region>
          <button type="button" className="icon-btn" onClick={back} aria-label="返回搜索">
            <BackIcon size={18} />
          </button>
          <FeatureIcon plugin={active.plugin} feature={active.feature} size={30} />
          <span className="page-title" data-tauri-drag-region>
            <strong>{f?.explain ?? active.feature}</strong>
            <span>{m?.name ?? active.plugin}</span>
          </span>
          <span className="page-actions" ref={setActionsSlot} />
        </header>
        <main className="panel-body">
          <PageActionsSlot.Provider value={actionsSlot}>{viewEl}</PageActionsSlot.Provider>
        </main>
        <footer className="foot">
          <span>esc 返回搜索</span>
          <span>{status}</span>
        </footer>
      </div>
    );
  }

  // ---- Search ----

  let body: React.ReactNode;
  let hints: React.ReactNode;
  let right: React.ReactNode;

  if (hasQuery && items.length > 0) {
    body = (
      <ul className="results" ref={listRef}>
        {items.map((item, i) => (
          <li
            key={`${item.plugin}:${item.title}:${item.subtitle}`}
            className={`result${i === selected ? " selected" : ""}`}
            onMouseMove={() => setSelected(i)}
            onClick={() => run(item)}
            onContextMenu={(e) => showItemMenu(e, item, false)}
          >
            <ItemIcon item={item} />
            <span className="text">
              <span className="title">{item.title}</span>
              <span className="subtitle">{item.subtitle}</span>
            </span>
            {i === selected ? (
              <span className="go">↵ 打开</span>
            ) : (
              <span className="key">{i < 9 ? `⌘${i + 1}` : ""}</span>
            )}
          </li>
        ))}
      </ul>
    );
    hints = (
      <>
        <span>↑↓ 选择</span>
        <span>⌘1–9 直接打开</span>
        <span>右键 固定</span>
      </>
    );
    right = `${items.length} 个结果 · 拼音首字母也能搜`;
  } else if (hasQuery) {
    const q = query.trim();
    body = (
      <div className="state">
        <div className="copy">
          <p className="headline">没有找到「{q}」</p>
          <p className="lede">换个写法试试；常用但搜不到的文件或网址，可以收藏起来</p>
        </div>
        <button type="button" className="btn" onClick={() => open({ plugin: "launcher", feature: "manage", input: q })}>
          收藏一个路径
        </button>
      </div>
    );
    hints = <span>esc 清空</span>;
    right = "0 个结果";
  } else {
    const cell = (item: SearchItem, index: number, inRecent = false) => (
      <button
        type="button"
        key={`${item.plugin}:${item.title}:${index}`}
        className={`grid-item${index === selected ? " selected" : ""}`}
        onClick={() => run(item)}
        onMouseMove={() => setSelected(index)}
        onContextMenu={(e) => {
          setSelected(index);
          showItemMenu(e, item, inRecent);
        }}
        title={item.subtitle}
      >
        <ItemIcon item={item} large />
        <span className="label">{item.title}</span>
      </button>
    );
    const firstTime = sections.length === 1;
    body = (
      <div className="home">
        {firstTime ? (
          <>
            <div className="section-head">
              <h2>功能</h2>
              <span className="aside">用过的应用和功能会出现在这里</span>
            </div>
            <div className="grid">{allFeatures.map((it, i) => cell(it, i))}</div>
          </>
        ) : (
          <>
            {home.recent.length > 0 && (
              <>
                <div className="section-head">
                  <h2>最近使用</h2>
                  {home.recent.length > COLUMNS && (
                    <button type="button" className="link-btn" onClick={() => setExpanded((x) => !x)}>
                      {expanded ? "收起" : `展开 ${home.recent.length - COLUMNS}`}
                    </button>
                  )}
                </div>
                <div className="grid">{recent.map((it, i) => cell(it, i, true))}</div>
              </>
            )}
            {home.pinned.length > 0 && (
              <>
                <div className="section-head">
                  <h2>已固定</h2>
                  <span className="aside">右键或 ⌘D 固定、取消</span>
                </div>
                <div className="grid">{home.pinned.map((it, i) => cell(it, recent.length + i))}</div>
              </>
            )}
          </>
        )}
      </div>
    );
    hints = (
      <>
        <span>方向键 选择</span>
        <span>↵ 打开</span>
        <span>esc 关闭</span>
      </>
    );
    right = <span className="mono">{hotkey}</span>;
  }

  return (
    <WebAppUrls.Provider value={webUrls}>
      <div className="panel">
        <header className="search-head" data-tauri-drag-region>
          <SearchIcon />
          <label htmlFor="q" className="sr-only">
            搜索
          </label>
          <input
            id="q"
            ref={inputRef}
            autoFocus
            spellCheck={false}
            autoComplete="off"
            placeholder="搜索应用、收藏和功能"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="button" className="icon-btn" aria-label="设置" title="设置 ⌘," onClick={openSettings}>
            <SlidersIcon />
          </button>
        </header>
        <div className="hairline" />
        <main className="panel-body">{body}</main>
        <footer className="foot">
          <span className="hints">{hints}</span>
          {error ? <span className="error">{error}</span> : <span>{flash || right}</span>}
        </footer>
      </div>
    </WebAppUrls.Provider>
  );
}
