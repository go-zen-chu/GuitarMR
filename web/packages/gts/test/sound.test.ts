import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  type GtsDocument,
  type Measure,
  chordIntervals,
  chordVoicing,
  midiOf,
  parseTabLine,
  playOrder,
  soundEvents,
  tabBeats,
  tuningOf,
} from "../src/index.ts";

const examples = new URL("../../../../schemas/examples/", import.meta.url);
const load = (name: string): GtsDocument => JSON.parse(readFileSync(new URL(`${name}.gts.json`, examples), "utf8"));

/** A one-section 4/4 score of these measures, no capo. */
function score(measures: Measure[], meta: Partial<GtsDocument["meta"]> = {}): GtsDocument {
  return {
    format: "gts",
    version: "0.1",
    meta: { title: "t", timeSignature: "4/4", ...meta },
    source: { file: "t.pdf", pages: [{ index: 0, rotation: 0 }] },
    sections: [{ measures: measures as [Measure, ...Measure[]] }],
  } as GtsDocument;
}
const eventsOf = (doc: GtsDocument) => soundEvents(doc, playOrder(doc));
const tab = (line: string) => parseTabLine(line).beats;

describe("midiOf / tuningOf", () => {
  it("If note names are given it should give their MIDI numbers", () => {
    assert.deepEqual(["E4", "B3", "C4", "Bb3", "F#2", "x"].map(midiOf), [64, 59, 60, 58, 42, null]);
  });

  it("If the score writes no tuning (or a broken one) it should use standard tuning", () => {
    assert.deepEqual(tuningOf(score([{}])), [64, 59, 55, 50, 45, 40]);
    assert.deepEqual(tuningOf(score([{}], { tuning: ["E4", "?"] })), [64, 59, 55, 50, 45, 40]);
    assert.deepEqual(tuningOf(score([{}], { tuning: ["D4", "A3", "F#3", "D3", "A2", "D2"] })), [62, 57, 54, 50, 45, 38]);
  });
});

describe("chordIntervals / chordVoicing", () => {
  it("If a quality is given it should give its chord tones", () => {
    const cases: [string, number[]][] = [
      ["", [0, 4, 7]],
      ["m", [0, 3, 7]],
      ["7", [0, 4, 7, 10]],
      ["M7", [0, 4, 7, 11]],
      ["maj7", [0, 4, 7, 11]],
      ["m7", [0, 3, 7, 10]],
      ["m7-5", [0, 3, 6, 10]],
      ["dim7", [0, 3, 6, 9]],
      ["aug", [0, 4, 8]],
      ["sus4", [0, 5, 7]],
      ["7sus4", [0, 5, 7, 10]],
      ["sus2", [0, 2, 7]],
      ["add9", [0, 4, 7, 14]],
      ["6", [0, 4, 7, 9]],
      ["9", [0, 4, 7, 10, 14]],
      ["mM7", [0, 3, 7, 11]],
      ["7(b9)", [0, 4, 7, 10, 13]],
    ];
    for (const [quality, tones] of cases) assert.deepEqual(chordIntervals(quality), tones, quality);
  });

  it("If a chord name is given it should voice it with the bass low and the tones an octave up", () => {
    // C: C3 bass, G3, then C4 E4 G4.
    assert.deepEqual(chordVoicing("C"), [48, 55, 60, 64, 67]);
    // Am over E2..D#3: A2 bass.
    assert.deepEqual(chordVoicing("Am"), [45, 52, 57, 60, 64]);
    // G/B: B2 in the bass, under the G chord.
    assert.deepEqual(chordVoicing("G/B")![0], 47);
    assert.deepEqual(chordVoicing("F#m7")![0], 42);
    assert.equal(chordVoicing("N.C."), null);
  });
});

