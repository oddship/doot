import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

// Check emitted CSS: source tests cannot detect css-loader's import-layer rewrite.
const directory = ".next/static/css";
const files = (await readdir(directory)).filter((file) => file.endsWith(".css"));
assert(files.length, "Production build must emit a stylesheet");
const css = (await Promise.all(files.map((file) => readFile(`${directory}/${file}`, "utf8")))).join("\n");
assert(!/@media[^{}]*layer\s*\(/.test(css), "CSS loader turned a cascade layer into a non-matching media query");
assert(/@layer\s+design\s*\{/.test(css), "Shared design layer is missing from the production build");
assert(/--primary\s*:\s*#006a73\b/.test(css), "Doot theme tokens are missing from the production build");
assert(css.includes("Oatbase v0.1.0"), "Pinned Oatbase distribution is missing from the production build");
console.log("Production CSS verified: Oatbase, theme tokens, and active cascade layers.");
