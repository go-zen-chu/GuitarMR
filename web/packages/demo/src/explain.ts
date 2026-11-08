/**
 * The play view's explanation panel: the key the degrees count from, and
 * the song's most telling progressions, each with what it does and where
 * it is played. Tapping a progression (or one of its places) marks those
 * measures in the view; player.ts wires the taps through `data-pick`.
 * The panel folds away, leaving the degrees in the measures.
 */

import { type Key, type Progression, keyName } from "@guitarmr/gts";
import { prettyChord } from "./player.ts";

/** Progressions shown; the rest are the less telling ones. */
export const SHOWN_PROGRESSIONS = 5;
/** Places listed per progression before "ほか n か所". */
const SHOWN_PLACES = 8;
/** Different degree spellings shown in a progression's heading (secondary dominants differ by target). */
const SHOWN_SPELLINGS = 3;

/** "Ⅱm7-5 → Ⅴ7 → Ⅰm" of each place, without repeats. */
function spellings(progression: Progression): string[] {
  return [...new Set(progression.occurrences.map((o) => o.degrees.join(" → ")))];
}

/** The panel's content for a song in `key`, with a capo of `capo` frets. */
export function explanation(key: Key, list: readonly Progression[], capo: number): HTMLElement {
  const panel = document.createElement("details");
  panel.open = true;
  const heading = document.createElement("summary");
  heading.textContent = "コード進行の解説";
  const about = document.createElement("p");
  about.className = "notes-key";
  const source = key.estimated ? "コードから推定" : "楽譜の表記";
  const sounding = capo ? `・カポ${capo}で実音は ${prettyChord(keyName(key.tonic + capo, key.minor))}` : "";
  about.textContent = `Key ${prettyChord(key.name)}（${source}）の主音を Ⅰ とした度数で表示${sounding}`;
  if (!list.length) {
    const none = document.createElement("p");
    none.className = "notes-none";
    none.textContent = "代表的なコード進行は見つかりませんでした。各小節の度数を手がかりにしてください。";
    panel.append(heading, about, none);
    return panel;
  }
  const items = document.createElement("ol");
  items.className = "notes-list";
  list.slice(0, SHOWN_PROGRESSIONS).forEach((progression, i) => {
    const item = document.createElement("li");
    const head = document.createElement("button");
    head.type = "button";
    head.className = "note-head";
    head.dataset.pick = String(i);
    const name = document.createElement("strong");
    name.textContent = progression.name;
    const degrees = document.createElement("span");
    degrees.className = "note-degrees";
    const all = spellings(progression);
    degrees.textContent = all.slice(0, SHOWN_SPELLINGS).join(" / ") + (all.length > SHOWN_SPELLINGS ? " …" : "");
    head.append(name, degrees);
    const text = document.createElement("p");
    text.className = "note-text";
    text.textContent = progression.description;
    const places = document.createElement("p");
    places.className = "note-places";
    const example = progression.occurrences[0]!;
    places.append(`例: ${example.chords.map(prettyChord).join(" → ")}`);
    progression.occurrences.slice(0, SHOWN_PLACES).forEach((o, n) => {
      const place = document.createElement("button");
      place.type = "button";
      place.className = "note-place";
      place.dataset.pick = String(i);
      place.dataset.place = String(n);
      place.textContent = `${o.steps[0]! + 1}小節`;
      place.setAttribute("aria-label", `${o.steps[0]! + 1}小節目 ${o.chords.join(" ")}`);
      places.append(place);
    });
    const rest = progression.occurrences.length - SHOWN_PLACES;
    if (rest > 0) places.append(`ほか ${rest} か所`);
    item.append(head, text, places);
    items.append(item);
  });
  panel.append(heading, about, items);
  return panel;
}
