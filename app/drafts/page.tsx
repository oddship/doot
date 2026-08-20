import { DraftsClient } from "@/components/drafts-client";
import { listDrafts } from "@/lib/drafts";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function DraftsPage() {
  const { accounts } = await store<any>(["accounts"]);
  return <DraftsClient initialDrafts={listDrafts().drafts} accounts={accounts} />;
}
