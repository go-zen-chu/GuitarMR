# @guitarmr/layoutscan

Extracts the `layout` layer of a [gts](../../../schemas/gts.schema.json)
file from a scanned guitar score PDF: page orientation, systems (TAB,
optionally with a standard staff above) and the region of every measure,
in written order. Design context:
[docs/design/tab-digitization.md](../../../docs/design/tab-digitization.md).

The detection core (`src/detect.ts`) is a pure function over RGBA pixels,
so the same code runs in the PWA's worker and in this Node CLI. Everything
is classic image processing written with typed arrays (no OpenCV, no
network, no LLM); the same PDF always gives the same result.

## CLI

Requires Node 22+ and pnpm (see [web/README.md](../../README.md)).

```sh
cd web
pnpm --filter @guitarmr/layoutscan layoutscan path/to/song.pdf --debug-dir debug/
```

- Writes `path/to/song.gts.json` next to the PDF (`-o` to choose another
  path). The output is validated against the gts schema before writing.
- `--debug-dir` writes one image per page: staff extents in blue, measure
  regions (as stored in the gts file) in red with their number in the
  system. Check these to review the result at a glance.
- Pages without any staff system (e.g. a printed lyrics/chord sheet) are
  logged as a warning and skipped. If no page has a system, nothing is
  written and the exit code is 1.
- `-v` logs the detected bar line positions per system.

## How it works

1. **Render** each page at 3000 px on the long side (pdf.js; in Node with
   `@napi-rs/canvas`).
2. **Ink mask**: adaptive mean threshold; saturated (colored pen) pixels
   are dropped so teacher comments do not disturb detection.
3. **Orientation**: 0° vs 90° by the amount of long horizontal strokes;
   180° when standard staves sit below TABs, or, on TAB-only pages, when
   the printed "TAB" clef is at the right end.
4. **Skew**: the angle (±2°) that makes the staff-line row profile sharpest.
5. **Staff lines**: traced in 8 vertical strips and linked across them, so
   lines bent by paper curvature stay whole (the scans bend by up to one
   line spacing across a page). Lines are grouped into staves by spacing;
   6 lines = TAB, a 5-line staff right above a TAB joins its system.
6. **Bar lines**: vertical strokes covering the TAB from top to bottom
   line, found on a row-contrast mask that keeps faint printed lines. A
   stroke is a stem when most of its columns continue below the TAB (a
   stem right next to a bar line does not count); on staff + TAB paper a
   bar line must also cross the staff, which rejects stems and boxed
   labels.
7. **Measures**: spans between bar lines; spans narrower than 5 line
   spacings (clef area before a start repeat) are merged into a neighbor.
8. **Regions**: a measure spans its bar lines horizontally; vertically,
   each system owns a band that also covers its chord names above and its
   rhythm/lyrics below (the gap between systems is split 35/65 in favor of
   the lower system).

Rendering plus detection takes about 2 s per page in Node.

## Results on the surveyed scores

Checked against the scans by eye (three private PDFs, 16 pages):

| Score | Pages | Orientation | Systems | Measures |
| --- | --- | --- | --- | --- |
| TAB only, hand-drawn bar lines (rotated 90°) | 4 | 4/4 | 16/16 | 65/66: one boundary drawn as a parenthesis `( )` is not a line |
| Staff + TAB, two songs | 7 | 7/7 | 42/42 | 168/168 |
| Chord sheet page + staff + TAB | 5 | 4/4 + chord sheet skipped | 24/24 | 96/96 |

This TypeScript version replaced the original Python/OpenCV prototype
after matching it on these scores and the public-domain samples (same
measure counts, regions within 0.0014 of the page size).
`scripts/compare.ts <pdf>...` re-runs such a comparison against the
`.gts.json` files next to the given PDFs.

Known limits:

- Measure boundaries that are not straight vertical lines (parentheses,
  curved repeat brackets) are not detected.
- On staff + TAB paper, a bar line drawn only through the TAB is ignored
  (the staff-crossing rule trades it for robustness against stems).
- Region coordinates are in the upright page after the 90° rotation; the
  sub-degree deskew is not recorded (well under 1% of the page).

## Tests

`pnpm test` runs synthetic-page tests (rotation, skew, stems, colored pen,
tight system spacing, schema validity of the built document). End-to-end
tests on the committed samples and the CLI live in
[`@guitarmr/samples`](../samples/README.md).
