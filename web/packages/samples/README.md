# @guitarmr/samples

Public-domain sample scores used as end-to-end fixtures, and the tools that
make them. The `schemas/examples/*.gts.json` files are committed (the
melodies and lyrics are public domain, the chords and tab are written for
this project). The scanned-looking PDFs they describe are **not**
committed: they are generated deterministically from the songs, by the
tests and by `make-samples`, so no binaries end up in git.

| Sample | Layers | What it exercises |
| --- | --- | --- |
| `twinkle-twinkle` ("Ah! vous dirai-je, maman", 18th c.) | layout, structure, chords, tab | one page scanned sideways (90°), repeat of the whole song, red teacher notes |
| `sakura-sakura` (さくらさくら, Japanese traditional; verse 2 is the 1941 text) | all five, incl. lyrics | two pages (upright, then upside down), two verses of Japanese lyrics inside the staff, 1st/2nd endings, final bar line, a 3-measure last system, minor key, slash/sus4/M7/m7-5 chords, four chords in one measure, an off-beat change, rests, a six-string chord with fermata, Japanese red/green/blue pen notes |

- `src/songs.ts`: the songs as gts documents, from compact melody/chord
  tables (`"A4 B4:8 A4:8 F4:2"`, `"Am E7@2.5"`).
- `src/engrave.ts`: draws a gts document on staff + TAB paper with Canvas
  2D and returns where every measure was drawn.
- `src/scan.ts`: makes a page look scanned (skew, blur, noise, a turn on
  the scanner) and writes a minimal JPEG-based PDF.
- `src/make-samples.ts`: regenerates the files, filling the layout layer
  by running layoutscan on the generated PDF.

`pnpm test` checks the committed gts files (schema, 4/4 beat sums, verses
vs. endings), regenerates each PDF and checks that layoutscan reproduces
the stored layout layer (within 0.003 of the page size; the PDF hash may
differ across platforms) and finds every measure where it was drawn, and
runs the layoutscan CLI end to end.

To get the PDFs (e.g. to try the CLI or open them on the Quest), or to
update the gts files after changing the engraver, a song or the detector
(all samples, or name some):

```sh
cd web
pnpm --filter @guitarmr/samples make-samples [twinkle-twinkle sakura-sakura]
```

This writes `schemas/examples/<name>.pdf` (git-ignored) and
`<name>.gts.json`. The output is deterministic for a given
`@napi-rs/canvas` version and font, so an unchanged setup leaves the gts
files untouched. Japanese text
needs a CJK font: a common system font (IPA Gothic, Noto Sans CJK,
Hiragino, Meiryo) is found automatically, or set
`GTS_JP_FONT=/path/to/font`. Without one, the test that re-engraves the
Japanese sample is skipped; the tests on the committed files still run.
Real (copyrighted) scores stay out of the repository.
