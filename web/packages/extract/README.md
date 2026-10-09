# @guitarmr/extract

Reads the `structure` and `chords` layers of a gts document from the
scanned score with Claude, and the edits made while reviewing them. Pure
TypeScript with no dependencies besides `@guitarmr/gts`; the model call
and the image cutting are left to the caller (the phone page in
`web/packages/demo` does both in the browser).

- `crops.ts`: one crop per system, from the measure regions of the layout
  layer alone, with each measure's left/right edge inside the crop.
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

`pnpm test` runs the whole read-and-merge path on the public-domain
samples with perfect answers built from their committed data, plus the
checks for broken answers and the edits. How well Claude actually reads
handwriting can only be judged on real scans.
