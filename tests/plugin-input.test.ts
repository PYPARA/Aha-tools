import { describe, expect, test } from "bun:test";
import { filesFromInput, preview, textPlacement } from "../src/plugin-input";

describe("超级面板带入的文件", () => {
  test("解析访达路径，保留中文、空格和换行", () => {
    const paths = ["/Users/me/图片/a b.png", "/tmp/第一行\n第二行.txt", "/Users/me/文件夹/"];
    expect(filesFromInput(JSON.stringify({ paths }))).toEqual(paths);
  });

  test("普通文字和其他结构不当作文件", () => {
    for (const input of [undefined, null, "", "hello", "{不是 JSON", '{"paths":[]}', '{"paths":["/a",1]}', '{"paths":"/a"}', '["/a.png"]', "null"]) {
      expect(filesFromInput(input)).toBeNull();
    }
  });
});

describe("复制内容放在哪里", () => {
  test("短的单行文字进搜索框，长文或多行作为附件", () => {
    expect(textPlacement("  github.com \n")).toBe("query");
    expect(textPlacement("x".repeat(100))).toBe("query");
    expect(textPlacement("x".repeat(101))).toBe("attachment");
    expect(textPlacement("第一行\n第二行")).toBe("attachment");
    expect(textPlacement('{\n  "a": 1\n}')).toBe("attachment");
  });
  test("预览取第一行并截断", () => {
    expect(preview("hello")).toBe("hello");
    expect(preview("第一行\n第二行")).toBe("第一行…");
    expect(preview("一二三四五", 3)).toBe("一二三…");
  });
});
