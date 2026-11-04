/** The page's screens in the URL hash. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type Route, parentRoute, parseRoute, routeHash } from "../src/router.ts";

const ID = "0123456789abcdef".repeat(4);

describe("parseRoute", () => {
  const tests: { name: string; hash: string; want: Route }[] = [
    { name: "If the hash is empty it should be the score list", hash: "", want: { view: "library" } },
    { name: "If the hash is #/ it should be the score list", hash: "#/", want: { view: "library" } },
    { name: "If the hash is #/scan it should be scanning", hash: "#/scan", want: { view: "scan" } },
    { name: "If the hash is #/settings it should be the settings", hash: "#/settings", want: { view: "settings" } },
    { name: "If the hash names a score by its SHA-256 it should be that score", hash: `#/score/${ID}`, want: { view: "score", id: ID } },
    { name: "If the score id is not a SHA-256 it should be the score list", hash: "#/score/abc", want: { view: "library" } },
    { name: "If the score id is in capitals it should be the score list", hash: `#/score/${ID.toUpperCase()}`, want: { view: "library" } },
    { name: "If the score has no id it should be the score list", hash: "#/score", want: { view: "library" } },
    { name: "If a screen has more parts than it takes it should be the score list", hash: "#/scan/x", want: { view: "library" } },
    { name: "If the screen is unknown it should be the score list", hash: "#/nowhere", want: { view: "library" } },
  ];
  for (const tt of tests) {
    it(tt.name, () => assert.deepEqual(parseRoute(tt.hash), tt.want));
  }
});

describe("routeHash", () => {
  const routes: Route[] = [{ view: "library" }, { view: "scan" }, { view: "settings" }, { view: "score", id: ID }];
  for (const route of routes) {
    it(`If the route is ${route.view} its hash should parse back to it`, () => assert.deepEqual(parseRoute(routeHash(route)), route));
  }
});

describe("parentRoute", () => {
  it("If on the score list back should leave the page", () => assert.equal(parentRoute({ view: "library" }), null));
  for (const route of [{ view: "scan" }, { view: "settings" }, { view: "score", id: ID }] as Route[]) {
    it(`If on ${route.view} back should go to the score list`, () => assert.deepEqual(parentRoute(route), { view: "library" }));
  }
});
