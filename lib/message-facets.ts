import { db, messageWhere } from "@/lib/database";

export type FacetInput = { account?: string; query?: string; days?: number; limit?: number };
type FacetRow = { account: string; account_email: string; sender: string; date_ts: number };

// Match SQLite's default BINARY ordering, including non-ASCII sender names.
const binaryCompare = (left: string, right: string) => {
  if (left === right) return 0;
  if (/[\uD800-\uDFFF]/.test(left) || /[\uD800-\uDFFF]/.test(right))
    return Buffer.compare(Buffer.from(left), Buffer.from(right));
  return left < right ? -1 : 1;
};

export function messageFacets(input: FacetInput) {
  const { where, values } = messageWhere(input);
  const limit = Math.max(5, Math.min(input.limit || 25, 50));
  const timestamp = Math.floor(Date.now() / 1000);
  const ranges: Array<[string, number, number]> = [
    ["last_24_hours", timestamp - 86400, timestamp + 1],
    ["last_7_days", timestamp - 7 * 86400, timestamp - 86400],
    ["last_30_days", timestamp - 30 * 86400, timestamp - 7 * 86400],
    ["older", 0, timestamp - 30 * 86400],
  ];
  const age_buckets = ranges.map(([label]) => ({ label, count: 0 }));
  const accounts = new Map<string, { account: string; account_email: string; count: number }>();
  const senders = new Map<string, number>();
  const domains = new Map<string, number>();
  let total = 0;

  // One consistent read snapshot and one deduplication pass. Iterate only the
  // required headers, never message bodies or an array of the complete cache.
  for (const row of db
    .prepare(`SELECT account,account_email,sender,date_ts FROM canonical_messages messages${where}`)
    .iterate(...values) as Iterable<FacetRow>) {
    total++;
    const key = JSON.stringify([row.account, row.account_email]);
    const account = accounts.get(key) || { account: row.account, account_email: row.account_email, count: 0 };
    account.count++;
    accounts.set(key, account);
    senders.set(row.sender, (senders.get(row.sender) || 0) + 1);
    const domain = row.sender.match(/@([A-Za-z0-9.-]+)/)?.[1]?.toLowerCase() || "unknown";
    domains.set(domain, (domains.get(domain) || 0) + 1);
    for (let index = 0; index < ranges.length; index++) {
      const [, lower, upper] = ranges[index];
      if (row.date_ts >= lower && row.date_ts < upper) age_buckets[index].count++;
    }
  }

  return {
    total,
    filters: input,
    accounts: [...accounts.values()].sort(
      (a, b) =>
        b.count - a.count || binaryCompare(a.account, b.account) || binaryCompare(a.account_email, b.account_email),
    ),
    top_senders: [...senders]
      .sort((a, b) => b[1] - a[1] || binaryCompare(a[0], b[0]))
      .slice(0, limit)
      .map(([name, count]) => ({ name, count })),
    top_domains: [...domains]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([name, count]) => ({ name, count })),
    age_buckets,
  };
}
