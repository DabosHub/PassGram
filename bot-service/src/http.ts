export const OUTBOUND_TIMEOUT_MS = 15_000;

/** Stops a quiet TCP connection from holding the indexer or the expiration cron. */
export function fetchWithTimeout(
  url: string | URL,
  init: RequestInit = {},
  timeoutMs = OUTBOUND_TIMEOUT_MS,
): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}
