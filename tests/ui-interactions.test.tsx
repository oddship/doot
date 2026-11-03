import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PromptInput } from "@/components/ai-elements";
import { Dialog, Tabs } from "@/components/ui";

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
it("does not discard or submit a queued prompt while a run is active, including Enter and form submission", async () => {
  const submit = vi.fn();
  await act(async () =>
    root.render(<PromptInput value="Keep my next task" onChange={() => {}} onSubmit={submit} disabled />),
  );
  await act(async () => {
    container
      .querySelector("textarea")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(submit).not.toHaveBeenCalled();
  expect(container.querySelector("textarea")!.value).toBe("Keep my next task");
});
it("moves focus into dialogs, traps Tab, respects busy confirmation, and restores focus on close", async () => {
  const trigger = document.createElement("button");
  document.body.append(trigger);
  trigger.focus();
  const close = vi.fn();
  const dialog = (open: boolean, busy = false) => (
    <Dialog title="Review change" open={open} onClose={close} closeDisabled={busy}>
      <button type="button">Confirm</button>
    </Dialog>
  );
  await act(async () => root.render(dialog(true)));
  const buttons = container.querySelectorAll("button");
  expect(document.activeElement).toBe(buttons[0]);
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }),
    ),
  );
  expect(document.activeElement).toBe(buttons[1]);
  await act(async () => root.render(dialog(true, true)));
  await act(async () =>
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })),
  );
  expect(close).not.toHaveBeenCalled();
  await act(async () => root.render(dialog(true)));
  await act(async () =>
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })),
  );
  expect(close).toHaveBeenCalledOnce();
  await act(async () => root.render(dialog(false)));
  expect(document.activeElement).toBe(trigger);
  trigger.remove();
});
it("supports arrow-key navigation and roving focus in message format tabs", async () => {
  function Controlled() {
    const [value, setValue] = useState("Message");
    return <Tabs id="format" tabs={["Message", "Plain text"]} value={value} onChange={setValue} />;
  }
  await act(async () => root.render(<Controlled />));
  const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
  tabs[0].focus();
  await act(async () =>
    tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true })),
  );
  expect(document.activeElement).toBe(tabs[1]);
  expect(tabs[1].getAttribute("aria-selected")).toBe("true");
  expect(tabs[0].tabIndex).toBe(-1);
});
