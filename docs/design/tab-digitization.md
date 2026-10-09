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
| Harmony | Chord names above each measure, often with Roman numeral degrees (`IV`, `VIm`, `IIIm7`) | Chords carry a beat position; degrees are out of scope for now (§5) |
| Lyrics | Up to two verses per system, marked with circled 1/2, written inside the empty standard staff | A `lyrics` layer with a verse number per entry (§5); private files only |
| Header | Title, `Capo 4`, `Key = G`, page number | Score-level metadata |
| Annotations | Teacher comments in red/green/blue pen, strum arrows (↓↑) | Arrows become stroke directions; colored ink is filtered out, comments are out of scope for now (§5) |
| Other layout | One score opens with a printed chord-over-lyrics page with no staves (its remaining pages are regular staff + TAB) | Out of scope for now (§5); pages without systems are logged and skipped (§6) |

Handwriting recognition will never be perfect, so the format must also be
able to say **how sure** it is and **where on the page** each element came
from, so a person can review it quickly against the scan.

## 2. Requirements for the format

1. **Faithful to the page, not to a playback engine**: store what is
   written (simile signs, repeats, capo-relative frets and chord shapes)
   and derive the rest (unrolled playback order, concert pitch).
2. **Partial data is valid**: the data is split into layers (§5) that are
   extracted independently; a score with only some layers filled is a
   complete, useful document.
3. **Page geometry**: every measure links to a normalized bounding
   box on the upright page. This powers review side-by-side with the scan and,
   in the app, highlighting the current measure on the PDF and auto page
   turning (backlog item).
