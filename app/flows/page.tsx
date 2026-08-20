import { loadFlowsPageData } from "@/app/flows/flow-page-data";
import { RulesClient } from "@/components/rules-client";

export const dynamic = "force-dynamic";

export default async function FlowsPage() {
  const { rules, accounts, folders } = await loadFlowsPageData();
  return <RulesClient initialRules={rules} accounts={accounts} folders={folders} />;
}
