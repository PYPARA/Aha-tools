import { useEffect, useRef, useState } from "react";
import {
  CopyIcon,
  PageActions,
  Select,
  invoke,
  onConfigChanged,
  onTranslation,
  pluginSettingsTarget,
  translateHasKey,
  translateSelect,
  translateStart,
  translateStop,
  writeClipboardText,
  type Config,
  type PluginViewProps,
  type TranslateDirection,
  type TranslateMode,
} from "@ahatools/sdk";
import {
  TranslationController,
  parseWord,
  wordText,
  type TranslationSnapshot,
} from "./core";

// Transient draft only; a new search input always replaces it. No disk or browser storage.
let draft = { text: "", mode: "translate" as TranslateMode };
const phaseText = {
  idle: "等待输入",
  waiting: "等待输入结束…",
  streaming: "正在输出…",
  completed: "已完成",
  stopped: "已停止",
  error: "未完成",
};

export default function Translate({
  input,
  setStatus,
  openFeature,
}: PluginViewProps) {
  const [text, setText] = useState(() => input ?? draft.text);
  const [mode, setMode] = useState<TranslateMode>(draft.mode);
  const [cfg, setCfg] = useState<Config | null>(null);
  const [keyState, setKeyState] = useState("loading");
  const [notice, setNotice] = useState("");
  const [ready, setReady] = useState(false);
  const [composing, setComposing] = useState(false);
  const [retry, setRetry] = useState(0);
  const [snapshot, setSnapshot] = useState<TranslationSnapshot>({
    phase: "idle",
    text: "",
    error: "",
    word: false,
  });
  const controller = useRef<TranslationController | null>(null);
  // How the next request goes out: "now" skips the typing pause (text carried in from
  // search or the super panel, a new mode), "force" also skips the cache (重新翻译).
  const urgent = useRef<"" | "now" | "force">(input ? "now" : "");
  const profile = cfg?.translate.profiles.find(
    (p) => p.id === cfg.translate.activeProfileId,
  );
  const direction = cfg?.translate.direction ?? "auto";
  // Don't hold the first request for the key check: a missing key fails on the native
  // side with its own message, and the check then shows 配置服务.
  const keyReady = keyState === "ready" || keyState === "loading";
  const variant = JSON.stringify([profile?.model ?? "", profile?.extraBody ?? null]);
  useEffect(() => {
    draft = { text, mode };
  }, [text, mode]);
  useEffect(() => {
    let alive = true;
    invoke<Config>("config_get")
      .then((c) => {
        if (alive) setCfg(c);
      })
      .catch((e) => {
        if (alive) setNotice(String(e));
      });
    const un = onConfigChanged((c) => {
      if (alive) setCfg(c);
    });
    return () => {
      alive = false;
      void un.then((f) => f());
    };
  }, []);
  useEffect(() => {
    let alive = true;
    const c = new TranslationController(
      { start: translateStart, stop: translateStop, subscribe: onTranslation },
      setSnapshot,
    );
    controller.current = c;
    c.connect()
      .then((ok) => {
        if (alive) setReady(ok);
      })
      .catch((e) => {
        if (alive) setNotice(String(e));
      });
    return () => {
      alive = false;
      c.dispose();
      controller.current = null;
    };
  }, []);
  useEffect(() => {
    let stale = false;
    setKeyState("loading");
    if (!profile) {
      setKeyState("missing");
      return;
    }
    translateHasKey(profile.id).then(
      (has) => {
        if (!stale) setKeyState(has ? "ready" : "missing");
      },
      (e) => {
        if (!stale) setKeyState(String(e));
      },
    );
    return () => {
      stale = true;
    };
  }, [profile?.id, profile?.baseUrl, profile?.protocol]);
  useEffect(() => {
    if (!ready) return;
    const request =
      profile && keyReady && !composing
        ? { profileId: profile.id, text, mode, direction }
        : null;
    const how = request ? urgent.current : "";
    controller.current?.update(request, { immediate: how !== "", force: how === "force", variant });
    if (request) urgent.current = "";
    setNotice("");
  }, [
    ready,
    profile?.id,
    variant,
    keyReady,
    composing,
    text,
    mode,
    direction,
    retry,
  ]);
  useEffect(() => {
    setStatus("⌘↵ 重新翻译 · ⌘C 复制结果");
  }, [setStatus]);

  // Senses appear line by line while the answer streams in.
  const word = snapshot.word ? parseWord(snapshot.text) : null;
  const copyText = word ? wordText(text.trim(), word) : snapshot.text;
  const busy = snapshot.phase === "streaming" || snapshot.phase === "waiting";
  const copy = async () => {
    try {
      await writeClipboardText(copyText);
      setNotice("已复制结果");
    } catch (e) {
      setNotice(`复制失败：${String(e)}`);
    }
  };
  const run = () => {
    urgent.current = "force";
    setRetry((r) => r + 1);
  };
  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {});
  keyHandler.current = (e) => {
    if (
      e.defaultPrevented ||
      e.isComposing ||
      !e.metaKey ||
      e.altKey ||
      e.ctrlKey ||
      e.shiftKey
    )
      return;
    if (e.key === "Enter") {
      e.preventDefault();
      run();
    }
    if (e.key.toLowerCase() === "c" && copyText && !hasSelection()) {
      e.preventDefault();
      void copy();
    }
  };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  const settings = () =>
    openFeature(
      pluginSettingsTarget("translate", {
        plugin: "translate",
        feature: "translate",
      }),
    );
  const configure = async (changes: {
    profileId?: string;
    direction?: TranslateDirection;
  }) => {
    if (!cfg) return;
    urgent.current = "now";
    controller.current?.stop();
    try {
      setCfg(await translateSelect(changes));
    } catch (e) {
      urgent.current = "";
      setNotice(`保存失败：${String(e)}`);
    }
  };
  return (
    <div className="translate-view">
      <PageActions>
        <button type="button" className="btn ghost" onClick={settings}>
          配置服务
        </button>
      </PageActions>
      <div className="translate-toolbar">
        <Select id="translate-profile" label="当前配置" placeholder="请选择配置" value={profile?.id ?? ""}
          onChange={(profileId) => void configure({ profileId })}
          options={cfg?.translate.profiles.map((p) => ({ value: p.id, label: p.name, keywords: p.model })) ?? []} />
        <Select<TranslateDirection> id="translate-direction" label="翻译方向" disabled={mode !== "translate"} value={direction}
          onChange={(direction) => void configure({ direction })} options={[
            { value: "auto", label: "自动方向" },
            { value: "en-zh", label: "英文 → 中文" },
            { value: "zh-en", label: "中文 → 英文" },
          ]} />
        <div className="seg" aria-label="处理模式">
          {(
            [
              ["translate", "翻译"],
              ["polish", "润色"],
              ["explain", "解释"],
            ] as const
          ).map(([value, label]) => (
            <button
              type="button"
              key={value}
              aria-pressed={mode === value}
              onClick={() => {
                urgent.current = "now";
                setMode(value);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {cfg && (!profile || !keyReady) && (
        <div className="translate-hint" role="status">
          <span>
            {!profile
              ? "先添加一套翻译配置，填写接口地址、协议、模型和 API Key。"
              : keyState === "missing"
                ? "这套配置还没有 API Key，请在设置中填写。"
                : keyState}
          </span>
          <button type="button" className="btn" onClick={settings}>
            配置服务
          </button>
        </div>
      )}
      <div className="translate-columns">
        <div className="translate-column">
          <label className="qr-label" htmlFor="translate-source">
            原文
          </label>
          <textarea
            id="translate-source"
            className="translate-source"
            value={text}
            autoFocus
            spellCheck={false}
            placeholder="输入或粘贴文字，稍等片刻即可翻译"
            onChange={(e) => setText(e.target.value)}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={() => setComposing(false)}
          />
          <span className="note">
            {Array.from(text).length} 个字符
            {mode === "translate" && direction === "auto"
              ? " · 含中文译英文，其他译中文"
              : ""}
          </span>
        </div>
        <div className="translate-column">
          <span className="qr-label">
            {mode === "polish"
              ? "润色结果"
              : mode === "explain"
                ? "解释"
                : snapshot.word
                  ? "单词释义"
                  : "译文"}
          </span>
          <div
            className="translate-result"
            aria-label="处理结果"
            aria-busy={busy}
          >
            {word ? (
              <div className="translate-word">
                <div className="translate-word-head">
                  <strong>{text.trim()}</strong>
                  <span className="note mono">{word.phonetic}</span>
                </div>
                {word.senses.map((s, i) => (
                  <div className="translate-sense" key={i}>
                    <span className="chip">{s.partOfSpeech || "释义"}</span>
                    <p>{s.meaning}</p>
                    {s.explanation && (
                      <span className="note">{s.explanation}</span>
                    )}
                  </div>
                ))}
                {word.examples.length > 0 && (
                  <>
                    <span className="qr-label">例句</span>
                    {word.examples.map((s, i) => (
                      <div key={i}>
                        <p>{s.en}</p>
                        <p className="note">{s.zh}</p>
                      </div>
                    ))}
                  </>
                )}
                {word.synonyms.length > 0 && (
                  <p className="note">近义：{word.synonyms.join(" · ")}</p>
                )}
              </div>
            ) : snapshot.word && busy && !snapshot.text.trim() ? (
              <span className="note">正在整理音标、释义和例句…</span>
            ) : snapshot.text ? (
              <>
                {snapshot.word && snapshot.phase === "completed" && (
                  <p className="note warn-text">
                    释义格式未识别，已保留原始文本，可重试。
                  </p>
                )}
                <div className="translate-plain">
                  {snapshot.text}
                  {snapshot.phase === "streaming" && (
                    <span className="translate-cursor" aria-hidden="true" />
                  )}
                </div>
              </>
            ) : (
              <span className="note">
                {busy ? "正在等待服务返回正文…" : "处理结果会出现在这里"}
              </span>
            )}
          </div>
          <div className="translate-result-foot">
            <span className="note">
              {profile?.model ?? "尚未配置"} · {timing(snapshot)}
            </span>
            {busy ? (
              <button
                type="button"
                className="btn ghost sm"
                onClick={() => controller.current?.stop()}
              >
                停止
              </button>
            ) : (
              <button
                type="button"
                className="btn ghost sm"
                disabled={!profile || !keyReady || !text.trim()}
                onClick={run}
              >
                重新翻译
              </button>
            )}
            <button
              type="button"
              className="btn sm"
              disabled={!copyText || (snapshot.word && busy && !word)}
              onClick={() => void copy()}
            >
              <CopyIcon />
              {word ? "复制释义" : "复制结果"}
            </button>
          </div>
        </div>
      </div>
      {(snapshot.error || notice) && (
        <p
          className={`note ${snapshot.error ? "bad-text" : ""}`}
          role={snapshot.error ? "alert" : "status"}
        >
          {snapshot.error || notice}
          {snapshot.error && "；可重试或手动切换另一套配置。"}
        </p>
      )}
    </div>
  );
}
const seconds = (ms: number) => ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
/** 「首字 0.8 s · 共 2.1 s」 tells a slow service apart from a slow app. */
function timing(s: TranslationSnapshot) {
  if (s.cached) return "缓存结果";
  if (s.phase === "completed" && s.totalMs !== undefined)
    return s.firstMs !== undefined ? `首字 ${seconds(s.firstMs)} · 共 ${seconds(s.totalMs)}` : `共 ${seconds(s.totalMs)}`;
  if (s.phase === "streaming" && s.firstMs !== undefined) return `首字 ${seconds(s.firstMs)} · 正在输出…`;
  return phaseText[s.phase];
}
function hasSelection() {
  const active = document.activeElement;
  return Boolean(
    window.getSelection()?.toString() ||
    ((active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement) &&
      active.selectionStart !== active.selectionEnd),
  );
}
