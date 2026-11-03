// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertTrustedRequest, confirmedBody, requestBody } from "@/lib/api/context";
import { createRequestPolicy, requestSecurityError } from "@/lib/request-security.mjs";

const local = "http://127.0.0.1:8765";
function request(headers: Record<string, string> = {}, body = '{"confirm":true,"id":-1}') {
  return new Request(`${local}/api/apply`, {
    method: "POST",
    headers: { host: "127.0.0.1:8765", origin: local, "content-type": "application/json", ...headers },
    body,
  });
}

afterEach(() => vi.unstubAllEnvs());

describe("local request boundaries", () => {
  it("rejects a foreign-origin text/plain form before confirming a mailbox action", async () => {
    await expect(
      confirmedBody(request({ origin: "https://attacker.example", "content-type": "text/plain" })),
    ).rejects.toMatchObject({ status: 403 });
  });

  it.each(["null", "http://127.0.0.1:8765.attacker.example", `${local}/`, `${local} https://attacker.example`])(
    "rejects the invalid or untrusted Origin %s",
    (origin) => expect(() => assertTrustedRequest(request({ origin }))).toThrow("Untrusted request origin"),
  );

  it("requires JSON even when Origin is trusted", async () => {
    await expect(requestBody(request({ "content-type": "text/plain" }))).rejects.toMatchObject({ status: 415 });
    await expect(requestBody(request({ "content-type": "application/x-www-form-urlencoded" }))).rejects.toMatchObject({
      status: 415,
    });
    await expect(requestBody(request({}, "not json"))).rejects.toMatchObject({ status: 400 });
    await expect(confirmedBody(request({ "content-type": "application/json; charset=utf-8" }))).resolves.toEqual({
      confirm: true,
      id: -1,
    });
    await expect(confirmedBody(request({}, '{"confirm":false}'))).rejects.toMatchObject({ status: 400 });
  });

  it("blocks DNS rebinding and ignores caller-supplied forwarded hosts", () => {
    expect(() =>
      assertTrustedRequest(request({ host: "attacker.example", "x-forwarded-host": "127.0.0.1:8765" })),
    ).toThrow("Untrusted request host");
    expect(() =>
      assertTrustedRequest(request({ origin: "https://attacker.example", "x-forwarded-host": "attacker.example" })),
    ).toThrow("Untrusted request origin");
  });

  it("permits origin-less local service requests but rejects cross-site Fetch Metadata", () => {
    const headers = new Headers({ host: "127.0.0.1:8765" });
    const policy = createRequestPolicy({});
    expect(requestSecurityError(headers, policy)).toBeNull();
    headers.set("sec-fetch-site", "cross-site");
    expect(requestSecurityError(headers, policy)).toBe("A trusted request origin is required");
  });

  it("requires an exact trusted Origin on WebSocket upgrades", () => {
    const headers = new Headers({ host: "127.0.0.1:8765" });
    const policy = createRequestPolicy({});
    expect(requestSecurityError(headers, policy, true)).not.toBeNull();
    headers.set("origin", "https://attacker.example");
    expect(requestSecurityError(headers, policy, true)).not.toBeNull();
    headers.set("origin", local);
    expect(requestSecurityError(headers, policy, true)).toBeNull();
  });

  it("supports local aliases and explicitly configured proxy origins", () => {
    vi.stubEnv("DOOT_ALLOWED_ORIGINS", "https://mail.example, https://other.example:9443");
    const policy = createRequestPolicy();
    for (const origin of [
      local,
      "http://localhost:8765",
      "http://[::1]:8765",
      "https://mail.example",
      "https://other.example:9443",
    ]) {
      const headers = new Headers({ host: new URL(origin).host, origin });
      expect(requestSecurityError(headers, policy, true)).toBeNull();
    }
    // Proxies may replace Host with the trusted local backend's host.
    expect(() => assertTrustedRequest(request({ origin: "https://mail.example" }))).not.toThrow();
    expect(() => assertTrustedRequest(request({ origin: "https://mail.example.attacker.example" }))).toThrow();
  });

  it("does not treat wildcard binding as a wildcard trust policy", () => {
    const policy = createRequestPolicy({ DOOT_HOST: "0.0.0.0" });
    expect(
      requestSecurityError(new Headers({ host: "attacker.example", origin: "http://attacker.example" }), policy),
    ).not.toBeNull();
    const ipv6 = createRequestPolicy({ DOOT_HOST: "::1", DOOT_PORT: "9999" });
    expect(
      requestSecurityError(new Headers({ host: "[::1]:9999", origin: "http://[::1]:9999" }), ipv6, true),
    ).toBeNull();
  });

  it.each([
    "https://*.example",
    "https://mail.example/path",
    "https://user:pass@mail.example",
    "https://mail.example?a=b",
    "https://mail.example#fragment",
    "file:///tmp/mail",
  ])("fails closed for invalid configured origin %s", (origin) =>
    expect(() => createRequestPolicy({ DOOT_ALLOWED_ORIGINS: origin })).toThrow(),
  );
});
