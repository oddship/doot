import { readdir, readFile } from "node:fs/promises";

export function compactSource(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function compactCss(value: string) {
  return value.replace(/\s+/g, " ").replace(/\s*([{}:;,>])\s*/g, "$1");
}

async function readTree(directory: string) {
  const files = (await readdir(directory)).filter((file) => file.endsWith(".ts") || file.endsWith(".css")).sort();
  return (await Promise.all(files.map((file) => readFile(`${directory}/${file}`, "utf8")))).join("\n");
}

export async function readApiRoutes() {
  return readTree("lib/api");
}

export async function readAppCss() {
  return `${await readFile("app/globals.css", "utf8")}\n${await readTree("app/styles")}`;
}
