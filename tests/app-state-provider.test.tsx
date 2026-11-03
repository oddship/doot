import { act, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AppStateProvider } from "@/components/app-state-provider";
import { CLIENT_NAVIGATION_EVENT } from "@/lib/client-navigation";

const { push, toast } = vi.hoisted(() => ({ push: vi.fn(), toast: { error: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/components/feedback", () => ({ useToast: () => toast }));
vi.mock("@/lib/use-cache-events", () => ({ useCacheEvents: vi.fn() }));
it("resets local state when navigating to the same route after a local URL change", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  history.replaceState(null, "", "/inbox");
  const mounted = vi.fn();
  function Header() {
    useEffect(() => {
      mounted();
    }, []);
    return <header>Header</header>;
  }
  function Page() {
    const [query, setQuery] = useState("initial");
    return (
      <button type="button" onClick={() => setQuery("filtered page 3")}>
        {query}
      </button>
    );
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <AppStateProvider state={{}} header={<Header />}>
          <Page />
        </AppStateProvider>,
      ),
    );
    await act(async () => container.querySelector("button")!.click());
    history.replaceState(null, "", "/inbox?query=filter&page=3");
    expect(container.querySelector("button")?.textContent).toBe("filtered page 3");
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(CLIENT_NAVIGATION_EVENT, { cancelable: true, detail: { path: "/inbox", replace: false } }),
      );
    });
    expect(push).toHaveBeenCalledWith("/inbox");
    expect(container.querySelector("button")?.textContent).toBe("initial");
    expect(mounted).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    history.replaceState(null, "", "/");
    vi.unstubAllGlobals();
  }
});
