// Shared by the custom HTTP server and Next's route handlers. Never infer trust
// from Host, Forwarded, or X-Forwarded-* supplied by the caller.
export function createRequestPolicy(env = process.env) {
  const port = Number(env.DOOT_PORT || env.EMAIL_UI_PORT || 8765);
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  const bindHost = env.DOOT_HOST || "127.0.0.1";
  if (!["0.0.0.0", "::", "[::]"].includes(bindHost)) {
    const hostname = bindHost.includes(":") && !bindHost.startsWith("[") ? `[${bindHost}]` : bindHost;
    hosts.add(`${hostname}:${port}`.toLowerCase());
  }
  const origins = new Set([...hosts].map((host) => new URL(`http://${host}`).origin));
  for (const value of (env.DOOT_ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)) {
    const url = new URL(value);
    if (
      !/^https?:$/.test(url.protocol) ||
      url.hostname.includes("*") ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error("DOOT_ALLOWED_ORIGINS must contain exact HTTP(S) origins without credentials or paths");
    origins.add(url.origin);
    hosts.add(url.host);
  }
  return { hosts, origins };
}

export function requestSecurityError(headers, policy, websocket = false) {
  const host = headers.get("host");
  if (!host || !policy.hosts.has(host.toLowerCase())) return "Untrusted request host";
  const origin = headers.get("origin");
  if (origin !== null) {
    // Compare the serialized origin exactly; reject null, lists and URL paths.
    if (!policy.origins.has(origin)) return "Untrusted request origin";
  } else if (websocket || headers.get("sec-fetch-site") === "cross-site") {
    return "A trusted request origin is required";
  }
  return null;
}
