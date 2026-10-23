export type IndexerHealth = "starting" | "ok" | "failed";

let indexer: IndexerHealth = "starting";

/** Remember whether the latest indexer pass finished. A quiet chain still counts as finished. */
export function noteIndexerTick(succeeded: boolean): void {
  indexer = succeeded ? "ok" : "failed";
}

export function healthReport(): { status: number; body: { ok: boolean; indexer: IndexerHealth } } {
  if (indexer === "failed") return { status: 503, body: { ok: false, indexer } };
  return { status: 200, body: { ok: true, indexer } };
}
