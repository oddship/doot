import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";
import "./build-static-demo.mjs";

const port = 8781;
const server = spawn(process.execPath, ["scripts/serve-static-demo.mjs"], {
  stdio: "ignore",
  env: { ...process.env, DOOT_DEMO_PORT: String(port) },
});
const executablePath = process.env.CHROMIUM_PATH;

try {
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const externalRequests = [];
  const consoleErrors = [];
  const failedResources = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.hostname !== "127.0.0.1") externalRequests.push(request.url());
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      const location = message.location();
      consoleErrors.push(`${message.text()}${location.url ? ` (${location.url})` : ""}`);
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 400) failedResources.push(`${response.status()} ${response.url()}`);
  });
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await page.goto(`http://127.0.0.1:${port}/doot/demo/`, { waitUntil: "networkidle" });
      break;
    } catch (error) {
      if (attempt === 29) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  const views = [
    ["inbox", "Inbox"],
    ["flows", "Flows"],
    ["history", "History"],
    ["settings", "Settings"],
    ["workspace", "Workspace"],
  ];
  for (const [view, label] of views) {
    await page.locator(".nav a").filter({ hasText: label }).click();
    if ((await page.locator(".demo-main").getAttribute("data-demo-view")) !== view)
      throw new Error(`Demo view did not open: ${view}`);
    const viewOverflow = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - innerWidth));
    if (viewOverflow) throw new Error(`${view} has ${viewOverflow}px of horizontal overflow`);
  }
  if (externalRequests.length) throw new Error(`Demo made external requests: ${externalRequests.join(", ")}`);
  if (consoleErrors.length || failedResources.length)
    throw new Error(`Demo emitted browser errors: ${[...consoleErrors, ...failedResources].join("; ")}`);
  await page.screenshot({ path: "docs/_static/doot-demo.png" });
  await browser.close();
  console.log("Demo screenshot written to docs/_static/doot-demo.png");
} finally {
  server.kill("SIGTERM");
}
