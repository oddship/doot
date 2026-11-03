export function createCacheBroadcaster(
  send: (event: any) => void,
  delay?: number,
): ((event: any) => void) & { close: () => void };
