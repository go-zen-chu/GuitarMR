# Handwritten Tab Digitization

Design for turning the handwritten guitar scores (scanned PDFs) into
structured data. This first iteration fixes the **data format**; the
recognition pipeline is outlined so the format is shaped by what it must
carry, and will be refined as it is built. The decision summary is ADR-008 in
[README.md](README.md).

## 1. What the source material looks like

Surveyed from three real scores (4, 5 and 7 pages):

| Aspect | Observation | Consequence for the design |
| --- | --- | --- |
| File | Scanned images only (Print-to-PDF / iOS scan), no text layer | Everything must be recognized from pixels |
| Orientation | Mixed per page: upright, 90° and 270° within the same PDF | Per-page rotation must be detected and recorded |
| Paper | Printed staff paper: TAB-only systems, or a 5-line staff (left empty) above a TAB | Staff/bar lines are regular, so layout can be found with classic CV |
| Tab content | Pencil fret numbers, beams/stems for rhythm, `x` dead notes, `H`/`P`, ties, rests, rhythm slashes, `%` simile signs, circled chord stacks | Rhythm and tab need a per-beat model; simile kept as-is |
| Structure | Boxed rehearsal marks (Intro, A, B, C, Coda), repeat bars with `2x`/`4回`, 1st/2nd endings, segno, coda, D.S. | Navigation must be modeled to derive playback order |
| Harmony | Chord names above each measure, often with Roman numeral degrees (`IV`, `VIm`, `IIIm7`) | Chords carry beat position and optional degree |
| Lyrics | Up to two verses per system, marked with circled 1/2 | Lyrics carry a verse number |
| Header | Title, `Capo 4`, `Key = G`, page number | Score-level metadata |
| Annotations | Teacher comments in red/green/blue pen, strum arrows (↓↑) | Arrows become stroke directions; comments are kept as colored annotations |
| Other layout | One score is a printed chord-over-lyrics sheet with no barlines | A barline-free "lines" body is needed alongside measures |

Handwriting recognition will never be perfect, so the format must also be
able to say **how sure** it is and **where on the page** each element came
from, so a person can review it quickly against the scan.

## 2. Requirements for the format

1. **Faithful to the page, not to a playback engine**: store what is
   written (simile signs, repeats, capo-relative frets and chord shapes)
   and derive the rest (unrolled playback order, concert pitch).
2. **Partial fidelity is valid**: a score with only structure, or only
   chords and lyrics, is a complete, useful document. Chord sheets never go
   beyond chords.
3. **Page geometry**: every measure (or line) links to a normalized bounding
   box on the upright page. This powers review side-by-side with the scan and,
   in the app, highlighting the current measure on the PDF and auto page
   turning (backlog item).
