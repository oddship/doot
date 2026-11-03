// Read-only timings plus local composer edits. Run against an isolated cache copy.
// Output contains counts and timings, never message content or credentials.
import fs from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { chromium } from "@playwright/test";

const base = process.env.DOOT_BASE_URL || "http://127.0.0.1:8766";
const output = process.env.DOOT_PERFORMANCE_REPORT;
if (!output) throw new Error("Set DOOT_PERFORMANCE_REPORT to the JSON report path");
const report = { runtime: "production", base, api: [], browser: [] };
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const sessions = await (await fetch(`${base}/api/agent/sessions`)).json();
const agent = sessions.sessions.find((session) => session.history_kind === "agent");
const endpoints = ["/api/messages?limit=25", "/api/jobs", "/api/agent/sessions", "/api/workspaces/latest"];
if (agent) endpoints.push(`/api/agent/sessions/${encodeURIComponent(agent.id)}`);
for (const endpoint of endpoints) {
  const durations = [];
  let bytes = 0;
  for (let i = 0; i < 8; i++) {
    const started = performance.now();
    const response = await fetch(base + endpoint);
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${endpoint}`);
    bytes = (await response.arrayBuffer()).byteLength;
    if (i) durations.push(performance.now() - started);
  }
  report.api.push({
    name: endpoint.includes("/sessions/") ? "conversation detail" : endpoint,
    median_ms: median(durations),
    bytes,
  });
}
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
});
try {
  for (const route of ["/", "/history"]) {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await context.newPage();
    const requests = [];
    let sockets = 0;
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/"))
        requests.push({ method: request.method(), path: new URL(request.url()).pathname });
    });
    page.on("websocket", () => sockets++);
    const started = performance.now();
    await page.goto(base + route, { waitUntil: "networkidle" });
    const navigation_ms = performance.now() - started;
    requests.length = 0;
    await page.waitForTimeout(12_000);
    const idle = {
      route,
      navigation_ms,
      idle_seconds: 12,
      idle_requests: requests.length,
      sockets,
      requests_by_path: Object.fromEntries(
        [...new Set(requests.map((r) => r.path))].map((path) => [path, requests.filter((r) => r.path === path).length]),
      ),
    };
    if (route === "/") {
      requests.length = 0;
      const composer = page.locator(".prompt-box textarea");
      await composer.fill("");
      const typingStarted = performance.now();
      await composer.pressSequentially("performance");
      idle.typing_ms = performance.now() - typingStarted;
      await page.waitForTimeout(350);
      let documents = 0;
      page.on("request", (request) => {
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents++;
      });
      const clickStarted = performance.now();
      await page.locator('.nav a[href="/inbox"]').click();
      await page.waitForURL("**/inbox");
      await page.locator(".inbox-list").waitFor();
      idle.inbox_navigation_ms = performance.now() - clickStarted;
      idle.document_navigations = documents;
      idle.composer_writes = requests.filter((r) => r.method === "PUT" && r.path === "/api/app-state").length;
    }
    report.browser.push(idle);
    await context.close();
  }
} finally {
  await browser.close();
}
await fs.writeFile(output, JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({
    report: output,
    api: report.api.map(({ name, median_ms, bytes }) => ({ name, median_ms: Math.round(median_ms * 10) / 10, bytes })),
    browser: report.browser,
  }),
);