describe("soundEvents", () => {
  it("If measures only have chords they should strum each chord until the next, and again where it carries over", () => {
    const events = eventsOf(score([{ chords: [{ symbol: "C", beat: 1 }, { symbol: "G", beat: 3 }] }, {}]));
    assert.deepEqual(
      events.map((e) => [e.part, e.at, e.length, e.notes[0]]),
      [
        ["chord", 0, 2, 48],
        ["chord", 2, 2, 43],
        ["chord", 4, 4, 43],
      ],
    );
  });

  it("If the score has a capo chords and frets should sound higher by it", () => {
    const events = eventsOf(
      score(
        [{ chords: [{ symbol: "C" }], beats: tab("1:1-0") }],
        { capo: 2 },
      ),
    );
    assert.equal(events.find((e) => e.part === "chord")!.notes[0], 50);
    assert.deepEqual(events.find((e) => e.part === "tab")!.notes, [66]);
  });

  it("If a measure has tab it should play its notes in time, slashes as the chord, ties and rests silent", () => {
    const events = eventsOf(
      score([
        {
          chords: [{ symbol: "Am" }, { symbol: "E", beat: 3 }],
          beats: tab("8:5-0+3-2 8:~3-2 4:r 4:/!u 4:6-x"),
        },
      ]),
    ).filter((e) => e.part === "tab");
    assert.deepEqual(
      events.map(({ part: _, ...e }) => e),
      [
        { at: 0, length: 0.5, notes: [45, 57] },
        { at: 2, length: 1, notes: chordVoicing("E"), stroke: "up" },
        { at: 3, length: 1, notes: [40], muted: true },
      ],
    );
  });

  it("If a simile measure has no tab of its own it should repeat the previous measure's", () => {
    const events = eventsOf(score([{ beats: tab("1:1-3") }, { simile: 1 }]));
    assert.deepEqual(
      events.map((e) => [e.at, e.notes]),
      [
        [0, [67]],
        [4, [67]],
      ],
    );
  });

  it("If a drawn chord shape is named it should sound that shape and follow the play order", () => {
    const doc = load("sample");
    const steps = playOrder(doc);
    const events = soundEvents(doc, steps);
    assert.ok(events.length > 0);
    assert.ok(events.every((e, i) => i === 0 || events[i - 1]!.at <= e.at));
    assert.ok(events.at(-1)!.at < steps.at(-1)!.start + steps.at(-1)!.beats);
    const shaped = doc.sections.flatMap((s) => s.measures).find((m) => m.chords?.some((c) => c.shape));
    if (shaped) {
      // E-high: frets [0,0,1,2,2,0] from string 1, with capo 2.
      assert.ok(events.some((e) => e.part === "chord" && e.notes.join() === [42, 49, 54, 58, 61, 66].join()));
    }
  });
});

describe("tabBeats", () => {
  const placed = (doc: GtsDocument) => tabBeats(doc, playOrder(doc)).map((beats) => beats.map((b) => [b.at, b.length]));

  it("If a measure has tab it should place each beat at its offset in the measure's beats", () => {
    assert.deepEqual(placed(score([{ beats: tab("8:6-0 8:r 4:/ 8t:1-0 8t:1-2 8t:1-3 4.:2-1 8:r") }])), [
      [
        [0, 0.5],
        [0.5, 0.5],
        [1, 1],
        [2, 1 / 3],
        [2 + 1 / 3, 1 / 3],
        [2 + 2 / 3, 1 / 3],
        [3, 1.5],
        [4.5, 0.5],
      ],
    ]);
  });

  it("If the time signature counts eighths it should count the tab in eighths", () => {
    assert.deepEqual(placed(score([{ beats: tab("8:1-0 4:1-2") }], { timeSignature: "6/8" })), [
      [
        [0, 1],
        [1, 2],
      ],
    ]);
  });

  it("If a measure is a measure-repeat sign or has no tab it should repeat the previous beats or give none", () => {
    assert.deepEqual(placed(score([{ beats: tab("2:1-3 2:1-5") }, { simile: 1 }, {}])), [
      [
        [0, 2],
        [2, 2],
      ],
      [
        [0, 2],
        [2, 2],
      ],
      [],
    ]);
  });
});
