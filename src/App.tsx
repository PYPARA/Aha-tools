import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Menu } from "@tauri-apps/api/menu";
import {
  AppIcon,
  BackIcon,
  FeatureIcon,
  formatAccelerator,
  hidePanel,
  invoke,
  openPath,
  PageActionsSlot,
  PathIcon,
  SearchIcon,
  SlidersIcon,
  useAppearance,
  WebIcon,
  type Binding,
  type Config,
  type PathKind,
  type Manifest,
  type PanelShownEvent,
  type SearchItem,
  writeClipboardText,
} from "@ahatools/sdk";
import { actions, fullPageViews, views, type Target } from "./views";
import { ContentChip, useSearchContent } from "./search-content";
import { filesFromInput, preview } from "./plugin-input";
import { pinKey, type Home } from "./pinned-sort";
import { PinnedGrid, type PinnedGridHandle } from "./PinnedGrid";
import "./styles.css";

/** Recent items shown before 「展开」: one row of the grid. */
const COLUMNS = 7;
/** Rows offered when nothing matches by name: web search and asking a web app. */
const FALLBACK = "fallback";
const ASK = "fallback-ask";

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
  if (item.plugin === FALLBACK) {
    return <span className={large ? "tile lg" : "tile"} aria-hidden="true"><SearchIcon size={large ? 18 : 16} /></span>;
  }
  if (item.kind !== "saved") {
    return <FeatureIcon plugin={item.plugin} feature={item.action.type === "feature" ? item.action.feature : undefined} size={large ? 40 : 32} />;
  }
  return (
    <span className={large ? "tile lg" : "tile"} aria-hidden="true">
      <PathIcon kind={item.icon as PathKind | undefined} size={large ? 18 : 16} />
    </span>
  );
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
  const beforeLeave = useRef<(() => Promise<boolean>) | null>(null);
  const navigating = useRef(false);
  const queuedNavigation = useRef<(() => void) | null>(null);
  const registerBeforeLeave = useCallback((handler: () => Promise<boolean>) => {
    beforeLeave.current = handler;
    return () => { if (beforeLeave.current === handler) beforeLeave.current = null; };
  }, []);
  const navigate = useCallback(async (next: () => void) => {
    queuedNavigation.current = next;
    if (navigating.current) return;
    navigating.current = true;
    try {
      while (queuedNavigation.current) {
        if (beforeLeave.current && !(await beforeLeave.current())) {
          queuedNavigation.current = null;
          return;
        }
        beforeLeave.current = null;
        const apply = queuedNavigation.current;
        queuedNavigation.current = null;
        apply?.();
      }
    } catch (error) {
      queuedNavigation.current = null;
      setError(String(error));
    } finally {
      navigating.current = false;
    }
  }, []);
  const { content, loading: contentLoading, dragging, clear: clearContent, paste, drop, setDragging, bringIn } = useSearchContent(!active, () => {
    setQuery(""); setSelected(0);
  }, setError);
  const queryRef = useRef(query);
  queryRef.current = query;
  const contentRef = useRef(content);
  contentRef.current = content;
  /** The last copy brought in, so reopening the panel doesn't bring it in again. */
  const broughtIn = useRef(-1);
  const sorting = useRef<PinnedGridHandle>(null);

  const [webUrls, setWebUrls] = useState<Map<string, string>>(new Map());
  const [webApps, setWebApps] = useState<Config["webApps"]>([]);
  const [webSearch, setWebSearch] = useState("");
  const loadHome = () => invoke<Home>("usage_home").then(setHome);
  const [superPins, setSuperPins] = useState<SearchItem[]>([]);
  const loadWebUrls = (cfg: Config) => {
    setWebUrls(new Map((cfg.webApps ?? []).map((w) => [w.id, w.url])));
    setWebApps(cfg.webApps ?? []);
    setWebSearch(cfg.webSearch ?? "");
    setSuperPins(cfg.superPanel?.pinned ?? []);
  };
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
      listen<PanelShownEvent>("panel-shown", (event) => {
        setError(null);
        // Like uTools: what was copied a moment ago becomes the input.
        const copied = event.payload?.clipboard;
        const bringInCopy = (cleared: boolean) => {
          if (!copied || copied.changeCount === broughtIn.current || activeRef.current) return;
          if (!cleared && (queryRef.current.trim() || contentRef.current)) return;
          broughtIn.current = copied.changeCount;
          void bringIn(copied.kind, (text) => {
            setQuery(text);
            requestAnimationFrame(() => inputRef.current?.select());
          });
        };
        const showSearch = (cleared = false) => {
          setExpanded(false);
          setSelected(0);
          loadHome();
          requestAnimationFrame(() => inputRef.current?.select());
          bringInCopy(cleared);
        };
        if (event.payload?.reset) {
          // Reopening may reset a page, but must still protect unsaved plugin drafts.
          if (beforeLeave.current && activeRef.current) {
            void invoke("set_panel_large", { large: true }).catch((error) => setError(String(error)));
          }
          void navigate(() => {
            sorting.current?.cancel();
            activeRef.current = null;
            setActive(null);
            clearContent();
            setStatus("");
            setFlash("");
            setItems([]);
            showSearch(true);
          });
          return;
        }
        if (activeRef.current) return;
        showSearch();
      }),
      listen<Target & { query?: string }>("open-feature", (e) => receiveRequest(e.payload)),
      listen<Target & { query?: string }>("panel-query", (e) => receiveRequest(e.payload)),
      // The super panel's 「固定」 cell explains how to pin from here.
      listen<string>("panel-flash", (e) => setFlash(e.payload)),
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

  // While typing, the previous results stay until the new ones arrive, so the list never
  // blinks empty or flashes 「没有找到」. They're dropped only when the input itself changes.
  const [searched, setSearched] = useState<{ query: string; content: unknown }>({ query: "", content: null });
  useEffect(() => { setItems([]); }, [content]);
  useEffect(() => {
    let stale = false;
    if (!query.trim() && !content) setItems([]);
    const described = content?.type === "files" ? { type: "files", paths: content.paths }
      : content?.type === "text" ? { type: "text", text: content.text } : content ? { type: "image" } : null;
    invoke<SearchItem[]>("search", { query, content: described }).then((r) => {
      if (!stale) {
        setItems(r);
        setSelected(0);
        setSearched({ query, content });
      }
    }).catch((error) => { if (!stale) setError(`搜索失败：${String(error)}`); });
    return () => {
      stale = true;
    };
  }, [query, searchRevision, content]);
  const settled = searched.query === query && searched.content === content;

  // Search is compact; plugin and settings pages get the larger window.
  useEffect(() => {
    invoke("set_panel_large", { large: active !== null });
  }, [active]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(""), Math.min(5000, 1200 + Array.from(flash).length * 120));
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
  // Nothing matched by name (at most 「翻译」-style text matches): search the web or
  // ask a web app instead of a dead end.
  const fallback = useMemo<SearchItem[]>(() => {
    const q = query.trim();
    if (!q || content || !settled || items.some((item) => item.score >= 0)) return [];
    const extra = (title: string, subtitle: string, plugin: string, action: SearchItem["action"], icon?: string): SearchItem =>
      ({ title, subtitle, score: -2, plugin, kind: "feature", icon, action });
    let engine = "";
    try { engine = new URL(webSearch.replace("{q}", "")).hostname.replace(/^www\./, ""); } catch { /* no usable engine */ }
    return [
      ...(engine ? [extra(`在网上搜索「${preview(q)}」`, `${engine} · 用默认浏览器打开`, FALLBACK, { type: "openPath", path: webSearch.replace("{q}", encodeURIComponent(q)) })] : []),
      ...webApps.map((w) => extra(`问 ${w.name}`, "复制后打开，粘贴即可提问", ASK, { type: "openWeb", id: w.id }, w.url)),
      extra(`收藏「${preview(q)}」`, "快捷启动 · 收藏一个路径或网址", "launcher", { type: "feature", feature: "manage", input: q }),
    ];
  }, [query, content, settled, items, webApps, webSearch]);
  const results = fallback.length ? [...items, ...fallback] : items;
  const visible = contentLoading ? [] : content ? items : hasQuery ? results : gridItems;

  useEffect(() => {
    if (hasQuery) listRef.current?.children[selected]?.scrollIntoView({ block: "nearest" });
  }, [selected, hasQuery]);

  function open(target: Target) {
    if (activeRef.current === target) return;
    void navigate(() => {
      activeRef.current = target;
      setStatus("");
      setError(null);
      setActive(target);
    });
  }

  function receiveRequest(request: Target & { query?: string }) {
    if (request.id && request.id <= lastRequest.current) return;
    if (request.id) { lastRequest.current = request.id; void invoke("panel_ack", { id: request.id }); }
    if (request.query !== undefined && request.query !== null) {
      void navigate(() => {
        activeRef.current = null; setActive(null); clearContent(); sorting.current?.cancel();
        setQuery(request.query!); setError(null); setSelected(0); setStatus("");
        requestAnimationFrame(() => inputRef.current?.focus());
      });
    } else {
      // A Finder selection from the super panel arrives as text; features read it as files.
      const paths = request.content ? null : filesFromInput(request.input);
      const target: Target = paths ? { ...request, input: undefined, content: { type: "files", paths } } : request;
      const act = !target.viewOnly && actions[`${target.plugin}/${target.feature}`];
      if (act) Promise.resolve().then(() => act({ input: target.input, content: target.content, open }))
        .then((message) => { if (typeof message === "string") setFlash(message); })
        .catch((e) => setError(String(e).replace(/^Error: /, "")));
      else open(target);
    }
  }

  const back = () => {
    void navigate(() => {
      const target = activeRef.current?.returnTo ?? null;
      activeRef.current = target;
      setActive(target);
      requestAnimationFrame(() => inputRef.current?.focus());
    });
  };

  const run = async (item: SearchItem | undefined) => {
    if (!item) return;
    setError(null);
    if (item.plugin === ASK && item.action.type === "openWeb") {
      // Web apps can't take text directly: copy it so a paste asks the question.
      try {
        await writeClipboardText(query.trim());
        await invoke("webapp_open", { id: item.action.id });
        setQuery("");
      } catch (e) { setError(String(e)); }
      return;
    }
    // The typed query teaches search which result it should lead to next time.
    if (item.action.type === "copy") {
      // An answer in the list (「ip」 → 192.168.1.10): copy it and get out of the way.
      try {
        await writeClipboardText(item.action.text);
        setQuery("");
        hidePanel();
      } catch (e) { setError(String(e)); }
      return;
    }
    if (item.plugin !== FALLBACK) invoke("usage_record", { item, query: content ? null : query.trim() || null });
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
      if (!content) setQuery("");
      try {
        const message = await actions[key]({ input: item.action.input, content: content ?? undefined, open });
        if (typeof message === "string") setFlash(message);
      } catch (error) { setError(String(error).replace(/^Error: /, "")); }
    } else {
      open({ plugin: item.plugin, feature: item.action.feature, input: item.action.input, content: content ?? undefined });
    }
  };

  const togglePin = async (item: SearchItem | undefined) => {
    if (!item || item.plugin === FALLBACK || item.plugin === ASK || item.action.type === "copy") return;
    const pinned = await invoke<boolean>("usage_toggle_pin", { item });
    setFlash(pinned ? `已固定「${item.title}」` : `已取消固定「${item.title}」`);
    loadHome();
  };

  const superKey = (i: SearchItem) => `${i.plugin}/${JSON.stringify(i.action.type === "feature" ? { type: "feature", feature: i.action.feature } : i.action)}`;
  const toggleSuperPin = async (item: SearchItem) => {
    try {
      const pinned = await invoke<boolean>("superpanel_toggle_pin", { item });
      setFlash(pinned ? `已固定到超级面板「${item.title}」` : `已从超级面板移除「${item.title}」`);
    } catch (e) {
      setError(String(e));
    }
  };

  const forget = async (item: SearchItem) => {
    await invoke("usage_forget", { item });
    setFlash(`已从最近使用中删除「${item.title}」`);
    loadHome();
  };

  /** Right-click menu, native like uTools': pin / unpin, and remove from 最近使用. */
  const showItemMenu = async (e: React.MouseEvent, item: SearchItem, inRecent: boolean) => {
    e.preventDefault();
    if (item.plugin === FALLBACK || item.plugin === ASK || item.action.type === "copy") return;
    const pinned = pinnedKeys.has(pinKey(item));
    const entries = [
      { text: pinned ? "取消固定" : "固定到首页", accelerator: "CmdOrCtrl+D", action: () => togglePin(item) },
      ...(item.plugin === "superpanel" ? [] : [{
        text: superPins.some((p) => superKey(p) === superKey(item)) ? "从超级面板移除" : "固定到超级面板",
        action: () => toggleSuperPin(item),
      }]),
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
    if (e.defaultPrevented || e.isComposing) return;
    if (e.metaKey && e.key === ",") {
      e.preventDefault();
      open({ plugin: "settings", feature: "general" });
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      if (sorting.current?.cancel()) return;
      if (active) back();
      else if (query) setQuery("");
      else if (content || contentLoading) clearContent();
      else hidePanel();
      return;
    }
    if (active) return;
    if (sorting.current?.isSorting()) { e.preventDefault(); return; }
    // Backspace in an empty box removes the attachment, like deleting a token.
    if (e.key === "Backspace" && !query && (content || contentLoading) && e.target === inputRef.current) {
      e.preventDefault();
      clearContent();
      return;
    }
    if (e.key === "Enter" && e.target instanceof Element && e.target.closest("button")) return;
    if (e.metaKey && e.key.toLowerCase() === "d") {
      e.preventDefault();
      togglePin(visible[selected]);
    } else if (e.metaKey && /^[1-9]$/.test(e.key) && (hasQuery || content)) {
      e.preventDefault();
      run((content ? items : results)[Number(e.key) - 1]);
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(visible[selected]);
    } else if (!content && hasQuery && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      setSelected((s) => Math.max(0, Math.min(s + (e.key === "ArrowDown" ? 1 : -1), results.length - 1)));
    } else if ((!hasQuery || content) && e.key.startsWith("Arrow")) {
      // Left/right stay in the text box while there's text to move through.
      if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && query) return;
      e.preventDefault();
      setSelected((s) => moveInGrid(content ? [items.length] : sections.map((x) => x.length), s, e.key));
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
      <View key={`${key}/${active.id ?? ""}/${active.input ?? ""}`} onBack={back} setStatus={setStatus} input={active.input} content={active.content} openFeature={open}
        registerBeforeLeave={registerBeforeLeave} />
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
        <main className={`panel-body${key === "hosts/hosts" ? " hosts-body" : ""}`}>
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

  if (contentLoading) {
    body = <div className="state"><p className="lede" role="status">正在读取粘贴的图片…</p></div>;
    hints = <span>esc 取消</span>;
    right = "读取中";
  } else if (content) {
    body = (
      <div className="home">
        <div className="section-head"><h2>匹配结果</h2><span className="aside">只显示适用于当前内容的功能</span></div>
        {items.length ? <div className="grid" aria-label="匹配结果">{items.map((item, i) => (
          <button type="button" key={pinKey(item)} className={`grid-item${i === selected ? " selected" : ""}`}
            onMouseMove={() => setSelected(i)} onClick={() => run(item)} onContextMenu={(event) => showItemMenu(event, item, false)}>
            <ItemIcon item={item} large /><span className="label">{item.title}</span>
          </button>
        ))}</div> : <div className="home-empty"><p className="lede">{hasQuery ? "没有符合筛选条件的功能" : "当前没有适用的功能"}</p><p className="note">{hasQuery ? "换个关键词，或清空筛选条件" : "可在插件详情的「自动匹配」中检查开关；二维码识别支持 PNG、JPEG 和 WebP"}</p></div>}
      </div>
    );
    hints = <><span>方向键 选择</span><span>↵ 打开</span><span>esc {hasQuery ? "清空筛选" : "移除内容"}</span></>;
    right = `${items.length} 个匹配功能`;
  } else if (hasQuery && results.length > 0) {
    body = (
      <ul className="results" ref={listRef}>
        {results.map((item, i) => (
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
              <span className="go">{item.action.type === "copy" ? "↵ 复制" : "↵ 打开"}</span>
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
    right = fallback.length ? "没有名称匹配的结果 · 可在网上搜索" : `${items.length} 个结果 · 拼音首字母也能搜`;
  } else if (hasQuery && !settled) {
    // First keystroke from an empty box: nothing to keep on screen yet.
    body = <div className="state" aria-busy="true" />;
    hints = <span>esc 清空</span>;
    right = "搜索中";
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
        key={pinKey(item)}
        className={`grid-item${index === selected ? " selected" : ""}`}
        onClick={() => run(item)}
        onMouseMove={() => { if (!sorting.current?.isSorting()) setSelected(index); }}
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
                  <span className="aside">拖拽排序 · 右键或 ⌘D 取消固定</span>
                </div>
                <PinnedGrid ref={sorting} items={home.pinned} selected={selected} offset={recent.length} onSelect={setSelected}
                  onOpen={run} onContextMenu={(event, item) => showItemMenu(event, item, false)}
                  onReorder={(pinned) => setHome((previous) => ({ ...previous, pinned }))} onReload={setHome}
                  onReport={(message, failed) => { if (failed) setError(message); else { setError(null); setFlash(message); } }}
                  renderIcon={(item) => <ItemIcon item={item} large />} />
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
      <div className={`panel${dragging ? " content-dragging" : ""}`} onPaste={paste}
        onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); setDragging(true); } }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
        onDrop={drop}>
        <header className="search-head" data-tauri-drag-region>
          {content ? <ContentChip content={content} clear={() => { clearContent(); inputRef.current?.focus(); }} /> : <SearchIcon />}
          <label htmlFor="q" className="sr-only">
            搜索
          </label>
          <input
            id="q"
            ref={inputRef}
            autoFocus
            spellCheck={false}
            autoComplete="off"
            placeholder={content ? "筛选适用功能" : "搜索应用、收藏和功能"}
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
