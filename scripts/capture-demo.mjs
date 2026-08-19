import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import "./build-static-demo.mjs";

const executablePath = process.env.CHROMIUM_PATH;
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const externalRequests = [];
const consoleErrors = [];
page.on("request", (request) => {
  if (!request.url().startsWith("file:")) externalRequests.push(request.url());
});
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
await page.goto(pathToFileURL(path.resolve("_site/demo/index.html")).toString(), { waitUntil: "load" });
for (const view of ["inbox", "flows", "history", "settings", "workspace"]) {
  await page.locator(`.demo-nav[data-view="${view}"]`).click();
  if (await page.locator(`[data-panel="${view}"]`).getAttribute("hidden"))
    throw new Error(`Demo view did not open: ${view}`);
}
const overflow = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - innerWidth));
if (overflow) throw new Error(`Demo has ${overflow}px of horizontal overflow`);
if (externalRequests.length) throw new Error(`Demo made external requests: ${externalRequests.join(", ")}`);
if (consoleErrors.length) throw new Error(`Demo emitted console errors: ${consoleErrors.join("; ")}`);
await page.screenshot({ path: "docs/_static/doot-demo.png" });
await browser.close();
console.log("Demo screenshot written to docs/_static/doot-demo.png");
