import { runAgent } from "@/lib/agent-runtime";
import { createDetachedUIMessageStream } from "@/lib/ui-message-stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function lastUserText(messages: any[]) {
  const message = [...(messages || [])].reverse().find((item) => item.role === "user");
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  return (message.parts || [])
    .filter((part: any) => part.type === "text")
    .map((part: any) => part.text)
    .join("\n");
}

export async function POST(request: Request) {
  const body = await request.json();
  const text = String(body.text || lastUserText(body.messages) || "").trim();
  if (!text && !body.organize) return Response.json({ error: "A prompt is required" }, { status: 400 });
  const stream = createDetachedUIMessageStream((send) =>
    runAgent(
      {
        sessionId: body.sessionId,
        text,
        organize: body.organize === true,
        selected: body.selected,
        selectedRule: body.selectedRule,
      },
      send,
    ),
  );
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "x-vercel-ai-ui-message-stream": "v1",
    },
  });
}
