/**
 * The page's host inside the Android app (android/): stands in for the
 * claude.ai runtime as `globalThis.claude`, so the page runs unchanged.
 * `sample` reads with the Claude API on the user's own key, kept by the app;
 * `downloads` saves through Android's file picker. The app injects this
 * script before the page script; calls into the app finish asynchronously,
 * when the app calls back `settle`.
 */

import { type SampleError, createApiSample } from "./api-sample.ts";
import type { Sample } from "./reader.ts";

/** What the app exposes to the page (a WebView JavaScript interface; strings only). */
export interface AndroidBridge {
  apiKey(): string;
  model(): string;
  /** Ask the user for a key; settles with the key, or "" when they cancel. */
  askApiKey(callId: string): void;
  /** Drop a key the API rejected, so the next reading asks again. */
  forgetApiKey(): void;
  /** Let the user pick where to save; settles with "saved" or fails with `declined`. */
  save(callId: string, filename: string, mimeType: string, data: string): void;
}

export interface AndroidHost {
  use(name: string): Promise<unknown>;
  /** Called by the app when the call `callId` has finished. */
  settle(callId: string, error: string | null, value: string): void;
}

/** The MIME type the save picker is opened with. */
export function mimeTypeOf(filename: string): string {
  if (filename.endsWith(".json")) return "application/json";
  if (filename.endsWith(".jsonl")) return "application/jsonl";
  return "application/octet-stream";
}

/** The host for one page, over the app's bridge. */
export function createAndroidHost(bridge: AndroidBridge, fetchImpl?: typeof fetch): AndroidHost {
  const calls = new Map<string, { resolve(value: string): void; reject(error: SampleError): void }>();
  let next = 0;
  const call = (start: (callId: string) => void) =>
    new Promise<string>((resolve, reject) => {
      const callId = `c${++next}`;
      calls.set(callId, { resolve, reject });
      start(callId);
    });

  const apiSample = createApiSample({
    apiKey: async () => bridge.apiKey() || (await call((id) => bridge.askApiKey(id))),
    model: bridge.model(),
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
  const sample: Sample = {
    limits: () => apiSample.limits(),
    async json<T>(input: string, options?: { images?: Blob[]; signal?: AbortSignal }): Promise<T> {
      try {
        return await apiSample.json<T>(input, options);
      } catch (e) {
        if ((e as SampleError).code === "invalid_api_key") bridge.forgetApiKey();
        throw e;
      }
    },
  };
  const downloads = {
    save: async (request: { filename: string; data: string }) => ({
      status: await call((id) => bridge.save(id, request.filename, mimeTypeOf(request.filename), request.data)),
    }),
  };

  return {
    use: async (name) => (name === "sample" ? sample : name === "downloads" ? downloads : null),
    settle(callId, error, value) {
      const pending = calls.get(callId);
      calls.delete(callId);
      if (error) pending?.reject({ code: error, message: error });
      else pending?.resolve(value);
    },
  };
}

/** Install the host when the page runs inside the app. */
export function installAndroidHost(): void {
  const scope = globalThis as { GuitarMRAndroid?: AndroidBridge; claude?: AndroidHost };
  if (scope.GuitarMRAndroid) scope.claude = createAndroidHost(scope.GuitarMRAndroid);
}
