// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createDetachedUIMessageStream, type UIStreamEvent } from "@/lib/ui-message-stream";

describe("detached UI message stream", () => {
  it("continues the producer after the browser reader cancels", async () => {
    let sendAfterDisconnect: ((event: UIStreamEvent) => void) | undefined;
    let finish!: () => void;
    let completed = false;
    const work = new Promise<void>((resolve) => {
      finish = () => {
        completed = true;
        resolve();
      };
    });
    const stream = createDetachedUIMessageStream(async (send) => {
      sendAfterDisconnect = send;
      send({ type: "start", messageId: "one" });
      await work;
      send({ type: "data-workspace", data: { persisted: true } });
    });
    const reader = stream.getReader();
    await reader.read();
    await reader.cancel("navigated away");
    expect(() => sendAfterDisconnect?.({ type: "text-delta", delta: "still running" })).not.toThrow();
    finish();
    await work;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(completed).toBe(true);
  });
});
