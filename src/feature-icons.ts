const files = import.meta.glob<string>("./assets/icons/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
});
export const featureIcons = Object.fromEntries(
  Object.entries(files).map(([path, url]) => [
    path
      .split("/")
      .pop()!
      .replace(/\.svg$/, ""),
    url,
  ]),
);
export function featureIconKey(plugin: string, feature?: string) {
  const specific = `${plugin}-${feature}`;
  return specific in featureIcons
    ? specific
    : plugin in featureIcons
      ? plugin
      : "external";
}
