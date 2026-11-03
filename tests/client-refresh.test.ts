// @vitest-environment node
import { expect, it, vi } from "vitest";
import { createRefreshQueue } from "@/lib/client-refresh";

it("keeps only one read in flight and performs one trailing read after a burst", async () => {
  let finish!: () => void;
  const load = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue(undefined);
  const refresh = createRefreshQueue(load);
  const first = refresh();
  await Promise.resolve();
  for (let i = 0; i < 50; i++) refresh();
  expect(load).toHaveBeenCalledOnce();
  finish();
  await first;
  expect(load).toHaveBeenCalledTimes(2);
});
