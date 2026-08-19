export function planMailboxSync(eligibleUids: number[], cachedUids: Iterable<number>, targetSize: number) {
  const eligible = [...new Set(eligibleUids.filter(Number.isFinite))].sort((a, b) => a - b);
  const desired = eligible.slice(-Math.max(1, Math.min(targetSize, 10_000)));
  const cached = new Set(cachedUids);
  const cachedMax = Math.max(...cached, 0);
  const missing = desired.filter((uid) => !cached.has(uid));
  return {
    eligible,
    desired,
    missing,
    backfilled: missing.filter((uid) => uid <= cachedMax).length,
  };
}