4. **Review metadata**: confidence and review status per measure.
5. **Machine-friendly**: easy to validate, easy to emit from an LLM with
   structured output, easy to load in Unity (C#) and TypeScript.
6. **Convertible later**: rich enough (with the `tab` layer) that a one-way export
   to an established format for rendering and playback in other viewers
   is possible without changing the model.

## 3. Options considered

| Format | Strengths | Gaps against the requirements |
| --- | --- | --- |
| MusicXML | The interchange standard; TAB (`<technical><string/><fret/>`), lyrics, harmony, repeats all expressible; opens in MuseScore / Guitar Pro | Very verbose; no place for scan coordinates, confidence or colored comments; a chords-only measure still needs filler notes/rests; LLM output of it is error-prone |
| Guitar Pro (.gp) | Best tab tooling | Proprietary zipped XML; same gaps as MusicXML |
| alphaTex (alphaTab) | Compact text syntax built for tab; renders and plays in the browser | Niche grammar with a single implementation; no geometry/review metadata; hard to validate outside alphaTab |
| ChordPro | Perfect for chord-over-lyrics sheets | No measures, rhythm or tab |
| **Own JSON + JSON Schema** | Carries geometry, confidence and partial data (layers) natively; schema-validated; direct LLM structured-output target; trivial to load in C#/TypeScript | Needs our own viewer; other apps need an exporter (MusicXML, backlog) |

## 4. Decision

Use a project-specific JSON format, **gts** (Guitar Tab Score), as the
canonical representation, defined by [`schemas/gts.schema.json`](../../schemas/gts.schema.json)
(JSON Schema 2020-12). No established format is used as the source of
truth, and no exporter is built for now. A one-way **MusicXML export** (to
view and play scores in MuseScore, Guitar Pro and other viewers) is a
possible future addition and is tracked in the backlog; it would live in a
single converter without changing this format.

A worked example covering every construct is in
[`schemas/examples/sample.gts.json`](../../schemas/examples/sample.gts.json).
Complete real-song examples are the end-to-end test fixtures. Their
melodies and lyrics are public domain, so unlike real transcriptions (§7)
they can live in the repository. Only the gts files are committed; the
scanned-looking PDF each one describes is generated from it on demand
(`@guitarmr/samples`), keeping binaries out of git:

- [`twinkle-twinkle`](../../schemas/examples/twinkle-twinkle.gts.json): layout, structure,
  chords and tab; one page scanned sideways.
- [`sakura-sakura`](../../schemas/examples/sakura-sakura.gts.json): all five layers with
  two verses of Japanese lyrics, 1st/2nd endings, slash/sus4/M7/m7-5
  chords and off-beat chord changes; two pages, the second upside down.

## 5. Data model

```
score
├── meta          title, key, capo, tuning, tempo, timeSignature, layers
├── source        pdf file name, sha256, pages[{index, rotation}]
├── chordShapes   named voicings drawn on the page (circled stacks)
└── sections[]    label ("Intro", "A", "Coda", ...; absent when unknown)
    └── measures[]  id, region, bars/repeats/volta/navigation, simile,
                    chords[{symbol, beat, shape}],
                    lyrics[{verse, text}],
                    beats[{duration, rest|slash|notes[], stroke}],
                    review{status, confidence, comment}
```

### Out of scope for now

Present on the scores but deliberately not modeled or extracted yet. Each
can be added later as an optional field without breaking existing files.

| Element | Later shape (sketch) |
| --- | --- |
| Roman numeral degrees (`IV`, `VIm`) | `chords[].degree` |
| Barline-free printed chord sheets (skipped pages today) | a `lines[]` section body of `{chord, lyric}` segments |
| Colored pen comments | top-level `annotations[{text, color, measure/region}]` |

### Layers

The data is organized in five layers. Each layer is extracted by its own
pipeline step and fills its own fields; `meta.layers` lists the layers that
are filled for the whole score. `layout` is the base every other layer
attaches to; `structure`, `chords`, `tab` and `lyrics` only need `layout`,
not each other, so they can be built and improved in any order.

| Layer | What it captures | gts fields | Extracted by | Expected accuracy | Enables |
| --- | --- | --- | --- | --- | --- |
| `layout` | Page orientation, systems, measures and where each sits on the page, in written order | `source.pages[].rotation`, `measures[].id`, `measures[].region` | Classic CV (deterministic) | High; hand-added bar lines and colored ink over bar lines need checking | Measure highlighting in written order, measure counting, crops for review and for the other layers |
| `structure` | Header info, rehearsal marks, meter, repeats and navigation | `meta.title/key/capo/timeSignature/tempo`, `sections[].label`, `measures[].timeSignature/barStart/barEnd/repeatTimes/volta/navigation/simile` | Vision LLM on system crops | Header and rehearsal marks high; repeat/volta/D.S. spans medium to high | Playback order (unrolled repeats), so the app can follow the metronome and turn pages |
| `chords` | Chord names and drawn voicings | `measures[].chords[{symbol, beat, shape}]`, `chordShapes` | Vision LLM on measure crops | High for names; beat positions approximate | Chord display for the current measure |
| `tab` | Rhythm and tab notes | `measures[].beats[]` (durations, rests, slashes, strings/frets, techniques, strokes) | Vision LLM on enlarged measure crops, checked by the validators | Low to medium: a draft to be reviewed | Audio playback, future MusicXML export |
| `lyrics` | Lyric text per measure and verse (personal use only) | `measures[].lyrics[{verse, text}]` | Pasted lyrics text aligned to measure crops by a vision LLM; reading the handwriting is the fallback (backlog) | High when aligning known text; medium when read from handwriting | Lyrics display for the current measure |

Cross-cutting: `measures[].review` (status, confidence) is written by
whichever step touched the measure last. Until the `structure` layer is
filled, `meta.title` falls back to the PDF file name and sections have no
label.

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
- **Simile** (`%`, or a slash with dots across the TAB) measures keep
  `simile: 1|2` and no beats of their own; consumers (playback, a future
  exporter) repeat the previous measures' rhythm and notes. Chord names
  written over a simile measure are kept: the scores use this for "the
  same pattern on a new chord".
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
| Chord name | `chords[{symbol, beat}]` |
| Lyric lines inside the staff, circled ①② | `lyrics[{verse, text}]` |
| Circled vertical fret stack | `chordShapes` entry + `chords[].shape` |

## 6. Recognition pipeline (outline)

```
PDF ──▶ 1. rasterize + orient ──▶ 2. layout ──▶ 3. content ──▶ 4. validate ──▶ 5. review ──▶ gts.json
                                      │              │                                         │
                                      └─ layout ─────┴─ structure/chords/tab                     └─▶ GuitarMR
```

1. **Rasterize and orient** (TypeScript, pdf.js): render pages at ~3000 px and
   pick the rotation whose horizontal projection shows long staff lines.
   Split ink by color: pencil/black stays for recognition, red/green/blue
   is dropped so teacher comments overlapping the TAB do not confuse it.
2. **Layout** (classic CV, deterministic): find staff line groups (5-line
   staff vs 6-line TAB) → systems; vertical bar lines → measures with
   regions. Output is the `layout` layer. Implemented by
   [`web/packages/layoutscan`](../../web/packages/layoutscan/README.md).
   A page where no system is found (e.g. a printed chord-over-lyrics sheet)
   is logged as a warning with its page index and skipped: it is left out
   of `source.pages` and the rest of the PDF is processed normally.
3. **Content** (multimodal LLM): one step per layer (`structure`,
   `chords`, `tab`). Handwritten OMR engines (e.g. Audiveris) target
   printed standard notation and do not read handwritten TAB, which is why
   a vision LLM is the pragmatic choice here; the schema keeps its output
   checkable. `structure` and `chords` are read together and implemented
   by [`web/packages/extract`](../../web/packages/extract/README.md): one
   request per page, with one image per system cut from the upright page
   (the band from the layout layer with a faded margin of the systems
   above and below, so writing across the boundary stays readable, plus
   a white strip on top holding a magenta tag with each measure id), and
   the page top for the header on the first page. The answer is per-measure JSON with a confidence and an
   optional note; `tab` is not read yet.
4. **Validate**: every answered field is checked against the schema rules
   (chord-symbol grammar, enums, ranges) and dropped with a warning when
   invalid, never guessed. A measure with confidence below 0.7 or a note
   is marked `needs-attention`. Still to come: beat sums per time
   signature, string/fret ranges (for `tab`), repeat/volta balance.
5. **Review**: in the phone page (web/packages/demo), the score shows the
   read chords and signs over each measure, colored by review state;
   tapping a measure opens an editor with the measure image and its
   fields. "Reviewed" is set only by the person, never by the reader.
   Work in progress is kept as a draft in the browser, and a saved gts
   file can be opened again to continue.

## 7. Storage and copyright

The scores are copyrighted songs. Real transcriptions (and their PDFs) stay
out of this repository; only the schema, tools and synthetic examples live
here. The planned convention is to keep `song.gts.json` next to
`song.pdf`, so the app's picker can find the data for a selected PDF (and
check `source.sha256` to detect a replaced PDF).

