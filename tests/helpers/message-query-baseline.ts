import type Database from "better-sqlite3";
import type { FacetInput } from "@/lib/message-facets";

// Frozen pre-optimization definitions for result-equivalence tests and benchmarks.
export const legacyCanonicalSql = `SELECT * FROM (
  SELECT messages.*, ROW_NUMBER() OVER (
    PARTITION BY account, CASE WHEN provider_id<>'' THEN 'provider:'||provider_id ELSE 'uid:'||folder||char(0)||uid END
    ORDER BY CASE WHEN lower(folder)='inbox' THEN 0 WHEN lower(folder) LIKE '%all mail' THEN 1 ELSE 2 END,
      folder COLLATE NOCASE, CAST(uid AS INTEGER) DESC
  ) canonical_rank FROM messages WHERE present=1
) WHERE canonical_rank=1`;

export function legacyFacets(
  database: Database.Database,
  input: FacetInput,
  where: string,
  values: any[],
  timestamp: number,
  view: "canonical_messages" | "legacy_canonical_messages" = "legacy_canonical_messages",
) {
  const limit = Math.max(5, Math.min(input.limit || 25, 50));
  const total = Number(
    (database.prepare(`SELECT COUNT(*) count FROM ${view} messages${where}`).get(...values) as any).count,
  );
  const accounts = database
    .prepare(
      `SELECT account,account_email,COUNT(*) count FROM ${view} messages${where} GROUP BY account,account_email ORDER BY count DESC`,
    )
    .all(...values);
  const top_senders = database
    .prepare(
      `SELECT sender name,COUNT(*) count FROM ${view} messages${where} GROUP BY sender ORDER BY count DESC,sender LIMIT ?`,
    )
    .all(...values, limit);
  const domainCounts = new Map<string, number>();
  for (const row of database.prepare(`SELECT sender FROM ${view} messages${where}`).all(...values) as any[]) {
    const domain =
      String(row.sender)
        .match(/@([A-Za-z0-9.-]+)/)?.[1]
        ?.toLowerCase() || "unknown";
    domainCounts.set(domain, (domainCounts.get(domain) || 0) + 1);
  }
  const top_domains = [...domainCounts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
  const ranges: Array<[string, number, number]> = [
    ["last_24_hours", timestamp - 86400, timestamp + 1],
    ["last_7_days", timestamp - 7 * 86400, timestamp - 86400],
    ["last_30_days", timestamp - 30 * 86400, timestamp - 7 * 86400],
    ["older", 0, timestamp - 30 * 86400],
  ];
  const age_buckets = ranges.map(([label, lower, upper]) => ({
    label,
    count: Number(
      (
        database
          .prepare(
            `SELECT COUNT(*) count FROM ${view} messages${where}${where ? " AND" : " WHERE"} date_ts>=? AND date_ts<?`,
          )
          .get(...values, lower, upper) as any
      ).count,
    ),
  }));
  return { total, filters: input, accounts, top_senders, top_domains, age_buckets };
}
