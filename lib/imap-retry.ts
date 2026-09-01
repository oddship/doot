const TRANSIENT_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "EPIPE", "ETIMEDOUT", "ESOCKETTIMEDOUT", "EAI_AGAIN"]);
const TRANSIENT_MESSAGE =
  /temporar(?:y|ily)|try again|server busy|rate.?limit|throttl|unavailable|connection (?:closed|lost|reset)|socket timeout|timed out/i;
const AUTH_FAILURE = /auth(?:entication)?(?:failed| failure)|invalid credentials|login failed/i;

export function isTransientImapError(error: unknown) {
  const value = error as
    | { code?: string; serverResponseCode?: string; message?: string; response?: string }
    | undefined;
  const message = [value?.message, value?.response].filter(Boolean).join(" ");
  if (AUTH_FAILURE.test(message) || value?.serverResponseCode === "AUTHENTICATIONFAILED") return false;
  return TRANSIENT_CODES.has(String(value?.code || "").toUpperCase()) || TRANSIENT_MESSAGE.test(message);
}

export async function withImapRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: { attempts?: number; baseDelayMs?: number; onRetry?: (error: unknown, attempt: number) => void } = {},
) {
  const attempts = Math.max(1, Math.min(options.attempts || 3, 5));
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 300);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (attempt === attempts || !isTransientImapError(error)) throw error;
      options.onRetry?.(error, attempt);
      const delay = baseDelayMs * 2 ** (attempt - 1);
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error("IMAP retry loop ended unexpectedly");
}