## 8. Roadmap

1. **Format** (done): schema, examples, design.
2. **`layout` layer** (done):
   [`web/packages/layoutscan`](../../web/packages/layoutscan/README.md),
   a TypeScript library + CLI producing measures with regions; all systems
   and all but one measure of the surveyed scores are found.
3. **Phone/tablet PWA** (ADR-009): PDF import, layout detection in a Web
   Worker, score viewer with the detected measures, `.gts.json` export.
   A single-file demo of this runs as a claude.ai Artifact.
4. **`structure` and `chords` layers** (done in the demo): Claude reads
   them per page, the review editor corrects them.
5. **`tab` and `lyrics` layers**: further LLM steps + validators (beat
   sums, string/fret ranges), reviewed in the same editor.
6. **App integration**: load the sidecar JSON in GuitarMR (Domain model in
   C#), highlight the current measure and turn pages in sync with the
   metronome.

MusicXML export is not on this roadmap; it stays in the backlog
(docs/project) until viewing scores in other apps becomes a need.

## 9. Open questions

- Multi-voice passages (bass line + melody with separate stems) are rare in
  the surveyed scores; the model has a single voice per measure for now and
  may gain `voices[]` in a later version.
- Whether the 5-line staff above the TAB is ever filled in; so far it is
  always empty, so it is not modeled.
