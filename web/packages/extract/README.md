# @guitarmr/extract

Reads the `structure`, `chords` and `tab` layers of a gts document from
the scanned score with Claude, checks what was read, and holds the edits
made while reviewing it. Pure
TypeScript with no dependencies besides `@guitarmr/gts`; the model call
and the image cutting are left to the caller (the phone page in
`web/packages/demo` does both in the browser).

- `crops.ts`: one crop per system, from the measure regions of the layout
  layer alone, with each measure's left/right edge inside the crop and a
  margin above and below the system's band (context: lyrics and signs
  written across the boundary); `withContext` widens a measure the same
  way for the review editor.
- `prompt.ts`: the instruction for one page: what the images are (system
  crops with a strip of measure-id tags above, and the page top for the
  header on the first page), what to read, and the JSON to answer with.
- `reading.ts`: checks an answer field by field against the gts rules
  (invalid parts are dropped and listed as warnings, never guessed) and
  merges it: structure and chords replaced, `review.status` set to `auto`,
  or `needs-attention` below 0.7 confidence or with a note; the layers are
  listed in `meta.layers` once every measure has been read.
- `edit.ts`: review edits as pure functions (update a measure, start a
  section at a measure, review counts).
- `tab.ts`: the tab layer, read after structure and chords from the same
  crops. Claude answers one tab line per measure in the notation of
  `formatTabLine` in `@guitarmr/gts` (`8:6-0+4-2!d 8:r 4:/`, the same one
  the review editor uses), parsed by `parseTabLine`; tokens that are not a
  beat are dropped and reported. `beats: []` means read with nothing on
  the TAB (chords only); similes get none. A measure is marked for review
  when Claude is unsure or a check fails.
- `checks.ts`: checks beyond the schema. Per measure (`checkTab`): the
  beats fill the time signature (the first and last measures may be
  short: a pickup), no string has two notes at once, a chord spans at
  most 5 frets, ties continue the same string and fret (across bar lines
  too). Across measures (`checkStructure`): every ‖: closes before the
  next, a :‖ without ‖: only for the first repeat, repeat counts only on
  :‖, endings numbered 1, 2, ... with :‖ at the end of each but the last
  and enough plays for them, D.S. with a segno, al Coda with To Coda and a
  coda after it, Fine only with a D.S./D.C., one jump only, similes with
  something to repeat and no tab, sections not starting inside endings and
  the first one named when the others are, and a play order that ends.
  `checkDocument` returns both as a list for the page.

`pnpm test` runs the whole read-and-merge path on the public-domain
samples with perfect answers built from their committed data (structure
and chords, then the tab), plus broken answers, every check (the samples
pass all of them) and the edits. How well Claude actually reads
handwriting can only be judged on real scans.
