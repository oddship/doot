#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import Database from "better-sqlite3";
import next from "next";
import { WebSocketServer } from "ws";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.DOOT_HOST || "127.0.0.1";
const port = Number(process.env.DOOT_PORT || process.env.EMAIL_UI_PORT || 8765);
const databasePath = process.env.DOOT_DATABASE_PATH || path.join(process.cwd(), "email-cache.sqlite3");
try {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const bootstrap = new Database(databasePath, { timeout: 20_000 });
  const hasSessions = bootstrap
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='agent_sessions'")
    .get();
  if (hasSessions)
    bootstrap
      .prepare("UPDATE agent_sessions SET status='error',updated_at=?,error=? WHERE status='running'")
      .run(new Date().toISOString(), "Application restarted before this run completed");
  bootstrap.close();
} catch (error) {
  console.error("Could not finalize interrupted Doot sessions:", error);
}
const app = next({ dev, hostname, port });
await app.prepare();
const handle = app.getRequestHandler();
const server = http.createServer((request, response) => handle(request, response));
const sockets = new Set();
const schedulerToken = randomUUID();
globalThis.__dootSchedulerToken = schedulerToken;

globalThis.__emailAgentBroadcast = (event) => {
  const encoded = JSON.stringify(event);
  for (const socket of sockets) if (socket.readyState === 1) socket.send(encoded);
};

const wss = new WebSocketServer({ noServer: true });
wss.on("connection", (socket) => {
  sockets.add(socket);
  socket.send(JSON.stringify({ type: "cache.refresh", resource: "all" }));
  socket.on("close", () => sockets.delete(socket));
});
server.on("upgrade", (request, socket, head) => {
  if (request.url !== "/ws") return socket.destroy();
  wss.handleUpgrade(request, socket, head, (client) => wss.emit("connection", client, request));
});
const close = (signal) => {
  console.log(`Received ${signal}; shutting down Doot.`);
  if (schedulerTimer) clearInterval(schedulerTimer);
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.once("SIGINT", () => close("SIGINT"));
process.once("SIGTERM", () => close("SIGTERM"));
let schedulerTimer;
const schedulerTick = () => {
  void fetch(`http://${hostname}:${port}/api/scheduler/tick`, {
    method: "POST",
    headers: { "x-doot-scheduler-token": schedulerToken },
  }).catch((error) => console.error("Scheduler tick failed:", error.message));
};
const warmMessageReaders = async () => {
  try {
    const response = await fetch(`http://${hostname}:${port}/api/accounts`);
    if (!response.ok) return;
    const { accounts = [] } = await response.json();
    await Promise.allSettled(
      accounts.slice(0, 12).map((account) =>
        fetch(`http://${hostname}:${port}/api/accounts/${encodeURIComponent(account.name)}/warm`, {
          method: "POST",
        }),
      ),
    );
  } catch (error) {
    console.error("Message reader warm-up failed:", error.message);
  }
};
server.listen(port, hostname, () => {
  console.log(`Doot listening at http://${hostname}:${port}`);
  setTimeout(() => {
    schedulerTick();
    void warmMessageReaders();
  }, 1_000).unref();
  schedulerTimer = setInterval(schedulerTick, 30_000);
  schedulerTimer.unref();
});
