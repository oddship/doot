export function compactSource(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function compactCss(value: string) {
  return value.replace(/\s+/g, " ").replace(/\s*([{}:;,>])\s*/g, "$1");
}
