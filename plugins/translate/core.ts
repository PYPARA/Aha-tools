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
export function parseWord(text: string): WordResult | null {
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
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private unlisten?: () => void;
  constructor(
    private transport: Transport,
    private changed: (s: TranslationSnapshot) => void,
    private delay = 400,
  ) {}
  async connect() {
    const unlisten = await this.transport.subscribe({
      chunk: (e) => {
        if (this.accept(e.id))
          this.publish({
            text: this.snapshot.text + e.delta,
            phase: "streaming",
          });
      },
      done: (e) => {
        if (this.accept(e.id)) {
          this.current = "";
          this.publish({
            phase: e.reason === "stopped" ? "stopped" : "completed",
            word: e.word,
          });
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
  update(request: TranslationRequest | null, immediate = false) {
    if (this.disposed) return;
    const signature = request ? JSON.stringify(request) : "";
    if (!immediate && signature === this.signature) return;
    this.signature = signature;
    this.cancel();
    if (!request || !request.text.trim()) {
      this.publish({ phase: "idle", text: "", error: "", word: false });
      return;
    }
    this.publish({
      phase: "waiting",
      text: "",
      error: "",
      word: isWord(request.text, request.mode, request.direction),
    });
    const start = () => {
      if (this.disposed) return;
      const id = crypto.randomUUID();
      this.current = id;
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
    if (immediate) start();
    else this.timer = setTimeout(start, this.delay);
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
