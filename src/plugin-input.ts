/**
 * The super panel hands a Finder selection to a feature as `{"paths":[…]}` text input.
 * Pages and actions read files from `content`, so the host converts it once on arrival.
 */
export function filesFromInput(input?: string | null): string[] | null {
  if (!input || !input.startsWith("{")) return null;
  try {
    const paths = (JSON.parse(input) as { paths?: unknown } | null)?.paths;
    if (Array.isArray(paths) && paths.length > 0 && paths.every((p) => typeof p === "string" && p.length > 0)) return paths;
  } catch { /* Ordinary text that happens to start with a brace. */ }
  return null;
}

/** Short single-line text goes into the search box; anything longer is an attachment. */
export function textPlacement(text: string): "query" | "attachment" {
  const trimmed = text.trim();
  return !trimmed.includes("\n") && Array.from(trimmed).length <= 100 ? "query" : "attachment";
}

/** First line, cut to `max` characters, for chips and titles. */
export function preview(text: string, max = 24) {
  const lines = text.trim().split("\n");
  const first = Array.from(lines[0] ?? "");
  return first.slice(0, max).join("") + (first.length > max || lines.length > 1 ? "…" : "");
}
