/** The local dev server: serves the page, reloads open tabs on rebuild, shows build errors. */

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { type DevServer, parseOptions, startDevServer } from "../scripts/dev.ts";

/** A dev server on a free port whose page is whatever `render` returns. */
async function serve(render: () => string): Promise<DevServer> {
  return startDevServer({ host: "127.0.0.1", port: 0, render });
}

/** The first server-sent event named `name` on the reload stream. */
async function nextEvent(url: string, name: string, signal: AbortSignal): Promise<void> {
  const res = await fetch(new URL("/__dev/reload", url), { signal });
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let text = "";
  while (!text.includes(`event: ${name}`)) {
    const { value, done } = await reader.read();
    if (done) throw new Error("stream ended");
    text += value;
  }
}

describe("dev server", () => {
  const servers: DevServer[] = [];
  after(() => Promise.all(servers.map((s) => s.close())));

  it("If the page is requested it should serve it with a viewport meta and the live reload script", async () => {
    const server = await serve(() => "<title>t</title><p>hello</p>");
    servers.push(server);
    const html = await (await fetch(server.url)).text();
    assert.match(html, /^<meta name="viewport"/);
    assert.match(html, /<p>hello<\/p>/);
    assert.match(html, /new EventSource\("\/__dev\/reload"\)/);
    assert.equal((await fetch(new URL("/missing", server.url))).status, 404);
  });

  it("If the sources change it should serve the new page and tell open tabs to reload", async () => {
    let body = "v1";
    const server = await serve(() => body);
    servers.push(server);
    const abort = new AbortController();
    const reloaded = nextEvent(server.url, "reload", abort.signal);
    await new Promise((r) => setTimeout(r, 50));
    body = "v2";
    server.rebuild();
    await reloaded;
    abort.abort();
    assert.match(await (await fetch(server.url)).text(), /v2/);
  });

  it("If the build fails it should show the error escaped instead of the page", async () => {
    const server = await serve(() => {
      throw new Error("bad <syntax>");
    });
    servers.push(server);
    const html = await (await fetch(server.url)).text();
    assert.match(html, /bad &lt;syntax&gt;/);
    assert.match(html, /__dev\/reload/);
  });
});

describe("dev options", () => {
  it("If no options are given it should listen on localhost:5173 with samples", () => {
    assert.deepEqual(parseOptions([]), { host: "127.0.0.1", port: 5173, withSamples: true });
  });

  it("If a port outside 0-65535 or not a number is given it should refuse it", () => {
    for (const port of ["70000", "-1", "abc", "80.5"]) assert.throws(() => parseOptions(["--port", port]), /--port/);
  });

  it("If --no-samples is given it should skip the samples", () => {
    assert.equal(parseOptions(["--no-samples"]).withSamples, false);
  });
});
