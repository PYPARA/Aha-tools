// Keep the asset registry separate from views so the SDK can render icons without
// importing plugin pages back into its shared UI module.
const assets = import.meta.glob<string>("./assets/icons/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
});

export const featureIcons: Record<string, string> = Object.fromEntries(
  Object.entries(assets).map(([path, url]) => [path.slice("./assets/icons/".length, -".svg".length), url]),
);

/** Prefer a feature-specific icon, then the plugin, then the external fallback. */
export function featureIconKey(plugin: string, feature?: string): string {
  const key = `${plugin}-${feature}`;
  if (feature && Object.prototype.hasOwnProperty.call(featureIcons, key)) return key;
  return Object.prototype.hasOwnProperty.call(featureIcons, plugin) ? plugin : "external";
}
