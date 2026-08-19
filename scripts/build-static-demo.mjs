import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const output = path.resolve(process.argv[2] || "_site/demo");
const [applicationCss, demoCss, template] = await Promise.all([
  readFile("app/globals.css", "utf8"),
  readFile("demo/demo.css", "utf8"),
  readFile("demo/index.html", "utf8"),
]);
const css = applicationCss.replace(/^@import\s+["']tailwindcss["'];?\s*/m, "");

await mkdir(output, { recursive: true });
await writeFile(path.join(output, "index.html"), template.replace("/*__DOOT_CSS__*/", `${css}\n${demoCss}`));
await copyFile("public/doot-mark.svg", path.join(output, "doot-mark.svg"));
console.log(`Frozen Doot demo built at ${output}`);
