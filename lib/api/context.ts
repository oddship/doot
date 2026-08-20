export type ApiRouteContext = {
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

export async function requestBody(request: Request): Promise<any> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export async function confirmedBody(request: Request, message = "Explicit confirmation is required") {
  const value = await requestBody(request);
  if (value.confirm !== true) throw new RouteError(message, 400);
  return value;
}
