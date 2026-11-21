/**
 * Asking Claude again when a request fails in a way that often passes on
 * its own (a dropped connection, the service briefly overloaded), so one
 * such failure does not end the whole reading.
 */

import type { Sample } from "./reader.ts";

/** Failure codes worth asking again for; a reached usage limit or a refused key are not. */
export const TRANSIENT_CODES = new Set(["upstream_error", "overloaded"]);
/** Pauses before each new try. */
export const RETRY_DELAYS_MS = [2_000, 6_000];

/** Resolves after `ms`, or rejects as cancelled when `signal` aborts first. */
export function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cancelled = () => {
      clearTimeout(timer);
      reject({ code: "cancelled", message: "cancelled" });
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", cancelled);
      resolve();
    }, ms);
    if (signal?.aborted) cancelled();
    else signal?.addEventListener("abort", cancelled, { once: true });
  });
}

/** `sample` asking again after each of `delays` when a request fails with a transient code. */
export function withRetries(sample: Sample, delays: number[] = RETRY_DELAYS_MS, wait = pause): Sample {
  return {
    limits: () => sample.limits(),
    ...(sample.spent ? { spent: sample.spent.bind(sample) } : {}),
    async json<T>(input: string, options?: { images?: Blob[]; signal?: AbortSignal }): Promise<T> {
      for (let attempt = 0; ; attempt++) {
        try {
          return await sample.json<T>(input, options);
        } catch (e) {
          const code = (e as { code?: string }).code ?? "upstream_error";
          const delay = delays[attempt];
          if (delay === undefined || !TRANSIENT_CODES.has(code)) throw e;
          // A stopped reading ends here as cancelled, also when it stopped during the failed request.
          await wait(delay, options?.signal);
        }
      }
    },
  };
}
