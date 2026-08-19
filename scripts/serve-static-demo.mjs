import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

const root = path.resolve("_site");
const port = Number(process.env.DOOT_DEMO_PORT || 8780);
const types = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

createServer(async (request, response) => {
  const requestedPath = decodeURIComponent(new URL(request.url || "/", "http://localhost").pathname);
  const pathname = requestedPath === "/doot" ? "/" : requestedPath.replace(/^\/doot(?=\/)/, "");
  const safePath = path.resolve(root, `.${pathname}`);
  if (!safePath.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  let file = safePath;
  try {
    if ((await stat(file)).isDirectory()) file = path.join(file, "index.html");
    const info = await stat(file);
    response.writeHead(200, {
      "Content-Type": types[path.extname(file)] || "application/octet-stream",
      "Content-Length": info.size,
    });
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404).end("Not found");
  }
}).listen(port, "127.0.0.1", () => console.log(`Doot demo: http://127.0.0.1:${port}/doot/demo/`));
