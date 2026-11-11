import type {
  TranslateDirection,
  TranslateMode,
  TranslateChunk,
  TranslateDone,
  TranslateError,
} from "@ahatools/sdk";
export interface WordResult {
  phonetic: string;
  senses: { partOfSpeech: string; meaning: string; explanation: string }[];
  examples: { en: string; zh: string }[];
  synonyms: string[];
}
export function isWord(
  text: string,
  mode: TranslateMode,
  direction: TranslateDirection,
) {
  return (
    mode === "translate" &&
    direction !== "zh-en" &&
    /^[A-Za-z]+(?:['’\-][A-Za-z]+)*$/.test(text.trim())
  );
}
const splitBar = (line: string) => line.split(/[|｜]/).map((part) => part.trim());
/**
 * The dictionary entry, from the line format the prompt asks for (readable while it
 * streams in) or the older JSON format. Null until at least one sense is complete.
 */
export function parseWord(text: string): WordResult | null {
  const trimmed = text.trim();
  return /^(```|\{)/.test(trimmed) ? parseWordJson(trimmed) : parseWordLines(trimmed);
}
function parseWordLines(text: string): WordResult | null {
  const result: WordResult = { phonetic: "", senses: [], examples: [], synonyms: [] };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (!result.phonetic && !result.senses.length && /^([/[]).+[/\]]$/.test(line)) result.phonetic = line;
    else if (line.startsWith(">")) {
      const [en, zh = ""] = splitBar(line.slice(1));
      if (en) result.examples.push({ en, zh });
    } else if (line.startsWith("=")) result.synonyms = line.slice(1).split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
    else {
      const [partOfSpeech, meaning, ...rest] = splitBar(line);
      if (meaning) result.senses.push({ partOfSpeech, meaning, explanation: rest.join("｜") });
    }
  }
  return result.senses.length ? result : null;
}
function parseWordJson(text: string): WordResult | null {
  try {
    const raw = text
      .trim()
      .replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, "$1");
    const v = JSON.parse(raw);
    if (!v || !Array.isArray(v.senses)) return null;
    const senses = v.senses.filter(
      (x: unknown): x is WordResult["senses"][number] =>
        Boolean(
          x &&
          typeof x === "object" &&
          "meaning" in x &&
          typeof x.meaning === "string" &&
          x.meaning.trim(),
        ),
    );
    if (!senses.length) return null;
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    return {
      phonetic: str(v.phonetic),
      senses: senses.map((x: WordResult["senses"][number]) => ({
        meaning: x.meaning,
        partOfSpeech: str(x.partOfSpeech),
        explanation: str(x.explanation),
      })),
      examples: Array.isArray(v.examples)
        ? v.examples.filter(
            (x: unknown) =>
              x &&
              typeof x === "object" &&
              "en" in x &&
              typeof x.en === "string" &&
              "zh" in x &&
              typeof x.zh === "string",
          )
        : [],
      synonyms: Array.isArray(v.synonyms)
        ? v.synonyms.filter((x: unknown) => typeof x === "string" && x.trim())
        : [],
    };
  } catch {
    return null;
  }
}
export function wordText(word: string, result: WordResult) {
  return [
    word + (result.phonetic ? ` ${result.phonetic}` : ""),
    ...result.senses.map((s) =>
      [s.partOfSpeech, s.meaning, s.explanation].filter(Boolean).join(" · "),
    ),
    ...result.examples.map((s) => `${s.en}\n${s.zh}`),
    result.synonyms.length ? `近义：${result.synonyms.join(" · ")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
/** The typed 附加请求参数, or an error to show. Empty means none. */
export function parseExtra(text: string): { value?: Record<string, unknown>; error?: string } {
  if (!text.trim()) return {};
  try {
    const value: unknown = JSON.parse(text);
    if (value && typeof value === "object" && !Array.isArray(value)) return { value: value as Record<string, unknown> };
  } catch { /* reported below */ }
  return { error: "附加请求参数需要是 JSON 对象，例如 {\"thinking\": {\"type\": \"disabled\"}}" };
}
export interface TranslationRequest {
  profileId: string;
  text: string;
  mode: TranslateMode;
  direction: TranslateDirection;
}
export interface TranslationSnapshot {
  phase: "idle" | "waiting" | "streaming" | "completed" | "stopped" | "error";
  text: string;
  error: string;
  word: boolean;
  /** Shown from the in-memory cache without a request. */
  cached?: boolean;
  /** Milliseconds from sending to the first visible text, and to completion. */
  firstMs?: number;
  totalMs?: number;
}
export interface UpdateOptions {
  /** Send now instead of after the typing pause. */
  immediate?: boolean;
  /** Send again even when the same request is cached or already showing. */
  force?: boolean;
  /** What else decides the output, such as the model; part of the cache key. */
  variant?: string;
}
/** Short text is usually a word or phrase: answer sooner. */
export function debounceFor(text: string) {
  return Array.from(text.trim()).length <= 40 ? 150 : 250;
}
const CACHE_LIMIT = 50;
/** Finished results for this run of the app, newest last. Never written to disk. */
const cache = new Map<string, { text: string; word: boolean }>();
export function clearTranslationCache() {
  cache.clear();
}
interface Transport {
  start: (args: TranslationRequest & { id: string }) => Promise<void>;
  stop: (id: string) => Promise<void>;
  subscribe: (handlers: {
    chunk: (e: TranslateChunk) => void;
    done: (e: TranslateDone) => void;
    error: (e: TranslateError) => void;
  }) => Promise<() => void>;
}
/** Owns debounce, subscription readiness and latest-request identity, independently of React. */
export class TranslationController {
  snapshot: TranslationSnapshot = {
    phase: "idle",
    text: "",
    error: "",
    word: false,
  };
  private current = "";
  private signature = "";
  private startedAt = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private unlisten?: () => void;
  /** `delay` fixes the typing pause (tests); otherwise it follows the text length. */
  constructor(
    private transport: Transport,
    private changed: (s: TranslationSnapshot) => void,
    private delay?: number,
  ) {}
  async connect() {
    const unlisten = await this.transport.subscribe({
      chunk: (e) => {
        if (this.accept(e.id)) {
          const text = this.snapshot.text + e.delta;
          this.publish({
            text,
            phase: "streaming",
            firstMs: this.snapshot.firstMs ?? (text.trim() ? Date.now() - this.startedAt : undefined),
          });
        }
      },
      done: (e) => {
        if (this.accept(e.id)) {
          this.current = "";
          const completed = e.reason !== "stopped";
          this.publish({
            phase: completed ? "completed" : "stopped",
            word: e.word,
            totalMs: Date.now() - this.startedAt,
          });
          if (completed && this.snapshot.text.trim()) {
            cache.delete(this.signature);
            cache.set(this.signature, { text: this.snapshot.text, word: e.word });
            while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
          }
        }
      },
      error: (e) => {
        if (this.accept(e.id)) {
          this.current = "";
          this.publish({ phase: "error", error: e.message });
        }
      },
    });
    if (this.disposed) unlisten();
    else this.unlisten = unlisten;
    return !this.disposed;
  }
  private accept(id: string) {
    return !this.disposed && id === this.current;
  }
  private publish(next: Partial<TranslationSnapshot>) {
    if (this.disposed) return;
    this.snapshot = { ...this.snapshot, ...next };
    this.changed(this.snapshot);
  }
  private cancel() {
    clearTimeout(this.timer);
    const old = this.current;
    this.current = "";
    if (old) void this.transport.stop(old).catch(() => {});
  }
  /** `true` is the old 「立即重译」: send now, skipping the cache. */
  update(request: TranslationRequest | null, options: boolean | UpdateOptions = {}) {
    if (this.disposed) return;
    const { immediate = false, force = false, variant = "" } =
      typeof options === "boolean" ? { immediate: options, force: options } : options;
    const signature = request ? `${JSON.stringify(request)}\u0000${variant}` : "";
    if (!force && signature === this.signature) return;
    this.signature = signature;
    this.cancel();
    const cleared = { error: "", cached: false, firstMs: undefined, totalMs: undefined };
    if (!request || !request.text.trim()) {
      this.publish({ ...cleared, phase: "idle", text: "", word: false });
      return;
    }
    const hit = force ? undefined : cache.get(signature);
    if (hit) {
      cache.delete(signature);
      cache.set(signature, hit);
      this.publish({ ...cleared, phase: "completed", text: hit.text, word: hit.word, cached: true });
      return;
    }
    this.publish({
      ...cleared,
      phase: "waiting",
      text: "",
      word: isWord(request.text, request.mode, request.direction),
    });
    const start = () => {
      if (this.disposed) return;
      const id = crypto.randomUUID();
      this.current = id;
      this.startedAt = Date.now();
      this.publish({ phase: "streaming" });
      void this.transport.start({ ...request, id }).then(
        () => {
          // Stop may have happened before native registration (e.g. while pinning the panel).
          if (!this.accept(id)) void this.transport.stop(id).catch(() => {});
        },
        (e) => {
          if (this.accept(id)) {
            this.current = "";
            this.publish({ phase: "error", error: String(e) });
          }
        },
      );
    };
    if (immediate || force) start();
    else this.timer = setTimeout(start, this.delay ?? debounceFor(request.text));
  }
  stop() {
    this.cancel();
    this.publish({ phase: "stopped" });
  }
  dispose() {
    this.cancel();
    this.disposed = true;
    this.unlisten?.();
  }
}
