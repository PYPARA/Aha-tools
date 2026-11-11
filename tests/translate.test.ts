import { describe, expect, test } from "bun:test";
import {
  TranslationController,
  clearTranslationCache,
  debounceFor,
  parseExtra,
  isWord,
  parseWord,
  wordText,
  type TranslationRequest,
  type TranslationSnapshot,
} from "../plugins/translate/core";
import type { TranslateChunk, TranslateDone, TranslateError } from "../src/sdk";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const request: TranslationRequest = {
  profileId: "first",
  text: "hello world",
  mode: "translate",
  direction: "auto",
};
/** `null`: the controller picks the pause from the text length. */
function setup(delay: number | null = 10) {
  clearTranslationCache();
  const starts: (TranslationRequest & { id: string })[] = [];
  const stops: string[] = [];
  let handlers!: {
    chunk: (e: TranslateChunk) => void;
    done: (e: TranslateDone) => void;
    error: (e: TranslateError) => void;
  };
  let snapshot!: TranslationSnapshot;
  let unlistened = 0;
  const c = new TranslationController(
    {
      start: async (r) => {
        starts.push(r);
      },
      stop: async (id) => {
        stops.push(id);
      },
      subscribe: async (h) => {
        handlers = h;
        return () => {
          unlistened++;
        };
      },
    },
    (s) => {
      snapshot = s;
    },
    delay ?? undefined,
  );
  return {
    c,
    starts,
    stops,
    get handlers() {
      return handlers;
    },
    get snapshot() {
      return snapshot;
    },
    get unlistened() {
      return unlistened;
    },
  };
}
describe("翻译请求生命周期", () => {
  test("输入防抖只提交最新文字，立即重译跳过等待", async () => {
    const s = setup();
    await s.c.connect();
    s.c.update(request);
    s.c.update({ ...request, text: "latest" });
    expect(s.starts.length).toBe(0);
    await sleep(25);
    expect(s.starts.map((r) => r.text)).toEqual(["latest"]);
    s.c.update(request, true);
    expect(s.starts.length).toBe(2);
    expect(s.stops).toContain(s.starts[0].id);
    s.c.dispose();
  });
  test("输入法组词时取消，结束后发送，过期分片不能混入", async () => {
    const s = setup();
    await s.c.connect();
    s.c.update(request, true);
    const old = s.starts[0].id;
    s.c.update(null);
    await sleep(25);
    expect(s.starts.length).toBe(1);
    s.c.update({ ...request, text: "中文原文" });
    await sleep(25);
    const id = s.starts[1].id;
    s.handlers.chunk({ id: old, delta: "old" });
    s.handlers.done({ id: old, reason: "completed", word: false });
    s.handlers.chunk({ id, delta: "new" });
    expect(s.snapshot.text).toBe("new");
    s.c.dispose();
  });
  test("停止保留部分结果且相同输入不自动重发", async () => {
    const s = setup();
    await s.c.connect();
    s.c.update(request, true);
    const id = s.starts[0].id;
    s.handlers.chunk({ id, delta: "partial" });
    s.c.stop();
    s.c.update(request);
    await sleep(25);
    s.handlers.chunk({ id, delta: "late" });
    expect(s.snapshot.text).toBe("partial");
    expect(s.snapshot.phase).toBe("stopped");
    expect(s.starts.length).toBe(1);
    s.c.update(request, true);
    expect(s.starts.length).toBe(2);
    s.c.dispose();
  });
  test("切换配置立即取消旧请求，完成后忽略迟到错误", async () => {
    const s = setup();
    await s.c.connect();
    s.c.update(request, true);
    const old = s.starts[0].id;
    s.c.update({ ...request, profileId: "backup" }, true);
    const id = s.starts[1].id;
    expect(s.stops).toContain(old);
    s.handlers.chunk({ id, delta: "backup output" });
    s.handlers.done({ id, reason: "completed", word: false });
    s.handlers.error({ id: old, message: "obsolete" });
    s.handlers.error({ id, message: "after done" });
    expect(s.snapshot.phase).toBe("completed");
    expect(s.snapshot.text).toBe("backup output");
    s.c.dispose();
  });
  test("StrictMode 提前卸载可清理异步注册的监听器", async () => {
    const s = setup();
    const connected = s.c.connect();
    s.c.dispose();
    expect(await connected).toBe(false);
    expect(s.unlistened).toBe(1);
  });
});
describe("单词释义", () => {
  test("仅英文单词且目标中文时进入词典布局", () => {
    for (const word of ["serendipity", "don't", "well-known", "O’Reilly"])
      expect(isWord(word, "translate", "auto")).toBe(true);
    for (const word of ["two words", "hello!", "中文", "foo_bar"])
      expect(isWord(word, "translate", "auto")).toBe(false);
    expect(isWord("word", "polish", "auto")).toBe(false);
    expect(isWord("word", "translate", "zh-en")).toBe(false);
  });
  test("验证 JSON，复制可读释义，非法结构回退", () => {
    const word = parseWord(
      '```json\n{"phonetic":"/word/","senses":[{"meaning":"释义","partOfSpeech":"名词"}],"examples":[{"en":"English","zh":"中文"}],"synonyms":["near",2]}\n```',
    )!;
    expect(wordText("word", word)).toBe(
      "word /word/\n\n名词 · 释义\n\nEnglish\n中文\n\n近义：near",
    );
    for (const invalid of [
      "plain text",
      "{}",
      '{"senses":[]}',
      '{"senses":[{"meaning":4}]}',
    ])
      expect(parseWord(invalid)).toBeNull();
  });
});
describe("翻译提速", () => {
  const finish = (s: ReturnType<typeof setup>, text: string) => {
    const id = s.starts[s.starts.length - 1].id;
    s.handlers.chunk({ id, delta: text });
    s.handlers.done({ id, reason: "completed", word: false });
  };
  test("带入的文字立即发送，打字停顿随长度缩短", async () => {
    const s = setup(null);
    await s.c.connect();
    s.c.update(request, { immediate: true });
    expect(s.starts.length).toBe(1);
    expect(debounceFor("hello")).toBe(150);
    expect(debounceFor("x".repeat(41))).toBe(250);
    s.c.update({ ...request, text: "short" });
    await sleep(100);
    expect(s.starts.length).toBe(1);
    await sleep(80);
    expect(s.starts.length).toBe(2);
    s.c.dispose();
  });
  test("相同请求直接用缓存，重新翻译跳过缓存，换模型不复用", async () => {
    const s = setup();
    await s.c.connect();
    s.c.update(request, { immediate: true, variant: "model-a" });
    finish(s, "你好世界");
    expect(s.snapshot.phase).toBe("completed");
    expect(s.snapshot.totalMs).toBeGreaterThanOrEqual(0);
    expect(s.snapshot.firstMs).toBeGreaterThanOrEqual(0);
    s.c.update({ ...request, text: "other" }, { immediate: true, variant: "model-a" });
    s.c.update(request, { immediate: true, variant: "model-a" });
    expect(s.starts.length).toBe(2);
    expect(s.snapshot).toMatchObject({ phase: "completed", text: "你好世界", cached: true });
    s.c.update(request, { immediate: true, variant: "model-b" });
    expect(s.starts.length).toBe(3);
    expect(s.snapshot.cached).toBe(false);
    s.c.update(request, { immediate: true, force: true, variant: "model-a" });
    expect(s.starts.length).toBe(4);
    s.c.dispose();
  });
  test("停止或出错的结果不进缓存", async () => {
    const s = setup();
    await s.c.connect();
    s.c.update(request, true);
    const id = s.starts[0].id;
    s.handlers.chunk({ id, delta: "部分" });
    s.c.stop();
    s.c.update({ ...request, text: "other" }, true);
    s.handlers.error({ id: s.starts[1].id, message: "HTTP 503" });
    s.c.update(request, { immediate: true });
    s.c.update({ ...request, text: "other" }, { immediate: true });
    expect(s.starts.length).toBe(4);
    s.c.dispose();
  });
  test("单词释义按行解析，流式中途也能显示已完成的义项", () => {
    const full = "/ˈwɜːd/\n名词|单词；字|语言中能独立使用的最小单位\n动词｜措辞｜用特定的词表达\n> Choose your words.|斟酌用词。\n= term, expression，vocable";
    const word = parseWord(full)!;
    expect(word.phonetic).toBe("/ˈwɜːd/");
    expect(word.senses).toEqual([
      { partOfSpeech: "名词", meaning: "单词；字", explanation: "语言中能独立使用的最小单位" },
      { partOfSpeech: "动词", meaning: "措辞", explanation: "用特定的词表达" },
    ]);
    expect(word.examples).toEqual([{ en: "Choose your words.", zh: "斟酌用词。" }]);
    expect(word.synonyms).toEqual(["term", "expression", "vocable"]);
    expect(parseWord("/ˈwɜːd/\n名")).toBeNull();
    expect(parseWord("/ˈwɜːd/\n名词|单")!.senses[0].meaning).toBe("单");
    expect(wordText("word", word)).toContain("名词 · 单词；字 · 语言中能独立使用的最小单位");
  });
  test("附加参数必须是 JSON 对象", () => {
    expect(parseExtra("")).toEqual({});
    expect(parseExtra(' {"thinking":{"type":"disabled"}} ').value).toEqual({ thinking: { type: "disabled" } });
    for (const bad of ["[]", "1", "null", "{bad"]) expect(parseExtra(bad).error).toContain("JSON 对象");
  });
});
