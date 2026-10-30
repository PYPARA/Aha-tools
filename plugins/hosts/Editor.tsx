import { useImperativeHandle, useRef, useState, type Ref } from "react";

export interface EditorHandle { selectLine: (line: number) => void }
const LINE_HEIGHT = 23;

export default function Editor({ value, onChange, errorLines, disabled, ref }: {
  value: string;
  onChange: (text: string) => void;
  errorLines: Set<number>;
  disabled: boolean;
  ref: Ref<EditorHandle>;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const lines = value.split("\n");
  useImperativeHandle(ref, () => ({
    selectLine(line) {
      const element = textarea.current;
      if (!element) return;
      const start = lines.slice(0, Math.max(0, line - 1)).reduce((sum, text) => sum + text.length + 1, 0);
      element.focus();
      element.setSelectionRange(start, start + (lines[line - 1]?.length ?? 0));
      element.scrollTop = Math.max(0, (line - 3) * LINE_HEIGHT);
      setScrollTop(element.scrollTop);
    },
  }), [lines]);
  return (
    <div className="hosts-editor">
      <div className="hosts-line-overlay" aria-hidden="true">
        <div style={{ transform: `translateY(${-scrollTop}px)` }}>
          {lines.map((_, index) => <div key={index} className={errorLines.has(index + 1) ? "invalid" : ""}>
            <span>{index + 1}</span>
          </div>)}
        </div>
      </div>
      <textarea ref={textarea} value={value} disabled={disabled} aria-label="方案内容" aria-invalid={errorLines.size > 0}
        aria-describedby="hosts-format" spellCheck={false} autoCorrect="off" autoCapitalize="off" wrap="off"
        placeholder={"# 输入 hosts 条目\n127.0.0.1  api.local.test"}
        onChange={(event) => onChange(event.target.value)} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)} />
    </div>
  );
}
