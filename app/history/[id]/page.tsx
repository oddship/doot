import { HistoryDetailView } from "@/components/history-detail";
import { store } from "@/lib/store";
export const dynamic = "force-dynamic";
export default async function HistoryDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await store<any>(["session-get", id]);
  const metadata = Object.assign({}, ...data.events.map((event: any) => event.metadata || {}));
  const proposalId = data.job?.source?.proposal_id || metadata.proposal_id;
  const proposal = proposalId ? await store<any>(["action-get", String(proposalId)]).catch(() => null) : null;
  return <HistoryDetailView key={id} initialData={data} initialProposal={proposal} />;
}
