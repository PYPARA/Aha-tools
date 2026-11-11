import { useEffect, useMemo, useRef, useState } from "react";
import { CopyIcon, PageActions, Select, Switch, hasTextSelection, writeClipboardText, type PluginViewProps } from "@ahatools/sdk";
import { byteSize, transform, type JsonMode } from "./model";

// Kept for this run only, so coming back to the page keeps the document.
let draft = { text: "", mode: "format" as JsonMode, indent: 2, sort: false, tree: false };

const MODES: [JsonMode, string][] = [["format", "格式化"], ["minify", "压缩"], ["escape", "转义"], ["unescape", "去转义"]];
/** Larger documents skip the tree: thousands of nodes make the page sluggish. */
const TREE_LIMIT = 2000;

function countNodes(value: unknown, limit: number): number {
  let count = 0;
  const walk = (v: unknown) => {
    if (++count > limit || !v || typeof v !== "object") return;
    for (const child of Object.values(v)) walk(child);
  };
  walk(value);
  return count;
}

function Tree({ name, value, depth }: { name?: string; value: unknown; depth: number }) {
  const label = name !== undefined && <span className="json-key">{name}: </span>;
  if (value === null || typeof value !== "object") {
    const kind = value === null ? "null" : typeof value;
    return <div className="json-leaf">{label}<span className={`json-${kind}`}>{JSON.stringify(value)}</span></div>;
  }
  const entries = Object.entries(value);
  const array = Array.isArray(value);
  return <details className="json-node" open={depth < 2}>
    <summary>{label}<span className="note">{array ? `[${entries.length}]` : `{${entries.length}}`}</span></summary>
    {entries.map(([k, v]) => <Tree key={k} name={array ? undefined : k} value={v} depth={depth + 1} />)}
  </details>;
}

export default function Json({ input, setStatus }: PluginViewProps) {
  const [text, setText] = useState(() => input ?? draft.text);
  const [mode, setMode] = useState(draft.mode);
  const [indent, setIndent] = useState(draft.indent);
  const [sort, setSort] = useState(draft.sort);
  const [tree, setTree] = useState(draft.tree);
  const [copied, setCopied] = useState(false);
  const source = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { draft = { text, mode, indent, sort, tree }; }, [text, mode, indent, sort, tree]);

  const result = useMemo(() => text.trim() ? transform(text, mode, { indent, sort }) : { output: "" }, [text, mode, indent, sort]);
  const treeable = tree && result.value !== undefined && countNodes(result.value, TREE_LIMIT) <= TREE_LIMIT;

  const copy = async () => {
    if (!result.output) return;
    await writeClipboardText(result.output);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  useEffect(() => {
    setStatus(result.output ? `⌘C 复制结果 · ${byteSize(result.output)}` : "粘贴 JSON 即可格式化");
  }, [result.output, setStatus]);
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e) => {
    if (e.metaKey && !e.altKey && !e.ctrlKey && e.key.toLowerCase() === "c" && !hasTextSelection()) {
      e.preventDefault();
      void copy();
    }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  const jump = () => {
    const el = source.current;
    if (!el || !result.error) return;
    el.focus();
    el.setSelectionRange(result.error.offset, Math.min(text.length, result.error.offset + 1));
  };

  return <div className="json-view">
    <PageActions>
      <button type="button" className="btn sm" disabled={!result.output} onClick={() => void copy()}><CopyIcon />{copied ? "已复制" : "复制结果"}</button>
    </PageActions>
    <div className="json-toolbar">
      <div className="seg" role="tablist" aria-label="处理方式">
        {MODES.map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={mode === value} onClick={() => setMode(value)}>{label}</button>)}
      </div>
      {(mode === "format" || mode === "unescape") && <Select<string> id="json-indent" label="缩进" value={String(indent)} onChange={(v) => setIndent(Number(v))}
        options={[{ value: "2", label: "2 个空格" }, { value: "4", label: "4 个空格" }]} />}
      {(mode === "format" || mode === "minify") && <label className="json-switch"><span className="note">键名排序</span><Switch label="键名排序" checked={sort} onChange={setSort} /></label>}
      {mode === "format" && <label className="json-switch"><span className="note">树形查看</span><Switch label="树形查看" checked={tree} onChange={setTree} /></label>}
    </div>
    <div className="json-columns">
      <textarea ref={source} className="json-source mono" autoFocus spellCheck={false} aria-label="原始内容" value={text}
        placeholder={'粘贴 JSON，例如 {"name": "AhaTools"}'} onChange={(e) => setText(e.target.value)} />
      <div className="json-result" aria-label="处理结果">
        {result.error ? <div className="json-error" role="alert">
          <p className="bad-text">第 {result.error.line} 行第 {result.error.column} 列：{result.error.message}</p>
          <button type="button" className="btn sm" onClick={jump}>定位到出错处</button>
        </div> : treeable ? <div className="json-tree mono"><Tree value={result.value} depth={0} /></div>
          : <pre className="json-output mono">{result.output || <span className="note">结果会出现在这里</span>}</pre>}
        {tree && result.value !== undefined && !treeable && <p className="note">内容太大，改用文本显示。</p>}
      </div>
    </div>
  </div>;
}
