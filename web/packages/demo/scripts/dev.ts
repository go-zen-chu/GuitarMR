/**
 * Serve the demo page on a local URL while editing: the page is rebuilt from
 * the sources whenever one of them changes, and open tabs reload by
 * themselves (server-sent events). The sample PDFs are generated once at
 * start; restart after changing @guitarmr/samples.
 *
 *   pnpm --filter @guitarmr/demo dev [--port 5173] [--host 127.0.0.1] [--no-samples]
 */

import { watch } from "node:fs";
import { type ServerResponse, createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { loadSamples, renderPage } from "./build.ts";

/** Source folders whose changes rebuild the page. */
export const WATCHED = ["../../gts/src/", "../../layoutscan/src/", "../../extract/src/", "../src/", "../../../../schemas/examples/"];

const RELOAD_PATH = "/__dev/reload";
// The Artifact host adds the document head; served on its own the page needs the viewport meta.
const VIEWPORT = '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">';
const LIVE_RELOAD = `<script>new EventSource("${RELOAD_PATH}").addEventListener("reload", () => location.reload());</script>`;

export interface DevServerOptions {
  host: string;
  port: number;
  /** The current page; a thrown error is shown in the browser instead. */
  render: () => string;
}

export interface DevServer {
  url: string;
  /** Render the page again and reload every open tab. */
  rebuild(): void;
  close(): Promise<void>;
}

/** The page as served locally: viewport meta first, live reload last. */
export function withDevExtras(html: string): string {
  return `${VIEWPORT}\n${html}\n${LIVE_RELOAD}\n`;
}

/** A page showing why the build failed; it reloads once the sources are fixed. */
export function errorPage(error: unknown): string {
  const message = String(error instanceof Error ? (error.stack ?? error.message) : error);
  const escaped = message.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
  return `<title>build failed</title><pre style="white-space:pre-wrap;color:#b00">${escaped}</pre>`;
}

/** Serve the rendered page and notify open tabs on every rebuild. */
export async function startDevServer({ host, port, render }: DevServerOptions): Promise<DevServer> {
  const clients = new Set<ServerResponse>();
  const renderSafely = () => {
    try {
      return withDevExtras(render());
    } catch (error) {
      process.stderr.write(`WARN build failed: ${error instanceof Error ? error.message : error}\n`);
      return withDevExtras(errorPage(error));
    }
  };
  let page = renderSafely();

  const server = createServer((req, res) => {
    if (req.url === RELOAD_PATH) {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      res.write(": connected\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    if (req.method !== "GET" || (req.url !== "/" && !req.url?.startsWith("/?"))) {
      res.writeHead(404, { "content-type": "text/plain" }).end("not found");
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(page);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  const boundPort = typeof address === "object" && address ? address.port : port;

  return {
    url: `http://${host.includes(":") ? `[${host}]` : host}:${boundPort}/`,
    rebuild() {
      page = renderSafely();
      for (const res of clients) res.write("event: reload\ndata: \n\n");
    },
    close() {
      for (const res of clients) res.end();
      clients.clear();
      return new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    },
  };
}

/** Call `onChange` once per burst of file events under the given folders. */
export function watchSources(folders: URL[], onChange: (file: string) => void, debounceMs = 100): () => void {
  let timer: NodeJS.Timeout | undefined;
  let last = "";
  const watchers = folders.map((folder) =>
    watch(folder, { recursive: true }, (_event, file) => {
      last = `${fileURLToPath(folder)}${file ?? ""}`;
      clearTimeout(timer);
      timer = setTimeout(() => onChange(last), debounceMs);
    }),
  );
  return () => {
    clearTimeout(timer);
    for (const w of watchers) w.close();
  };
}

/** Command-line options, validated. */
export function parseOptions(args: string[]): { host: string; port: number; withSamples: boolean } {
  const { values } = parseArgs({
    args,
    options: {
      host: { type: "string", default: "127.0.0.1" },
      port: { type: "string", default: "5173" },
      "no-samples": { type: "boolean", default: false },
    },
  });
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`--port must be an integer from 0 to 65535, got "${values.port}"`);
  if (!values.host) throw new Error("--host must not be empty");
  return { host: values.host, port, withSamples: !values["no-samples"] };
}

// Compared as paths: the URL form percent-encodes non-ASCII directory names.
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const { host, port, withSamples } = parseOptions(process.argv.slice(2));
  const samples = await loadSamples(withSamples);
  const server = await startDevServer({ host, port, render: () => renderPage(samples) });
  watchSources(
    WATCHED.map((dir) => new URL(dir, import.meta.url)),
    (file) => {
      server.rebuild();
      process.stderr.write(`INFO rebuilt after ${file}\n`);
    },
  );
  process.stderr.write(`INFO serving ${server.url} (rebuilds on save, Ctrl+C to stop)\n`);
}
