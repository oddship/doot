import { InboxClient } from "@/components/inbox-client";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const account = typeof params.account === "string" ? params.account : "all";
  const query = typeof params.query === "string" ? params.query : "";
  const openUid = typeof params.open === "string" ? params.open : undefined;
  const openFolder = typeof params.folder === "string" ? params.folder : undefined;
  const requestedLimit = typeof params.limit === "string" ? Number(params.limit) : 25;
  const limit = [25, 50, 100].includes(requestedLimit) ? requestedLimit : 25;
  const requestedPage = typeof params.page === "string" ? Number(params.page) : 1;
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const [{ accounts }, initial] = await Promise.all([
    store<any>(["accounts"]),
    store<any>([
      "list",
      "--account",
      account,
      "--query",
      query,
      "--offset",
      String((page - 1) * limit),
      "--limit",
      String(limit),
      "--focus",
      openUid || "",
      "--focus-folder",
      openFolder || "",
    ]),
  ]);
  return (
    <InboxClient
      accounts={accounts}
      initial={initial}
      initialAccount={account}
      initialQuery={query}
      initialOpenUid={openUid}
      initialOpenFolder={openFolder}
      initialLimit={limit}
    />
  );
}
