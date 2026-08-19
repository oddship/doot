import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const baseURL = process.env.DOOT_BASE_URL || "http://127.0.0.1:8765";
const outputDir = path.resolve(process.env.DOOT_SCREENSHOT_DIR || "artifacts/ui-audit");
const executablePath = process.env.CHROMIUM_PATH;
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  locale: "en-IN",
  timezoneId: "Asia/Kolkata",
  colorScheme: "light",
});

const report = [];
async function capture(name, route, prepare) {
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => message.type() === "error" && consoleErrors.push(message.text()));
  await page.goto(new URL(route, baseURL).toString(), { waitUntil: "networkidle" });
  if (prepare) await prepare(page);
  await page.waitForTimeout(400);
  const metrics = await page.evaluate(() => ({
    viewport: { width: innerWidth, height: innerHeight },
    horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
    topbarTop: Math.round(document.querySelector(".topbar")?.getBoundingClientRect().top ?? -1),
    activeNavigation: document.querySelector(".nav a.active")?.textContent?.trim() || null,
  }));
  await page.screenshot({ path: path.join(outputDir, `${name}.png`) });
  report.push({ name, route: page.url(), ...metrics, consoleErrors });
  await page.close();
}

await capture("workspace", "/");
await capture("inbox", "/inbox");
await capture("inbox-message", "/inbox", async (page) => page.locator(".mail-item").first().click());

const discovery = await context.newPage();
await discovery.goto(new URL("/flows", baseURL).toString(), { waitUntil: "networkidle" });
const flowRoute = await discovery.locator('a[href^="/flows/"]').first().getAttribute("href");
await discovery.goto(new URL("/history", baseURL).toString(), { waitUntil: "networkidle" });
const historyRoute = await discovery.locator('a[href^="/history/"]').first().getAttribute("href");
await discovery.close();

await capture("flows", flowRoute || "/flows");
await capture("history", "/history");
if (historyRoute) await capture("history-replay", historyRoute);
await capture("settings", "/settings");
await capture("settings-controls", "/settings", async (page) => page.locator("#provider").scrollIntoViewIfNeeded());

await browser.close();
await writeFile(path.join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);

const failures = report.filter(
  (page) => page.horizontalOverflow > 0 || page.topbarTop !== 0 || page.consoleErrors.length,
);
console.log(JSON.stringify({ screenshots: outputDir, pages: report.length, failures }, null, 2));
if (failures.length) process.exitCode = 1;
