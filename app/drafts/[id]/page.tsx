import { notFound } from "next/navigation";
import { DraftsClient } from "@/components/drafts-client";
import { listDrafts } from "@/lib/drafts";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function DraftPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id < 1) notFound();
  const drafts = listDrafts().drafts;
  if (!drafts.some((draft) => draft.id === id)) notFound();
  const { accounts } = await store<any>(["accounts"]);
  return <DraftsClient initialDrafts={drafts} accounts={accounts} initialFocus={id} />;
}
