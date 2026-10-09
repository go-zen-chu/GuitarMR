/** Web Worker entry: one DetectRequest in, one DetectResult out. */

import { type DetectRequest, detect } from "./preview.ts";

const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<DetectRequest>) => void;
  postMessage(message: unknown, transfer: Transferable[]): void;
};

scope.onmessage = (event) => {
  try {
    const result = detect(event.data);
    scope.postMessage(result, result.preview ? [result.preview.data.buffer as ArrayBuffer] : []);
  } catch (e) {
    scope.postMessage({ index: event.data.index, error: String((e as Error).stack ?? e) }, []);
  }
};
