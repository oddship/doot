export type JsonRequestInit = Omit<RequestInit, "body"> & {
  body?: BodyInit | null;
  json?: unknown;
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiJson<T = any>(
  input: RequestInfo | URL,
  init: JsonRequestInit = {},
  fallback = "Request failed",
): Promise<T> {
  const { json, ...requestInit } = init;
  if (json !== undefined) {
    const headers = new Headers(requestInit.headers);
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    requestInit.headers = headers;
    requestInit.body = JSON.stringify(json);
  }
  const response = await fetch(input, requestInit);
  const text = await response.text();
  let payload: any = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: text };
    }
  }
  if (!response.ok) throw new ApiError(String(payload?.error || fallback), response.status, payload);
  return payload as T;
}

export function errorMessage(error: unknown, fallback = "Request failed") {
  return error instanceof Error && error.message ? error.message : fallback;
}
