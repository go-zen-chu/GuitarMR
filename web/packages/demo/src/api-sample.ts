/**
 * The reader's `Sample` over the Claude Messages API, called straight from
 * the page with the user's own API key (ADR-009: the browser calls the API
 * directly, nothing of ours in between). Used where the claude.ai runtime is
 * not there, such as the Android app. Errors carry the same codes as the
 * claude.ai sample capability, so the reader treats both alike.
 */

import type { Sample } from "./reader.ts";

export const API_URL = "https://api.anthropic.com/v1/messages";
export const DEFAULT_MODEL = "claude-opus-5-5";
/** Images per request; the API takes more, but one page of systems is far fewer. */
export const MAX_IMAGES = 20;
const MAX_TOKENS = 16000;

export interface ApiSampleOptions {
  /** The key for this request; empty when there is none, and the request fails as `invalid_api_key`. */
  apiKey(): Promise<string>;
  model?: string;
  fetch?: typeof fetch;
}

export interface SampleError {
  code: string;
  message: string;
}

const fail = (code: string, message: string): SampleError => ({ code, message });

/** Base64 of a blob, as the API's image source wants it. */
export async function base64Of(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** The JSON value in a reply that should be only JSON (code fences or stray prose around it tolerated). */
export function jsonOfReply(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1];
  for (const candidate of [text, fenced, text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)]) {
    if (!candidate?.trim()) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // try the next shape
    }
  }
  throw fail("invalid_json", "the reply is not JSON");
}

/** The sample error code for a failed API response. */
export function codeOfStatus(status: number, body: string): string {
  if (status === 401 || status === 403) return "invalid_api_key";
  if (status === 429) return "rate_limited";
  if (status === 413) return "prompt_too_large";
  if (status === 400 && /image/i.test(body)) return "image_rejected";
  if (status === 400 && /too long|too large|max_tokens/i.test(body)) return "prompt_too_large";
  return "upstream_error";
}

interface MessageResponse {
  stop_reason?: string;
  content?: { type: string; text?: string }[];
}

/** A `Sample` that asks Claude through the Messages API. */
export function createApiSample(options: ApiSampleOptions): Sample {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const model = options.model || DEFAULT_MODEL;
  return {
    limits: async () => ({ images: { maxCount: MAX_IMAGES } }),
    async json<T = unknown>(input: string, opts: { images?: Blob[]; signal?: AbortSignal } = {}): Promise<T> {
      const key = await options.apiKey();
      if (!key) throw fail("invalid_api_key", "no API key");
      const images = await Promise.all(
        (opts.images ?? []).map(async (blob) => ({
          type: "image",
          source: { type: "base64", media_type: blob.type || "image/jpeg", data: await base64Of(blob) },
        })),
      );
      let response: Response;
      try {
        response = await doFetch(API_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
            // External spec: required for CORS when the API is called from a page.
            "anthropic-dangerous-direct-browser-access": "true",
          },
          body: JSON.stringify({
            model,
            max_tokens: MAX_TOKENS,
            messages: [{ role: "user", content: [...images, { type: "text", text: input }] }],
          }),
          signal: opts.signal ?? null,
        });
      } catch (e) {
        if (opts.signal?.aborted) throw fail("cancelled", "cancelled");
        throw fail("upstream_error", (e as Error).message);
      }
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw fail(codeOfStatus(response.status, body), `${response.status} ${body.slice(0, 300)}`);
      }
      const message = (await response.json()) as MessageResponse;
      if (message.stop_reason === "refusal") throw fail("refused", "refused");
      const text = (message.content ?? []).flatMap((c) => (c.type === "text" && c.text ? [c.text] : [])).join("");
      return jsonOfReply(text) as T;
    },
  };
}
