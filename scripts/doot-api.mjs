#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function parseArguments(args) {
  const [method, path, ...rest] = args;
  if (!method || !path || !["get", "post", "put", "delete"].includes(method.toLowerCase()))
    throw new Error(
      "Usage: node scripts/doot-api.mjs METHOD /path [--data-file FILE|-] [--wait] [--timeout-ms N]\nPaths are relative to /api/v1. JSON is read from a file or stdin; confirmation is never added automatically.",
    );
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("#"))
    throw new Error("Use an API-relative path starting with one /");
  const options = { method: method.toUpperCase(), path, wait: false, timeout: 120000, dataFile: undefined };
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--wait") options.wait = true;
    else if (rest[i] === "--data-file" && rest[i + 1]) options.dataFile = rest[++i];
    else if (rest[i] === "--timeout-ms" && rest[i + 1]) options.timeout = Number(rest[++i]);
    else throw new Error(`Unknown or incomplete option: ${rest[i]}`);
  }
  if (!Number.isSafeInteger(options.timeout) || options.timeout < 100 || options.timeout > 3600000)
    throw new Error("Timeout must be 100–3600000 milliseconds");
  if (options.method === "GET" && options.dataFile) throw new Error("GET requests cannot have a JSON body");
  return options;
}

export async function runApi(options, dependencies = {}) {
  const fetcher = dependencies.fetch || fetch;
  const sleep = dependencies.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const base = new URL(dependencies.base || process.env.DOOT_API_URL || "http://127.0.0.1:8765");
  if (
    !/^https?:$/.test(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== "/"
  )
    throw new Error("DOOT_API_URL must be an HTTP(S) origin without credentials, query or path");
  const root = new URL("/api/v1/", base);
  const url = new URL(`.${options.path}`, root);
  if (!url.pathname.startsWith(root.pathname) || url.origin !== base.origin)
    throw new Error("Path must stay inside /api/v1");
  const deadline = Date.now() + options.timeout;
  const request = async (target, method, body) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("Timed out; inspect the saved job before retrying an action");
    const response = await fetcher(target, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(remaining),
      headers: { Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${result.error || "Request failed"}`);
    return result;
  };
  let body;
  if (options.dataFile) {
    let raw;
    if (options.dataFile === "-") {
      if (dependencies.readStdin) raw = await dependencies.readStdin();
      else {
        const chunks = [];
        for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
        raw = Buffer.concat(chunks).toString("utf8");
      }
    } else raw = await (dependencies.readFile || readFile)(options.dataFile, "utf8");
    body = JSON.parse(raw);
  }
  const accepted = await request(url, options.method, body);
  if (!options.wait) return accepted;
  let job = accepted.job;
  // Sync and other legacy operations may return the job itself.
  if (!job && accepted.id && accepted.kind && accepted.status) job = accepted;
  if (!job?.id) throw new Error("This response has no durable job to wait for");
  try {
    while (["queued", "running"].includes(job.status)) {
      await sleep(Math.min(1000, Math.max(1, deadline - Date.now())));
      job = (await request(new URL(`jobs/${encodeURIComponent(job.id)}`, root), "GET")).job;
    }
  } catch (error) {
    throw new Error(
      `Could not finish waiting for saved job ${job.id}: ${error.message}. Inspect /jobs/${job.id} before retrying.`,
    );
  }
  return { accepted, job, completed: job.status === "complete" };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await runApi(parseArguments(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.completed === false) process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
