import { HistoryScreen } from "@/components/history-screen";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const { sessions } = await store<any>(["session-list"]);
  return <HistoryScreen sessions={sessions} />;
}
