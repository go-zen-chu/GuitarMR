/**
 * The page's screens: the score list (the first view), scanning, one score
 * and the settings. The screen on show is kept in the URL hash, so the
 * browser's back goes back a screen and a reload stays on it; the Android
 * app's back button asks the page (see `back` in app.ts).
 */

export type Route = { view: "library" } | { view: "scan" } | { view: "settings" } | { view: "score"; id: string };

/** A score is named by the SHA-256 of its source, as in the gts `source.sha256`. */
const SCORE_ID = /^[0-9a-f]{64}$/;

/** The route a URL hash names; anything else is the score list. */
export function parseRoute(hash: string): Route {
  const [view, id, ...rest] = hash.replace(/^#\/?/, "").split("/");
  if (rest.length) return { view: "library" };
  if ((view === "scan" || view === "settings") && id === undefined) return { view };
  if (view === "score" && id !== undefined && SCORE_ID.test(id)) return { view, id };
  return { view: "library" };
}

/** The URL hash of a route. */
export function routeHash(route: Route): string {
  if (route.view === "library") return "#/";
  if (route.view === "score") return `#/score/${route.id}`;
  return `#/${route.view}`;
}

/** The screen back goes to from a route; null on the score list, where back leaves the page. */
export function parentRoute(route: Route): Route | null {
  return route.view === "library" ? null : { view: "library" };
}
