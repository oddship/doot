import { randomUUID } from "node:crypto";
import { enqueueAgentTurn, observeAgentJob } from "@/lib/agent-jobs";
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
  try {
    const body = await request.json();
    const text = String(body.text || lastUserText(body.messages) || "").trim();
    if (!text && !body.organize) return Response.json({ error: "A prompt is required" }, { status: 400 });
    const job = enqueueAgentTurn(
      {
        sessionId: body.sessionId,
        text,
        organize: body.organize === true,
        selected: body.selected,
        selectedRule: body.selectedRule,
        selectedDraft: body.selectedDraft,
        selectedSearch: body.selectedSearch,
      },
      body.commandId || randomUUID(),
    );
    const stream = createDetachedUIMessageStream((send) => observeAgentJob(job.id, send));
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "x-vercel-ai-ui-message-stream": "v1",
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not accept agent turn" },
      { status: 400 },
    );
  }
}
