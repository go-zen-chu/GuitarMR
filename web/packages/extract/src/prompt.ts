/**
 * The instruction sent with the system crops of one page. Claude sees only
 * this text and the images, so it states what the images are, what to read
 * and the exact JSON to answer with (see reading.ts for how it is checked).
 */

import type { SystemCrop } from "./crops.ts";

export interface PromptOptions {
  /**
   * Ask for the title, key, capo and tempo written at the top of the score;
   * the first image is then the top of the page, before the systems.
   */
  header: boolean;
}

export function pagePrompt(crops: readonly SystemCrop[], options: PromptOptions): string {
  const offset = options.header ? 2 : 1;
  const systems = [
    ...(options.header ? ["- Image 1: the top of the page, above the first system (no measures)"] : []),
    ...crops.map((c, i) => `- Image ${i + offset}: measures ${c.measures.map((m) => m.id).join(", ")} (left to right)`),
  ].join("\n");
  const header = options.header
    ? `
Also read the header written at the top of the page (image 1) and above the
first system into "header": title, artist, key (as written, e.g. "Am"), capo
(number), tempo (quarter notes per minute) and timeSignature (e.g. "4/4").
Leave out what is not written.`
    : "";
  return `You are digitizing a handwritten guitar score (a scan). The images
are crops of one page, one image per system (a line of music: an optional
5-line staff above a 6-line TAB staff, with chord names above it). A white
strip was added on top of each image: in it, magenta ticks mark where each
measure starts and ends, and a magenta tag with the measure id sits above
the measure's left end. The strip is not part of the score.

${systems}

For every listed measure, read what is written in or above it:
- chords: the chord names as written (capo shapes), e.g. "Am", "G/B",
  "F#m7-5", "Esus4", "N.C.". beat = the 1-based beat where the chord
  starts, estimated from its horizontal position (4/4: left edge = 1,
  middle = 3); use 2.5 etc. for off-beats. Empty list if there is none.
  A chord written once applies until the next one: do not repeat it in
  following measures unless it is written there again.
- section: a rehearsal mark starting at this measure (a boxed letter like
  "A", "B", or a word like "Intro", "Verse", "サビ"), else leave it out.
- barStart: "repeat-start" for a repeat sign (thick line + two dots) at the
  start. barEnd: "repeat-end" for a repeat sign at the end, "double" for a
  thin double bar line, "final" for a thin + thick final bar line; leave
  it out for an ordinary bar line. repeatTimes: total plays when written
  at a repeat-end (e.g. "x3", "3回" = 3).
- volta: ending numbers of a 1st/2nd ending bracket over the measure, e.g. [1].
- navigation: any of "segno", "coda" (the coda sign starting a coda),
  "to-coda", "ds", "ds-al-coda", "dc", "dc-al-coda", "fine".
- simile: 1 for a one-measure repeat sign (%), 2 for a two-measure one;
  then leave chords empty.
- timeSignature: only if a time signature is written at this measure.
- confidence: 0 to 1, how sure you are of this measure as a whole.
- note: a short note on anything unclear (in the language of the score),
  else leave it out.
Colored-pen notes from a teacher are comments: ignore them unless they
are one of the signs above. Do not guess content that is not written.${header}

Reply with only JSON, no prose, in this shape (one entry per listed id, in
order; leave out fields that do not apply):
{${options.header ? `"header": {"title": "...", "key": "Am", "capo": 2, "tempo": 72, "timeSignature": "4/4"}, ` : ""}"measures": [
  {"id": "m1", "chords": [{"symbol": "Am", "beat": 1}, {"symbol": "E7", "beat": 3}], "section": "A", "barStart": "repeat-start", "confidence": 0.9},
  {"id": "m2", "chords": [], "simile": 1, "confidence": 0.8, "note": "..."}
]}`;
}
