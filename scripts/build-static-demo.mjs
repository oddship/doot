import { spawn } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const basePath = process.env.NEXT_PUBLIC_DOOT_DEMO_BASE_PATH || "/doot/demo";
const output = path.resolve(process.argv[2] || "_site/demo");
const nextBin = path.resolve("node_modules/next/dist/bin/next");

await mkdir("demo-site/public", { recursive: true });
await cp("public/doot-mark.svg", "demo-site/public/doot-mark.svg");

await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [nextBin, "build", "demo-site", "--webpack"], {
    stdio: "inherit",
    env: { ...process.env, NEXT_PUBLIC_DOOT_DEMO_BASE_PATH: basePath },
  });
  child.on("error", reject);
  child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`Next demo build exited with ${code}`))));
});

await rm(output, { recursive: true, force: true });
await mkdir(path.dirname(output), { recursive: true });
await cp("demo-site/out", output, { recursive: true });
await mkdir(path.join(output, "_frozen-api"), { recursive: true });
await cp("demo-site/fixtures", path.join(output, "_frozen-api"), { recursive: true });
console.log(`Next static export built at ${output} (base path: ${basePath || "/"})`);
