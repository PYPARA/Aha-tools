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
