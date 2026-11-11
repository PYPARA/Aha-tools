import { useEffect, useRef, useState } from "react";
import {
  Combobox,
  Select,
  translateSelect,
  translateDeleteProfile,
  translateHasKey,
  translateListModels,
  translateSaveProfile,
  translateTestConnection,
  type PluginSettingsProps,
  type TranslateDraft,
  type TranslateModel,
  type TranslateProfile,
  type TranslateProtocol,
} from "@ahatools/sdk";
import { parseExtra } from "./core";
const protocols: [TranslateProtocol, string][] = [
  ["openai-chat", "OpenAI Chat Completions"],
  ["openai-responses", "OpenAI Responses"],
  ["anthropic-messages", "Anthropic Messages"],
];
type Editor = Omit<TranslateProfile, "protocol" | "extraBody"> & {
  protocol: TranslateProtocol | "";
  key: string;
  /** 附加请求参数 as typed: a JSON object, or empty. */
  extra: string;
};
export default function Settings({ cfg }: PluginSettingsProps) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [hasKey, setHasKey] = useState(false);
  const [models, setModels] = useState<TranslateModel[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState({ text: "", error: false });
  const revision = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      revision.current++;
    };
  }, []);
  const original = cfg.translate.profiles.find((p) => p.id === editor?.id);
  useEffect(() => {
    let stale = false;
    setHasKey(false);
    if (original)
      translateHasKey(original.id).then(
        (v) => {
          if (!stale) setHasKey(v);
        },
        (e) => {
          if (!stale) setFeedback({ text: String(e), error: true });
        },
      );
    return () => {
      stale = true;
    };
  }, [original?.id]);
  const begin = (p?: TranslateProfile) => {
    revision.current++;
    setModels([]);
    setFeedback({ text: "", error: false });
    setBusy(null);
    setEditor(
      p
        ? { id: p.id, name: p.name, protocol: p.protocol, baseUrl: p.baseUrl, model: p.model, key: "", extra: p.extraBody ? JSON.stringify(p.extraBody, null, 2) : "" }
        : {
            id: crypto.randomUUID(),
            name: "",
            protocol: "",
            baseUrl: "",
            model: "",
            key: "",
            extra: "",
          },
    );
  };
  const change = (field: keyof Editor, value: string) => {
    revision.current++;
    setBusy(null);
    setFeedback({ text: "", error: false });
    if (["baseUrl", "protocol", "key"].includes(field)) setModels([]);
    setEditor((d) => d && { ...d, [field]: value });
  };
  const connectionChanged =
    original &&
    editor &&
    (original.protocol !== editor.protocol ||
      original.baseUrl.replace(/\/+$/, "") !==
        editor.baseUrl.trim().replace(/\/+$/, ""));
  const perform = async (action: "save" | "models" | "test") => {
    if (!editor || busy) return;
    const d = editor;
    if (!d.protocol || !d.baseUrl.trim()) {
      setFeedback({ text: "请选择协议并填写完整的 Base URL", error: true });
      return;
    }
    if ((!original || connectionChanged || !hasKey) && !d.key.trim()) {
      setFeedback({ text: "请填写当前接口的 API Key", error: true });
      return;
    }
    if (
      (action === "save" && !d.name.trim()) ||
      (action !== "models" && !d.model.trim())
    ) {
      setFeedback({ text: "请填写配置名称和模型 ID", error: true });
      return;
    }
    const extra = parseExtra(d.extra);
    if (extra.error) {
      setFeedback({ text: extra.error, error: true });
      return;
    }
    const ticket = ++revision.current;
    setBusy(action);
    setFeedback({ text: "", error: false });
    const draft: TranslateDraft = {
      profileId: d.id,
      protocol: d.protocol,
      baseUrl: d.baseUrl.trim(),
      ...(d.key.trim() ? { key: d.key.trim() } : {}),
      ...(extra.value ? { extraBody: extra.value } : {}),
    };
    try {
      if (action === "models") {
        const result = await translateListModels(draft);
        if (alive.current && ticket === revision.current) {
          setModels(result);
          setFeedback({
            text: result.length
              ? `已获取 ${result.length} 个模型，也可手动填写`
              : "没有可选模型，请手动填写模型 ID",
            error: false,
          });
        }
      } else if (action === "test") {
        const result = await translateTestConnection(draft, d.model.trim());
        if (alive.current && ticket === revision.current)
          setFeedback({
            text: `连接正常 · 首字 ${result.firstTokenMs} ms`,
            error: false,
          });
      } else {
        const profile: TranslateProfile = {
          id: d.id,
          name: d.name.trim(),
          protocol: d.protocol,
          baseUrl: d.baseUrl.trim(),
          model: d.model.trim(),
          ...(extra.value ? { extraBody: extra.value } : {}),
        };
        await translateSaveProfile(profile, d.key.trim() || undefined);
        if (alive.current && ticket === revision.current) {
          setEditor(null);
          setModels([]);
          setFeedback({
            text: "已保存配置，密钥保存在本机",
            error: false,
          });
        }
      }
    } catch (e) {
      if (alive.current && ticket === revision.current)
        setFeedback({
          text: `${String(e)}${action === "models" ? "；仍可手动填写模型 ID" : ""}`,
          error: true,
        });
    } finally {
      if (alive.current && ticket === revision.current) setBusy(null);
    }
  };
  const remove = async (id: string) => {
    setBusy(id);
    setFeedback({ text: "", error: false });
    try {
      await translateDeleteProfile(id);
      if (alive.current) {
        if (editor?.id === id) setEditor(null);
        setFeedback({ text: "已删除配置及对应密钥", error: false });
      }
    } catch (e) {
      if (alive.current) setFeedback({ text: String(e), error: true });
    } finally {
      if (alive.current) setBusy(null);
    }
  };
  const activate = async (id: string) => {
    setBusy(id);
    try {
      await translateSelect({ profileId: id });
    } catch (e) {
      if (alive.current) setFeedback({ text: String(e), error: true });
    } finally {
      if (alive.current) setBusy(null);
    }
  };
  return (
    <div className="translate-settings">
      <div className="translate-settings-head">
        <span className="row-text">
          <span className="row-title">服务配置</span>
          <span className="note">在翻译页手动切换，使用当前配置处理原文。</span>
        </span>
        <button
          type="button"
          className="btn"
          disabled={Boolean(busy)}
          onClick={() => begin()}
        >
          新增配置
        </button>
      </div>
      {!cfg.translate.profiles.length && !editor && (
        <p className="translate-hint">
          还没有配置。添加你使用的接口地址、协议、模型和 API Key。
        </p>
      )}
      <ul className="translate-profiles" aria-label="翻译服务配置">
        {cfg.translate.profiles.map((p) => (
          <li key={p.id}>
            <span className="row-text">
              <span className="row-title">
                {p.name}
                {cfg.translate.activeProfileId === p.id && (
                  <span className="chip sm">当前</span>
                )}
              </span>
              <span className="note">
                {protocols.find(([id]) => id === p.protocol)?.[1]} · {p.model}
                {p.extraBody && " · 附加参数"}
              </span>
              <span className="note translate-address">{p.baseUrl}</span>
            </span>
            <div className="translate-profile-actions">
              {cfg.translate.activeProfileId !== p.id && (
                <button
                  type="button"
                  className="btn ghost sm"
                  disabled={Boolean(busy)}
                  onClick={() => void activate(p.id)}
                >
                  使用
                </button>
              )}
              <button
                type="button"
                className="btn sm"
                disabled={Boolean(busy)}
                onClick={() => begin(p)}
              >
                编辑
              </button>
              <button
                type="button"
                className="btn ghost sm danger"
                disabled={Boolean(busy)}
                onClick={() => void remove(p.id)}
              >
                删除
              </button>
            </div>
          </li>
        ))}
      </ul>
      {editor && (
        <form
          className="translate-editor"
          onSubmit={(e) => {
            e.preventDefault();
            void perform("save");
          }}
        >
          <h2>{original ? "编辑配置" : "新增配置"}</h2>
          <fieldset disabled={busy === "save"}>
            <label htmlFor="translate-name">名称</label>
            <input
              id="translate-name"
              className="input"
              autoComplete="username"
              autoFocus
              value={editor.name}
              placeholder="如工作配置、备用配置"
              onChange={(e) => change("name", e.target.value)}
            />
            <label htmlFor="translate-protocol">协议</label>
            <Select id="translate-protocol" label="协议" placeholder="请选择协议" value={editor.protocol} disabled={busy === "save"}
              onChange={(protocol) => change("protocol", protocol)} options={protocols.map(([value, label]) => ({ value, label }))} />
            <label htmlFor="translate-url">Base URL</label>
            <input
              id="translate-url"
              className="input mono"
              value={editor.baseUrl}
              placeholder="https://gateway.example/v1"
              onChange={(e) => change("baseUrl", e.target.value)}
            />
            <span className="note translate-field-help">
              填写包含版本前缀的 API 根路径，不自动添加 /v1。
            </span>
            <label htmlFor="translate-key">API Key</label>
            <input
              id="translate-key"
              className="input mono"
              type="password"
              autoComplete="new-password"
              value={editor.key}
              placeholder={
                hasKey && !connectionChanged
                  ? "••••••••（已设置，填写以更换）"
                  : "填写 API Key"
              }
              onChange={(e) => change("key", e.target.value)}
            />
            <span className="note translate-field-help">
              只保存在本机的 AhaTools 数据目录。更换协议或地址后需重新填写。
            </span>
            <label htmlFor="translate-model">模型</label>
            <div className="translate-model-input">
              <Combobox id="translate-model" label="模型" className="mono" value={editor.model} placeholder="输入或搜索模型 ID"
                disabled={busy === "save"} onChange={(model) => change("model", model)}
                options={models.filter((model, i) => models.findIndex((m) => m.id === model.id) === i).map((model) => ({ value: model.id, label: model.id, description: model.name !== model.id ? model.name : undefined }))} />
              <button
                type="button"
                className="btn"
                disabled={Boolean(busy)}
                onClick={() => void perform("models")}
              >
                {busy === "models" ? "正在获取…" : "获取模型"}
              </button>
            </div>
            <label htmlFor="translate-extra">附加参数</label>
            <textarea
              id="translate-extra"
              className="input mono translate-extra"
              rows={3}
              spellCheck={false}
              value={editor.extra}
              placeholder={'{"thinking": {"type": "disabled"}}'}
              onChange={(e) => change("extra", e.target.value)}
            />
            <span className="note translate-field-help">
              可选。JSON 对象，原样合并进每次请求，可用来关闭推理模型的思考以加快出字。字段名以所用服务的文档为准；model、messages、stream 等由 AhaTools 设置。
            </span>
          </fieldset>
          <div className="translate-editor-actions">
            <button
              type="button"
              className="btn"
              disabled={Boolean(busy)}
              onClick={() => void perform("test")}
            >
              {busy === "test" ? "正在测试…" : "测试连接"}
            </button>
            <span className="spacer" />
            <button
              type="button"
              className="btn ghost"
              disabled={busy === "save"}
              onClick={() => {
                revision.current++;
                setEditor(null);
                setModels([]);
                setBusy(null);
                setFeedback({ text: "", error: false });
              }}
            >
              取消
            </button>
            <button
              type="submit"
              className="btn primary"
              disabled={Boolean(busy)}
            >
              {busy === "save" ? "正在保存…" : "保存配置"}
            </button>
          </div>
        </form>
      )}
      {feedback.text && (
        <p
          className={`note ${feedback.error ? "bad-text" : "ok-text"}`}
          role={feedback.error ? "alert" : "status"}
        >
          {feedback.text}
        </p>
      )}
    </div>
  );
}
