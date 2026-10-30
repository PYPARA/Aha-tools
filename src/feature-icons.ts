const files = import.meta.glob<string>("./assets/icons/*.svg", { eager: true, query: "?url", import: "default" });
export const featureIcons: Record<string, string> = Object.fromEntries(Object.entries(files).map(([key, url]) => [key.split("/").pop()!.replace(".svg", ""), url]));
export function featureIconKey(plugin: string, feature?: string) {
  if (feature && featureIcons[`${plugin}-${feature}`]) return `${plugin}-${feature}`;
  return featureIcons[plugin] ? plugin : "external";
}
