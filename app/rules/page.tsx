import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function RulesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const focus = typeof params.focus === "string" ? Number(params.focus) : undefined;
  redirect(Number.isSafeInteger(focus) && Number(focus) > 0 ? `/flows/${focus}` : "/flows");
}
