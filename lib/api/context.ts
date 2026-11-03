import { createRequestPolicy, requestSecurityError } from "@/lib/request-security.mjs";

type ApiRouteContext = {
  request: Request;
  path: string[];
  key: string;
  method: string;
  url: URL;
};

export type ApiRouteHandler = (context: ApiRouteContext) => Promise<Response | null>;

export class RouteError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function errorResponse(error: unknown, status = error instanceof RouteError ? error.status : 500) {
  return Response.json({ error: String((error as Error)?.message || error) }, { status });
}

export function assertTrustedRequest(request: Request) {
  const error = requestSecurityError(request.headers, createRequestPolicy());
  if (error) throw new RouteError(error, 403);
}

export async function requestBody(request: Request): Promise<any> {
  assertTrustedRequest(request);
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json")
    throw new RouteError("Content-Type must be application/json", 415);
  try {
    return await request.json();
  } catch {
    throw new RouteError("Invalid JSON request body", 400);
  }
}

export async function confirmedBody(request: Request, message = "Explicit confirmation is required") {
  const value = await requestBody(request);
  if (value.confirm !== true) throw new RouteError(message, 400);
  return value;
}
