export type RequestPolicy = { hosts: Set<string>; origins: Set<string> };
export function createRequestPolicy(env?: Record<string, string | undefined>): RequestPolicy;
export function requestSecurityError(
  headers: Pick<Headers, "get">,
  policy: RequestPolicy,
  websocket?: boolean,
  method?: string,
): string | null;
