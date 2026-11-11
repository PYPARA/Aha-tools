import { describe, expect, test } from "bun:test";
import { filesFromInput } from "../src/plugin-input";

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
