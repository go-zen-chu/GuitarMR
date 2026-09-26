"""Regenerate the public-domain sample: schemas/examples/twinkle-twinkle.{pdf,gts.json}.

"Twinkle, Twinkle, Little Star" uses the 18th-century French melody
"Ah! vous dirai-je, maman" (public domain); the chords and tab here are
written for this project. The script

1. builds the structure, chords and tab layers from the melody below,
2. engraves them on staff + TAB paper and simulates a sideways, skewed scan
   with red teacher notes, written as a one-page PDF,
3. runs layoutscan on that PDF and stores the detected layout layer
   (rotation, measure regions) plus the PDF hash in the gts file.

Run from tools/layoutscan:  uv run python tests/make_twinkle_sample.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from engrave import add_teacher_notes, engrave, simulate_scan, write_pdf  # noqa: E402

from layoutscan.detect import analyze_page  # noqa: E402
from layoutscan.gts import ScannedPage, build_document  # noqa: E402
from layoutscan.render import render_pages, sha256_of  # noqa: E402

EXAMPLES = Path(__file__).parents[3] / "schemas" / "examples"
PDF_PATH = EXAMPLES / "twinkle-twinkle.pdf"
GTS_PATH = EXAMPLES / "twinkle-twinkle.gts.json"

# First-position melody notes (string, fret) in C major.
POSITIONS = {"C": (5, 3), "D": (4, 0), "E": (4, 2), "F": (4, 3), "G": (3, 0), "A": (3, 2)}

# (section label, [(melody, chords)]) - melody "C C G G" = quarters, "G-" = half.
SONG = [
    ("A", [("C C G G", ["C"]), ("A A G-", ["F", "C"]), ("F F E E", ["F", "C"]), ("D D C-", ["G7", "C"])]),
    ("B", [("G G F F", ["C", "F"]), ("E E D-", ["C", "G7"]), ("G G F F", ["C", "F"]), ("E E D-", ["C", "G7"])]),
    ("A'", [("C C G G", ["C"]), ("A A G-", ["F", "C"]), ("F F E E", ["F", "C"]), ("D D C-", ["G7", "C"])]),
]


def build_song() -> dict:
    sections = []
    number = 0
    for label, bars in SONG:
        measures = []
        for melody, chords in bars:
            number += 1
            beats = []
            for token in melody.split():
                string, fret = POSITIONS[token[0]]
                value = 2 if token.endswith("-") else 4
                beats.append({"duration": {"value": value}, "stroke": "down", "notes": [{"string": string, "fret": fret}]})
            measure = {
                "id": f"m{number}",
                "chords": [{"symbol": c, "beat": 1 + 2 * i} for i, c in enumerate(chords)],
                "beats": beats,
            }
            measures.append(measure)
        sections.append({"label": label, "measures": measures})
    sections[0]["measures"][0]["barStart"] = "repeat-start"
    last = sections[-1]["measures"][-1]
    last["barEnd"] = "repeat-end"
    last["repeatTimes"] = 2
    return {
        "format": "gts",
        "version": "0.1",
        "meta": {
            "title": "Twinkle, Twinkle, Little Star",
            "artist": "Traditional",
            "key": "C",
            "capo": 0,
            "tempo": 100,
            "timeSignature": "4/4",
            "layers": ["layout", "structure", "chords", "tab"],
        },
        "source": {"file": PDF_PATH.name, "pages": []},
        "sections": sections,
    }


def scan_pages(document: dict) -> list:
    upright, _ = engrave(document)
    return [simulate_scan(add_teacher_notes(page) if i == 0 else page, seed=i) for i, page in enumerate(upright)]


def fill_layout(document: dict, pdf_path: Path) -> dict:
    """Store what layoutscan detects on the PDF as the layout layer."""
    scanned = [ScannedPage(index, analyze_page(image)[0]) for index, image in render_pages(pdf_path)]
    detected = build_document(pdf_path.name, sha256_of(pdf_path), scanned)
    regions = [m["region"] for m in detected["sections"][0]["measures"]]
    measures = [m for s in document["sections"] for m in s["measures"]]
    if len(regions) != len(measures):
        raise SystemExit(f"layoutscan found {len(regions)} measures, the song has {len(measures)}")
    for measure, region in zip(measures, regions):
        measure["region"] = region
        # Stable, readable key order: identity and bars first, content last.
        order = ["id", "region", "barStart", "barEnd", "repeatTimes", "chords", "beats"]
        ordered = {k: measure[k] for k in order if k in measure}
        measure.clear()
        measure.update(ordered)
    document["source"] = detected["source"]
    return document


def compact_json(value, indent: int = 0, width: int = 100) -> str:
    """JSON with small objects/arrays kept on one line."""
    flat = json.dumps(value, ensure_ascii=False)
    if len(flat) + indent <= width or not isinstance(value, (dict, list)) or not value:
        return flat
    pad = " " * (indent + 2)
    if isinstance(value, dict):
        items = [f"{pad}{json.dumps(k)}: {compact_json(v, indent + 2, width)}" for k, v in value.items()]
        return "{\n" + ",\n".join(items) + "\n" + " " * indent + "}"
    items = [pad + compact_json(v, indent + 2, width) for v in value]
    return "[\n" + ",\n".join(items) + "\n" + " " * indent + "]"


def main() -> None:
    document = build_song()
    write_pdf(scan_pages(document), PDF_PATH)
    fill_layout(document, PDF_PATH)
    GTS_PATH.write_text(compact_json(document) + "\n", encoding="utf-8")
    print(f"wrote {PDF_PATH} and {GTS_PATH}")


if __name__ == "__main__":
    main()
