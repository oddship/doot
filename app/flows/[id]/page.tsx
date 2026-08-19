import { notFound } from "next/navigation";
import { loadRulesPageData } from "@/app/rules/rule-page-data";
import { RulesClient } from "@/components/rules-client";

export const dynamic = "force-dynamic";

export default async function FlowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isSafeInteger(id) || id < 1) notFound();

  const { rules, accounts, folders } = await loadRulesPageData();
  if (!rules.some((rule: { id: number }) => rule.id === id)) notFound();

  return <RulesClient initialRules={rules} accounts={accounts} folders={folders} initialFocus={id} />;
}
