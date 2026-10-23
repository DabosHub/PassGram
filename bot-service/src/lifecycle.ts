export function createShutdown(): AbortController {
  const controller = new AbortController();
  const request = () => controller.abort();
  process.once("SIGINT", request);
  process.once("SIGTERM", request);
  return controller;
}

export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
