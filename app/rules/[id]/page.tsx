import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function RulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  redirect(`/flows/${encodeURIComponent(rawId)}`);
}