4. **Review metadata**: confidence and review status per measure.
5. **Machine-friendly**: easy to validate, easy to emit from an LLM with
   structured output, easy to load in Unity (C#) and Python.
6. **Exportable** to established formats for rendering, playback and
   sharing.

## 3. Options considered

| Format | Strengths | Gaps against the requirements |
| --- | --- | --- |
| MusicXML | The interchange standard; TAB (`<technical><string/><fret/>`), lyrics, harmony, repeats all expressible; opens in MuseScore / Guitar Pro | Very verbose; no place for scan coordinates, confidence or colored comments; a chords-only measure still needs filler notes/rests; LLM output of it is error-prone |
| Guitar Pro (.gp) | Best tab tooling | Proprietary zipped XML; same gaps as MusicXML |
| alphaTex (alphaTab) | Compact text syntax built for tab; renders and plays in the browser | Niche grammar with a single implementation; no geometry/review metadata; hard to validate outside alphaTab |
| ChordPro | Perfect for chord-over-lyrics sheets | No measures, rhythm or tab |
| **Own JSON + JSON Schema** | Carries geometry, confidence, partial fidelity and annotations natively; schema-validated; direct LLM structured-output target; trivial to load in C#/Python | Needs our own exporters and viewer |

## 4. Decision

Use a project-specific JSON format, **gts** (Guitar Tab Score), as the
canonical representation, defined by [`schemas/gts.schema.json`](../../schemas/gts.schema.json)
(JSON Schema 2020-12). Established formats are **export targets**, not the
source of truth:

- MusicXML → MuseScore / Guitar Pro for engraving and audio playback
- alphaTex → browser rendering in the review tool
- ChordPro → chord sheets

A worked example covering every construct is in
[`schemas/examples/sample.gts.json`](../../schemas/examples/sample.gts.json).

## 5. Data model

```
score
├── meta          title, key, capo, tuning, tempo, timeSignature, fidelity
├── source        pdf file name, sha256, pages[{index, rotation}]
├── chordShapes   named voicings drawn on the page (circled stacks)
├── sections[]    label ("Intro", "A", "Coda", ...), then ONE of:
│   ├── measures[]  id, region, bars/repeats/volta/navigation, simile,
│   │               chords[{symbol, beat, degree, shape}],
│   │               lyrics[{verse, text}],
│   │               beats[{duration, rest|slash|notes[], stroke}],
│   │               review{status, confidence, comment}
│   └── lines[]     chord sheet: segments[{chord, lyric}], region
└── annotations[] colored free-text comments, anchored to a measure or region
```

### Fidelity levels

| Level | Captured | Enables |
| --- | --- | --- |
| 1 | Pages, sections, measures with regions, repeats and navigation | Measure highlighting, auto page turn, bar counting |
| 2 | + chords (with beat positions) and lyrics | Chord charts, ChordPro export, practice by section |
| 3 | + rhythm and tab notes per beat | MusicXML/alphaTex export, rendering, audio playback |

`meta.fidelity` states the level the whole score reaches; individual
measures may go further.

### Conventions

- **Strings** are numbered 1 (high E) to 6 (low E). **Frets** and **chord
  symbols** are written capo-relative, exactly as on the page; concert pitch
  is derived from `meta.capo` and `meta.tuning`.
- **Durations** use note-value denominators (`4` = quarter) plus dots and
  `tuplet: [actual, normal]`, the vocabulary of the page rather than ticks.
  A validator checks that each measure's beats add up to its time signature.
- **Beat positions** of chords are 1-based and may be fractional (`2.5` =
  the "and" of beat 2).
- **Written vs played order**: sections and measures are stored in written
  order. Playback order is derived by expanding `repeat-start`/`repeat-end`
  with `repeatTimes`, `volta`, and `segno`/`to-coda`/`ds-al-coda`/`coda`.
- **Simile** (`%`) measures keep `simile: 1|2` and no content of their own;
  exporters expand them.
- **Regions** are `[x0, y0, x1, y1]` normalized to 0..1 on the page after
  applying `source.pages[].rotation`, independent of render resolution.

### Mapping handwritten marks to fields

| On the page | gts |
| --- | --- |
| Boxed `A`, `Intro` | `sections[].label` |
| Fret number on TAB line | `notes[{string, fret}]` |
| `x` on a line | `notes[{string, dead: true}]` |
| `H` / `P` / slide line between notes | `slur` on the earlier note |
| Tie arc | `tie: true` on the later note |
| Beams / flags / dots | `duration{value, dots}` |
| `3` over a beam group | `duration.tuplet: [3, 2]` |
| Slash on the staff | `beat.slash: true` |
| `↓` `↑` under the TAB | `beat.stroke` |
| `%` / `𝄎` | `measure.simile: 1 / 2` |
| `‖:  :‖` with `2x`, `4回` | `barStart`/`barEnd`, `repeatTimes` |
| 1st/2nd ending brackets | `measure.volta` |
| 𝄋 / 𝄌 / `D.S.` / `to Coda` | `measure.navigation` |
| Chord name + Roman numeral | `chords[{symbol, degree}]` |
| Circled vertical fret stack | `chordShapes` entry + `chords[].shape` |
| Circled ①② lyric lines | `lyrics[{verse}]` |
| Colored pen comments | `annotations[{text, color}]` |

## 6. Recognition pipeline (outline)

```
PDF ──▶ 1. rasterize + orient ──▶ 2. layout ──▶ 3. content ──▶ 4. validate ──▶ 5. review ──▶ gts.json
                                      │              │                                         │
                                      └─ level 1 ────┴─ level 2/3                               └─▶ exporters / GuitarMR
```

1. **Rasterize and orient** (Python, PyMuPDF): render pages at ~300 dpi and
   pick the rotation whose horizontal projection shows long staff lines.
   Split ink by color: pencil/black stays for recognition, red/green/blue
   is routed to annotations (also removing teacher comments that overlap
   the TAB).
2. **Layout** (classic CV, deterministic): find staff line groups (5-line
   staff vs 6-line TAB) → systems; vertical bar lines → measures with
   regions; boxed labels → section boundaries. Output is a level-1 skeleton.
3. **Content** (multimodal LLM): per system, send the measure crops plus
   system context and ask for the measure objects with the JSON Schema as a
   structured-output contract, including per-measure confidence. Handwritten
   OMR engines (e.g. Audiveris) target printed standard notation and do not
   read handwritten TAB, which is why a vision LLM is the pragmatic choice
   here; the schema keeps its output checkable.
4. **Validate**: JSON Schema, then semantic checks — beat sums per time
   signature, string/fret ranges, chord-symbol grammar, repeat/volta
   balance, unique measure ids. Failures mark the measure
   `needs-attention` and can be retried with the error fed back.
5. **Review**: a static HTML tool that shows each measure crop next to its
   rendering (via the alphaTex export), sorted by lowest confidence, and
   edits the JSON in place.

## 7. Storage and copyright

The scores are copyrighted songs. Real transcriptions (and their PDFs) stay
out of this repository; only the schema, tools and synthetic examples live
here. The planned convention is to keep `song.gts.json` next to
`song.pdf`, so the app's picker can find the data for a selected PDF (and
check `source.sha256` to detect a replaced PDF).

## 8. Roadmap

1. **Format** (this change): schema, example, design.
2. **Layout extraction**: `tools/tabscan` Python CLI producing level-1
   skeletons with regions; verify on the surveyed scores.
3. **Content extraction**: LLM step for levels 2/3 + validators.
4. **Review tool and exporters**: HTML reviewer, alphaTex/MusicXML/ChordPro.
5. **App integration**: load the sidecar JSON in GuitarMR (Domain model in
   C#), highlight the current measure and turn pages in sync with the
   metronome.

## 9. Open questions

- Multi-voice passages (bass line + melody with separate stems) are rare in
  the surveyed scores; the model has a single voice per measure for now and
  may gain `voices[]` in a later version.
- Whether the 5-line staff above the TAB is ever filled in; so far it is
  always empty, so it is not modeled.
- Lyrics are attached per measure; per-beat syllable alignment is deferred
  until something (karaoke-style display) needs it.
