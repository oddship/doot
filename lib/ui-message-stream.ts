export type UIStreamEvent = Record<string, unknown>;

/**
 * Creates a UI-message SSE stream whose producer outlives its browser reader.
 * Navigating away cancels only writes to this response; it never cancels the
 * Agent promise, which continues persisting events and generated workspaces.
 */
export function createDetachedUIMessageStream(run: (send: (event: UIStreamEvent) => void) => Promise<unknown>) {
  const encoder = new TextEncoder();
  let detached = false;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (value: string) => {
        if (detached) return;
        try {
          controller.enqueue(encoder.encode(value));
        } catch {
          detached = true;
        }
      };
      const send = (event: UIStreamEvent) => write(`data: ${JSON.stringify(event)}\n\n`);
      // Deliberately not tied to Request.signal. The bounded runtime owns this
      // promise after the HTTP observer disconnects.
      void run(send)
        .then(() => {
          write("data: [DONE]\n\n");
          if (!detached) {
            try {
              controller.close();
            } catch {
              detached = true;
            }
          }
        })
        .catch((error) => {
          send({ type: "error", errorText: String(error?.message || error) });
          write("data: [DONE]\n\n");
          if (!detached) {
            try {
              controller.close();
            } catch {
              detached = true;
            }
          }
        });
    },
    cancel() {
      detached = true;
    },
  });
}
