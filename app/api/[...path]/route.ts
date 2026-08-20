import { errorResponse } from "@/lib/api/context";
import { API_ROUTE_HANDLERS } from "@/lib/api/routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handler(request: Request, context: { params: Promise<{ path: string[] }> }) {
  try {
    const { path } = await context.params;
    const route = { request, path, key: path.join("/"), method: request.method, url: new URL(request.url) };
    for (const handle of API_ROUTE_HANDLERS) {
      const response = await handle(route);
      if (response) return response;
    }
    return errorResponse("Not found", 404);
  } catch (error) {
    return errorResponse(error);
  }
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
