// Synthetic message responses measure reader latency without fetching mail.
import fs from "node:fs/promises";
import { chromium } from "@playwright/test";

const base = process.env.DOOT_BASE_URL || "http://127.0.0.1:8766";
const output = process.env.DOOT_READER_REPORT;
if (!output) throw new Error("Set DOOT_READER_REPORT");
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
});
try {
  const page = await browser.newPage();
  let requests = 0;
  await page.route("**/api/accounts/*/warm", (route) => route.fulfill({ json: { warm: true } }));
  await page.route("**/api/message?**", async (route) => {
    requests++;
    const uid = new URL(route.request().url()).searchParams.get("uid");
    await new Promise((resolve) => setTimeout(resolve, 150));
    await route.fulfill({
      json: { body_text: `Synthetic reader ${uid}`, body_html_sanitized: "", remote_images_allowed: false },
    });
  });
  await page.goto(`${base}/inbox`, { waitUntil: "networkidle" });
  const rows = page.locator(".mail-open");
  if ((await rows.count()) < 2) throw new Error("Two cached message headers are needed");
  const open = async (index) => {
    const started = performance.now();
    await rows.nth(index).click();
    await page.waitForFunction(
      () => !!document.querySelector(".plain-content")?.textContent?.startsWith("Synthetic reader"),
    );
    return performance.now() - started;
  };
  const first_ms = await open(0);
  const firstBody = await page.locator(".plain-content").textContent();
  await open(1);
  const reopened_ms = await open(0);
  if ((await page.locator(".plain-content").textContent()) !== firstBody) throw new Error("Wrong reopened message");
  const report = {
    context: "150ms simulated message response; no provider body reads",
    first_ms,
    reopened_ms,
    message_requests: requests,
  };
  await fs.writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
