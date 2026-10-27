/**
 * The tab layer of one measure as a line of text, for typing it in the
 * review editor and for Claude to answer in (short, and checked by the
 * same parser). One token per beat, in time order, separated by spaces:
 *
 *   <length>:<content>[!<marks>]
 *
 * - length: 1 2 4 8 16 32 64 (4 = quarter), then "." or ".." for dots,
 *   then "t" for a triplet (3 in the time of 2) or "t5", "t6", ... (n in
 *   the time of the power of two below n).
 * - content: "r" (rest), "/" (a slash or strum on the current chord), or
 *   notes joined by "+", each <string>-<fret>: string 1 (high E) to 6,
 *   fret 0 to 24 as written, "x" for a dead note, "(3)" for a ghost note.
 *   A note starts with "~" when tied from the previous note, and may end
 *   with: h (hammer-on), p (pull-off), s (slide) into the next note,
 *   b<n> (bend by n semitones), v (vibrato), * (natural harmonic),
 *   m (palm mute), l (let ring), > (accent).
 * - marks: d (down stroke), u (up stroke), f (fermata).
 *
 *   8:6-0+4-2!d 8:r 4:/!d 8t:1-0 8t:1-2h 8t:1-3 4:~1-3v
 *
 * Fingerings and arpeggio brushes have no notation; parseTabLine keeps
 * them from the previous beats where a beat is unchanged.
 */

import type { Beat } from "./types.generated.ts";

type Note = NonNullable<Beat["notes"]>[number];
type Value = Beat["duration"]["value"];

const NOTE_SUFFIX: [string, (n: Note) => boolean][] = [
  ["h", (n) => n.slur === "hammer-on"],
  ["p", (n) => n.slur === "pull-off"],
  ["s", (n) => n.slur === "slide"],
  ["v", (n) => n.vibrato === true],
  ["*", (n) => n.harmonic === "natural"],
  ["m", (n) => n.palmMute === true],
  ["l", (n) => n.letRing === true],
  [">", (n) => n.accent === true],
];

function formatLength(d: Beat["duration"]): string {
  let text = `${d.value}${".".repeat(d.dots ?? 0)}`;
  if (d.tuplet) text += d.tuplet[0] === 3 && d.tuplet[1] === 2 ? "t" : `t${d.tuplet[0]}`;
  return text;
}

function formatNote(n: Note): string {
  const fret = n.dead ? "x" : n.ghost ? `(${n.fret})` : String(n.fret);
  let text = `${n.tie ? "~" : ""}${n.string}-${fret}`;
  for (const [suffix, has] of NOTE_SUFFIX) {
    if (has(n)) text += suffix;
    if (suffix === "s" && n.bend) text += `b${n.bend}`;
  }
  return text;
}

/** One measure's beats as a tab line. */
export function formatTabLine(beats: readonly Beat[] = []): string {
  return beats
    .map((b) => {
      const content = b.rest ? "r" : b.slash ? "/" : (b.notes ?? []).map(formatNote).join("+");
      const marks = `${b.stroke === "down" ? "d" : b.stroke === "up" ? "u" : ""}${b.fermata ? "f" : ""}`;
      return `${formatLength(b.duration)}:${content}${marks ? `!${marks}` : ""}`;
    })
    .join(" ");
}

const TAB_LENGTH = /^(1|2|4|8|16|32|64)(\.{0,2})(?:t(\d*))?$/;
const TAB_NOTE = /^(~?)([1-6])-(x|\(\d{1,2}\)|\d{1,2})((?:[hpsvml>*]|b\d+(?:\.\d+)?)*)$/;

