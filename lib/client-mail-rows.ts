type MailKey = { account: string; folder: string; uid: string };
const key = (row: MailKey) => JSON.stringify([row.account, row.folder, row.uid]);

// Preserve unchanged header identities across refreshes so memoized rows can
// skip rendering. Never reuse changed flags, body-cache state, or other fields.
export function reuseMailRows<T extends MailKey>(previous: T[], next: T[]): T[] {
  const existing = new Map(previous.map((row) => [key(row), row]));
  return next.map((row) => {
    const old = existing.get(key(row));
    const fields = Object.keys(row) as Array<keyof T>;
    return old &&
      Object.keys(old).length === fields.length &&
      fields.every((field) => Object.is(old[field], row[field]))
      ? old
      : row;
  });
}
