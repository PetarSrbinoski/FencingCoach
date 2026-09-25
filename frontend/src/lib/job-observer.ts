/** Owns one observation, including submission/loading and subsequent polling.
 * Stopping observation never cancels the server's generation job.
 */
export function createJobObserver(intervalMs = 1200) {
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function stop() {
    generation += 1;
    clearTimeout(timer);
    timer = undefined;
  }

  function begin() {
    stop();
    const current = generation;
    const isCurrent = () => current === generation;

    function poll<T extends { status: string }>(
      request: () => Promise<T>,
      onResult: (result: T) => void,
      onError: (error: unknown) => void,
    ) {
      async function tick() {
        if (!isCurrent()) return;
        try {
          const result = await request();
          if (!isCurrent()) return;
          if (result.status === "pending") {
            timer = setTimeout(tick, intervalMs);
          } else {
            onResult(result);
          }
        } catch (error) {
          if (isCurrent()) onError(error);
        }
      }
      if (isCurrent()) timer = setTimeout(tick, intervalMs);
    }

    return { isCurrent, poll };
  }

  return { begin, stop };
}

export type JobObservation = ReturnType<ReturnType<typeof createJobObserver>["begin"]>;