function parseNote(text: string): Note | string {
  const m = TAB_NOTE.exec(text);
  if (!m) return `「${text}」は 弦-フレット ではありません`;
  const [, tie, string, fretText, suffixes] = m as unknown as [string, string, string, string, string];
  const note: Note = { string: Number(string) };
  if (fretText === "x") note.dead = true;
  else {
    const fret = Number(fretText.replace(/[()]/g, ""));
    if (fret > 24) return `「${text}」: フレットは 0〜24 です`;
    note.fret = fret;
    if (fretText.startsWith("(")) note.ghost = true;
  }
  if (tie) note.tie = true;
  for (const [, flag, bend] of suffixes.matchAll(/([hpsvml>*])|b(\d+(?:\.\d+)?)/g)) {
    if (bend !== undefined) {
      if (Number(bend) <= 0) return `「${text}」: ベンドは 0 より大きくします`;
      note.bend = Number(bend);
    } else if (flag === "h" || flag === "p" || flag === "s") {
      note.slur = flag === "h" ? "hammer-on" : flag === "p" ? "pull-off" : "slide";
    } else if (flag === "v") note.vibrato = true;
    else if (flag === "*") note.harmonic = "natural";
    else if (flag === "m") note.palmMute = true;
    else if (flag === "l") note.letRing = true;
    else if (flag === ">") note.accent = true;
  }
  return note;
}

/** One token as a beat, or why it is not one. */
export function parseTabToken(token: string): Beat | string {
  const [head = "", ...rest] = token.split(":");
  const body = rest.join(":");
  const length = TAB_LENGTH.exec(head);
  if (!length || !body) return `「${token}」は 長さ:内容 ではありません（例 8:6-0）`;
  const [, value, dots, tuplet] = length as unknown as [string, string, string, string | undefined];
  const duration: Beat["duration"] = { value: Number(value) as Value };
  if (dots) duration.dots = dots.length;
  if (tuplet !== undefined) {
    const n = tuplet === "" ? 3 : Number(tuplet);
    if (n < 2 || n > 16 || (n & (n - 1)) === 0) return `「${token}」: 連符は t（3連）か t5 などです`;
    duration.tuplet = [n, 2 ** Math.floor(Math.log2(n))];
  }
  const [content = "", marks = "", extra] = body.split("!");
  if (extra !== undefined || !/^[duf]*$/.test(marks) || (marks.includes("d") && marks.includes("u"))) {
    return `「${token}」: ! の後は d（ダウン）u（アップ）f（フェルマータ）です`;
  }
  const beat: Beat = { duration } as Beat;
  if (content === "r") beat.rest = true;
  else if (content === "/") beat.slash = true;
  else {
    const notes: Note[] = [];
    for (const part of content.split("+")) {
      const note = parseNote(part);
      if (typeof note === "string") return note;
      notes.push(note);
    }
    beat.notes = notes;
  }
  if (marks.includes("d")) beat.stroke = "down";
  if (marks.includes("u")) beat.stroke = "up";
  if (marks.includes("f")) beat.fermata = true;
  return beat;
}

const sameNotes = (a: Beat, b: Beat): boolean =>
  formatTabLine([{ ...a, notes: a.notes?.map(({ finger: _, ...n }) => n) } as Beat]) ===
  formatTabLine([{ ...b, notes: b.notes?.map(({ finger: _, ...n }) => n) } as Beat]);

/**
 * Inverse of formatTabLine. Tokens that are not a beat are returned in
 * `invalid` with the reason. Where a beat equals the one at the same place
 * in `previous`, the previous beat is kept as is (its fingering and brush,
 * which the line cannot express, survive an edit elsewhere in the measure).
 */
export function parseTabLine(text: string, previous: readonly Beat[] = []): { beats: Beat[]; invalid: string[] } {
  const beats: Beat[] = [];
  const invalid: string[] = [];
  const tokens = text.replace(/　/g, " ").trim().split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    const beat = parseTabToken(token);
    if (typeof beat === "string") {
      invalid.push(beat);
      continue;
    }
    const old = previous[beats.length];
    beats.push(old && sameNotes(old, beat) ? structuredClone(old) : beat);
  }
  return { beats, invalid };
}
