# layoutscan

Extracts the `layout` layer of a [gts](../../schemas/gts.schema.json) file
from a scanned guitar score PDF: page orientation, systems (TAB, optionally
with a standard staff above) and the region of every measure, in written
order. Design context: [docs/design/tab-digitization.md](../../docs/design/tab-digitization.md).

Everything is classic image processing (OpenCV); no network or LLM is used,
and the same PDF always gives the same result.

## Usage

Requires Python 3.11+ and [uv](https://docs.astral.sh/uv/).

```sh
cd tools/layoutscan
uv run layoutscan path/to/song.pdf --debug-dir debug/
```

- Writes `path/to/song.gts.json` next to the PDF (`-o` to choose another path).
- `--debug-dir` writes one image per page: staff extents in blue, measure
  regions (as stored in the gts file) in red with their number in the system.
  Check these to review the result at a glance.
- Pages without any staff system (e.g. a printed lyrics/chord sheet) are
  logged as a warning and skipped. If no page has a system, nothing is
  written and the exit code is 1.
- `-v` logs the detected bar line positions per system.

## How it works

1. **Render** each page at 3000 px on the long side (pypdfium2).
2. **Ink mask**: adaptive threshold; saturated (colored pen) pixels are
   dropped so teacher comments do not disturb detection.
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
   stroke continuing below the TAB is a stem; on staff + TAB paper a bar
   line must also cross the staff, which rejects stems and boxed labels.
7. **Measures**: spans between bar lines; spans narrower than 5 line
   spacings (clef area before a start repeat) are merged into a neighbor.
8. **Regions**: a measure spans its bar lines horizontally; vertically, each
   system owns a band that also covers its chord names above and its
   rhythm/lyrics below (the gap between systems is split 35/65 in favor of
   the lower system).

## Results on the surveyed scores

Checked against the scans by eye (three PDFs, 16 pages):

| Score | Pages | Orientation | Systems | Measures |
| --- | --- | --- | --- | --- |
| TAB only, hand-drawn bar lines (4 pages, rotated 90°) | 4 | 4/4 | 16/16 | 65/66: one boundary drawn as a parenthesis `( )` is not a line |
| Staff + TAB, two songs (7 pages) | 7 | 7/7 | 42/42 | 168/168 |
| Chord sheet page + staff + TAB (5 pages) | 5 | 4/4 + chord sheet skipped | 24/24 | 96/96 |

Known limits:

- Measure boundaries that are not straight vertical lines (parentheses,
  curved repeat brackets) are not detected.
- On staff + TAB paper, a bar line drawn only through the TAB is ignored
  (the staff-crossing rule trades it for robustness against stems).
- Region coordinates are in the upright page after the 90° rotation; the
  sub-degree deskew is not recorded (well under 1% of the page).

## Tests

```sh
uv run --group dev pytest
```

The tests draw synthetic staff paper (rotated, skewed, upside down, with
stems and colored pen) and also validate the output against the gts schema.

### Public-domain sample

`schemas/examples/twinkle-twinkle.pdf` and `.gts.json` are an end-to-end
fixture that may be committed: "Twinkle, Twinkle, Little Star" (melody "Ah!
vous dirai-je, maman", 18th century, public domain) with chords and tab
written for this project. The gts file holds all four layers; the PDF is
engraved from it on staff + TAB paper and made to look like a sideways,
slightly skewed scan with red teacher notes. `tests/test_twinkle.py` checks
that the committed files agree (PDF hash, 4/4 beat sums) and that
layoutscan reproduces the stored layout layer and finds every measure where
it was drawn.

Regenerate both files after changing the engraver or the detector:

```sh
uv run python tests/make_twinkle_sample.py
```

The output is deterministic for a given OpenCV version, so an unchanged
detector leaves the files untouched. Real (copyrighted) scores stay out of
the repository.
