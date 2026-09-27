/**
 * The public-domain sample songs as gts documents (every layer except
 * layout, which make-samples fills by running layoutscan on the PDF).
 *
 * - twinkle-twinkle: "Twinkle, Twinkle, Little Star", melody "Ah! vous
 *   dirai-je, maman" (18th century).
 * - sakura-sakura: 「さくらさくら」, Japanese traditional. Verse 1 is the
 *   Meiji-era text, verse 2 the 1941 Ministry of Education text (published
 *   under an organization's name; protection has expired).
 *
 * Melodies and lyrics are public domain; chords and tab are written for
 * this project.
 */

import type { Beat, GtsDocument, Measure, Section } from "@guitarmr/gts";

type ChordEntry = NonNullable<Measure["chords"]>[number];

/** Notated pitch (guitar notation, an octave above sounding) -> [string, fret] in open position. */
const POSITIONS: Record<string, [number, number]> = {
  E3: [6, 0],
  B3: [5, 2],
  C4: [5, 3],
  D4: [4, 0],
  E4: [4, 2],
  F4: [4, 3],
  G4: [3, 0],
  "G#4": [3, 1],
  A4: [3, 2],
  B4: [2, 0],
  C5: [2, 1],
  E5: [1, 0],
};

/**
 * "A4 B4:8 A4:8 F4:2" -> beats. Default value 4 (quarter); "r" is a rest;
 * "E3+B3+E4:1" plays several strings at once; a trailing "^" adds a fermata.
 */
export function beats(melody: string, stroke?: "down" | "up"): Beat[] {
  return melody.split(/\s+/).map((raw) => {
    const fermata = raw.endsWith("^");
    const [pitches = "", value] = raw.replace(/\^$/, "").split(":");
    const beat: Record<string, unknown> = { duration: { value: Number(value ?? 4) } };
    if (pitches === "r") {
      beat.rest = true;
    } else {
      if (stroke) beat.stroke = stroke;
      beat.notes = pitches.split("+").map((p) => {
        const pos = POSITIONS[p];
        if (!pos) throw new Error(`no position for ${p}`);
        return { string: pos[0], fret: pos[1] };
      });
    }
    if (fermata) beat.fermata = true;
    return beat as unknown as Beat;
  });
}

/** "Am E7@2.5" -> chord symbols; "@beat" defaults to 1, then 3. */
export function chords(spec: string): ChordEntry[] {
  return spec.split(/\s+/).map((token, i) => {
    const [symbol = "", beat] = token.split("@");
    return { symbol, beat: beat ? Number(beat) : 1 + 2 * i };
  });
}

type Draft = Omit<Measure, "id">;

function document(meta: GtsDocument["meta"], sections: { label: string; measures: Draft[] }[]): GtsDocument {
  let number = 0;
  const numbered = sections.map((s) => ({
    label: s.label,
    measures: s.measures.map((m) => ({ id: `m${++number}`, ...m })),
  })) as [Section, ...Section[]];
  return { format: "gts", version: "0.1", meta, source: { file: "", pages: [] as never }, sections: numbered };
}

export function twinkle(): GtsDocument {
  const song: [string, [string, string][]][] = [
    ["A", [["C4 C4 G4 G4", "C"], ["A4 A4 G4:2", "F C"], ["F4 F4 E4 E4", "F C"], ["D4 D4 C4:2", "G7 C"]]],
    ["B", [["G4 G4 F4 F4", "C F"], ["E4 E4 D4:2", "C G7"], ["G4 G4 F4 F4", "C F"], ["E4 E4 D4:2", "C G7"]]],
    ["A'", [["C4 C4 G4 G4", "C"], ["A4 A4 G4:2", "F C"], ["F4 F4 E4 E4", "F C"], ["D4 D4 C4:2", "G7 C"]]],
  ];
  const sections = song.map(([label, bars]) => ({
    label,
    measures: bars.map(([melody, chordSpec]): Draft => ({ chords: chords(chordSpec), beats: beats(melody, "down") })),
  }));
  sections[0]!.measures[0]!.barStart = "repeat-start";
  Object.assign(sections[2]!.measures[3]!, { barEnd: "repeat-end", repeatTimes: 2 });
  return document(
    {
      title: "Twinkle, Twinkle, Little Star",
      artist: "Traditional",
      key: "C",
      capo: 0,
      tempo: 100,
      timeSignature: "4/4",
      layers: ["layout", "structure", "chords", "tab"],
    },
    sections,
  );
}

export function sakura(): GtsDocument {
  // [melody, chords, verse 1, verse 2]
  const a: [string, string, string, string][] = [
    ["A4 A4 B4:2", "Am Esus4", "さくら", "さくら"],
    ["A4 A4 B4:2", "Am E7", "さくら", "さくら"],
    ["A4 B4 C5 B4", "Am Am/G", "やよいの", "のやまも"],
    ["A4 B4:8 A4:8 F4:2", "Dm7 FM7", "そらは", "さとも"],
  ];
  const b: [string, string, string, string][] = [
    ["E4 C4 E4 F4", "Am Dm", "みわたす", "みわたす"],
    ["E4 E4:8 C4:8 B3:2", "E7sus4 E7", "かぎり", "かぎり"],
    ["A4 B4 C5 B4", "Am Am/G", "かすみか", "かすみか"],
    ["A4 B4:8 A4:8 F4:2", "Dm7 FM7", "くもか", "くもか"],
    ["E4 C4 E4 F4", "Am Dm", "においぞ", "あさひに"],
    ["E4 E4:8 C4:8 B3:2", "Esus4 E", "いずる", "におう"],
  ];
  const c: [string, string, string, string][] = [
    ["A4 A4 B4:2", "Am E7@2.5", "いざや", "さくら"],
    ["A4 A4 B4:2", "Am E7", "いざや", "さくら"],
    ["E4 F4 B4:8 A4:8 F4", "C@1 Dm@2 Bm7-5@3 E7@4", "みにゆか", "はなざか"],
  ];
  const sections = (
    [
      ["A", a],
      ["B", b],
      ["C", c],
    ] as const
  ).map(([label, bars]) => ({
    label,
    measures: bars.map(
      ([melody, chordSpec, verse1, verse2]): Draft => ({
        chords: chords(chordSpec),
        lyrics: [
          { verse: 1, text: verse1 },
          { verse: 2, text: verse2 },
        ],
        beats: beats(melody),
      }),
    ),
  }));
  sections[0]!.measures[0]!.barStart = "repeat-start";
  sections[2]!.measures.push(
    {
      volta: [1],
      barEnd: "repeat-end",
      repeatTimes: 2,
      chords: chords("E7sus4 E7"),
      lyrics: [{ verse: 1, text: "ん" }],
      beats: beats("E4:2 r:2"),
    },
    {
      volta: [2],
      barEnd: "final",
      chords: chords("E"),
      lyrics: [{ verse: 2, text: "り" }],
      beats: beats("E3+B3+E4+G#4+B4+E5:1^"),
    },
  );
  return document(
    {
      title: "さくらさくら",
      artist: "日本古謡",
      key: "Am",
      capo: 2,
      tempo: 72,
      timeSignature: "4/4",
      layers: ["layout", "structure", "chords", "tab", "lyrics"],
    },
    sections,
  );
}

