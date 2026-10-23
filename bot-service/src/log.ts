/** Log text only. Error objects can carry a request URL with a bot token or API key. */
export function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "request failed";
  return message
    .replace(/bot\d+:[A-Za-z0-9_-]+/gi, "bot[redacted]")
    .replace(/([?&]api_key=)[^&\s]+/gi, "$1[redacted]")
    .replace(/(x-api-key\s*[:=]\s*)\S+/gi, "$1[redacted]")
    .slice(0, 300);
}
