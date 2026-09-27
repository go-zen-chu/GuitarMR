/* Generated from schemas/gts.schema.json by `pnpm --filter @guitarmr/gts generate`. Do not edit. */

export type TimeSignature = string;
/**
 * Chord name as written (capo-relative shape), e.g. "G/B", "F#m7", "Dsus4", "Eb7".
 */
export type ChordSymbol = string;
export type Beat = {
  duration: Duration;
  rest?: boolean;
  /**
   * Rhythm slash / strum without explicit frets (plays the current chord).
   */
  slash?: boolean;
  notes?: Note[];
  /**
   * Picking/strumming direction arrow.
   */
  stroke?: "down" | "up";
  brush?: "arpeggio-up" | "arpeggio-down";
  fermata?: boolean;
} & Beat1;
export type Beat1 =
  | {
      rest: true;
    }
  | {
      slash: true;
    }
  | {
      notes: {
        [k: string]: unknown;
      };
    };

/**
 * Structured digitization of a (handwritten) guitar score PDF. See docs/design/tab-digitization.md for the design rationale.
 */
export interface GuitarTabScoreGts {
  format: "gts";
  version: "0.1";
  meta: Meta;
  source: Source;
  /**
   * Chord voicings drawn on the score (circled stacks, diagrams), referenced by name from chord symbols.
   */
  chordShapes?: {
    [k: string]: ChordShape;
  };
  /**
   * Sections in written (not played) order. Playback order is derived from navigation marks.
   *
   * @minItems 1
   */
  sections: [Section, ...Section[]];
}
export interface Meta {
  title: string;
  artist?: string;
  /**
   * Key as written on the score (relative to the capo shapes), e.g. "G", "Em".
   */
  key?: string;
  capo?: number;
  /**
   * Open-string pitches from string 1 (high) to string 6 (low).
   */
  tuning?: string[];
  tempo?: number;
  timeSignature?: TimeSignature;
  /**
   * Layers filled for the whole score (see docs/design/tab-digitization.md): layout = measures and page regions, structure = header, sections, repeats and navigation, chords = chord symbols, tab = rhythm and tab notes, lyrics = lyric text per measure and verse.
   */
  layers?: ("layout" | "structure" | "chords" | "tab" | "lyrics")[];
}
export interface Source {
  /**
   * PDF file name the data was extracted from.
   */
  file: string;
  sha256?: string;
  /**
   * @minItems 1
   */
  pages: [
    {
      /**
       * 0-based page index in the PDF.
       */
      index: number;
      /**
       * Clockwise degrees to rotate the rendered page to make it upright. Regions are expressed in upright coordinates.
       */
      rotation: 0 | 90 | 180 | 270;
    },
    ...{
      /**
       * 0-based page index in the PDF.
       */
      index: number;
      /**
       * Clockwise degrees to rotate the rendered page to make it upright. Regions are expressed in upright coordinates.
       */
      rotation: 0 | 90 | 180 | 270;
    }[]
  ];
}
export interface ChordShape {
  /**
   * Fret per string from 1 (high) to 6 (low); null = not played, -1 = muted.
   *
   * @minItems 6
   * @maxItems 6
   */
  frets: [number | null, number | null, number | null, number | null, number | null, number | null];
  comment?: string;
}
export interface Section {
  /**
   * Rehearsal mark as written, e.g. "Intro", "A", "B", "Coda". Absent until the structure layer is filled or when the section is unmarked.
   */
  label?: string;
  measures: Measure[];
  review?: Review;
}
export interface Measure {
  /**
   * Stable identifier, unique within the score (e.g. "m12").
   */
  id?: string;
  region?: Region;
  timeSignature?: TimeSignature;
  barStart?: "repeat-start";
  barEnd?: "single" | "double" | "final" | "repeat-end";
  /**
   * Total number of plays for a repeat-end bar (e.g. "2x" = 2, "4回" = 4).
   */
  repeatTimes?: number;
  /**
   * Ending bracket numbers this measure belongs to (1st/2nd endings).
   *
   * @minItems 1
   */
  volta?: [number, ...number[]];
  navigation?: ("segno" | "coda" | "to-coda" | "ds" | "ds-al-coda" | "dc" | "dc-al-coda" | "fine")[];
  /**
   * Measure-repeat sign: repeat the previous 1 or 2 measures. Content fields must then be empty.
   */
  simile?: 1 | 2;
  chords?: {
    symbol: ChordSymbol;
    /**
     * 1-based beat position in the measure; fractional for off-beats.
     */
    beat?: number;
    /**
     * Key into chordShapes when a voicing is drawn.
     */
    shape?: string;
  }[];
  /**
   * Lyrics sung in this measure (lyrics layer), one entry per verse. Lyrics are copyrighted for most songs: keep such files private.
   */
  lyrics?: {
    /**
     * Verse number (the circled 1/2 marks).
     */
    verse: number;
    text: string;
  }[];
  /**
   * Rhythm and tab content (tab layer), a single voice in time order.
   */
  beats?: Beat[];
  review?: Review;
}
/**
 * Where an element sits on the upright page; bbox is [x0, y0, x1, y1] normalized to 0..1 from the top-left corner. For a measure it spans its bar lines horizontally and its system's band vertically (including chord names above and rhythm/lyrics below the staves).
 */
export interface Region {
  page: number;
  /**
   * @minItems 4
   * @maxItems 4
   */
  bbox: [number, number, number, number];
}
export interface Duration {
  /**
   * Note value denominator: 4 = quarter, 8 = eighth.
   */
  value: 1 | 2 | 4 | 8 | 16 | 32 | 64;
  dots?: number;
  /**
   * [actual, normal], e.g. [3, 2] for a triplet.
   *
   * @minItems 2
   * @maxItems 2
   */
  tuplet?: [number, number];
}
export interface Note {
  /**
   * 1 = high E, 6 = low E.
   */
  string: number;
  /**
   * Fret as written, relative to the capo. Omit for dead notes.
   */
  fret?: number;
  /**
   * Muted "x" note.
   */
  dead?: boolean;
  /**
   * Tied from the previous note on the same string.
   */
  tie?: boolean;
  /**
   * Legato into the next note on the same string: hammer-on (H), pull-off (P), slide (/ \).
   */
  slur?: "hammer-on" | "pull-off" | "slide";
  /**
   * Bend amount in semitones.
   */
  bend?: number;
  vibrato?: boolean;
  harmonic?: "natural" | "artificial";
  palmMute?: boolean;
  letRing?: boolean;
  accent?: boolean;
  /**
   * Parenthesized note.
   */
  ghost?: boolean;
  /**
   * Fretting finger if written (T = thumb).
   */
  finger?: "T" | "1" | "2" | "3" | "4";
}
/**
 * Provenance of the extracted data, so uncertain parts can be surfaced for human review.
 */
export interface Review {
  status?: "auto" | "reviewed" | "needs-attention";
  confidence?: number;
  comment?: string;
}
