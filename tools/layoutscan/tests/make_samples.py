"""Regenerate the public-domain samples in schemas/examples/.

Each sample is a gts file with every layer filled plus the scanned-looking
PDF it describes. The script builds the structure, chords, tab and lyrics
layers from the song tables below, engraves them on staff + TAB paper,
simulates a scan (rotation, skew, colored pen), writes the PDF, then runs
layoutscan on that PDF and stores the detected layout layer and PDF hash.

Songs (melodies and lyrics are public domain; chords and tab are written
for this project):

- twinkle-twinkle: "Twinkle, Twinkle, Little Star", melody "Ah! vous
  dirai-je, maman" (18th century). One page scanned sideways.
- sakura-sakura: 「さくらさくら」, Japanese traditional. Verse 1 is the
  Meiji-era text, verse 2 the 1941 Ministry of Education text (a work
  published under an organization's name, whose protection has expired).
  Two pages, the second scanned upside down; minor key, slash, sus4, M7
  and m7-5 chords, off-beat chord changes, 1st/2nd endings and a short last
  system. Needs a Japanese font (see engrave.find_japanese_font).

Run from tools/layoutscan:  uv run python tests/make_samples.py [name ...]
"""

from __future__ import annotations

import json
import sys
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import numpy as np  # noqa: E402
from engrave import (  # noqa: E402
    add_japanese_teacher_notes,
    add_teacher_notes,
    engrave,
    simulate_scan,
    write_pdf,
)

from layoutscan.detect import analyze_page  # noqa: E402
from layoutscan.gts import ScannedPage, build_document  # noqa: E402
from layoutscan.render import render_pages, sha256_of  # noqa: E402

EXAMPLES = Path(__file__).parents[3] / "schemas" / "examples"

# Notated pitch (guitar notation, an octave above sounding) -> (string, fret)
# in open position.
POSITIONS = {
    "E3": (6, 0),
    "B3": (5, 2),
    "C4": (5, 3),
    "D4": (4, 0),
    "E4": (4, 2),
    "F4": (4, 3),
    "G4": (3, 0),
    "G#4": (3, 1),
    "A4": (3, 2),
    "B4": (2, 0),
    "C5": (2, 1),
    "E5": (1, 0),
}


def beats(melody: str, stroke: str | None = None) -> list[dict]:
    """"A4 B4:8 A4:8 F4:2" -> beats. Default value 4 (quarter); "r" is a rest;
    "E3+B3+E4:1" plays several strings at once; a trailing "^" adds a fermata."""
    result = []
    for token in melody.split():
        fermata = token.endswith("^")
        token = token.rstrip("^")
        pitches, _, value = token.partition(":")
        beat: dict = {"duration": {"value": int(value or 4)}}
        if pitches == "r":
            beat["rest"] = True
        else:
            if stroke:
                beat["stroke"] = stroke
            beat["notes"] = [dict(zip(("string", "fret"), POSITIONS[p])) for p in pitches.split("+")]
        if fermata:
            beat["fermata"] = True
        result.append(beat)
    return result


def chords(spec: str) -> list[dict]:
    """"Am E7@2.5" -> chord symbols; "@beat" defaults to 1, then 3."""
    result = []
    for i, token in enumerate(spec.split()):
        symbol, _, beat = token.partition("@")
        result.append({"symbol": symbol, "beat": float(beat) if beat else 1 + 2 * i})
    for chord in result:
        if chord["beat"] == int(chord["beat"]):
            chord["beat"] = int(chord["beat"])
    return result


def twinkle() -> dict:
    song = [
        ("A", [("C4 C4 G4 G4", "C"), ("A4 A4 G4:2", "F C"), ("F4 F4 E4 E4", "F C"), ("D4 D4 C4:2", "G7 C")]),
        ("B", [("G4 G4 F4 F4", "C F"), ("E4 E4 D4:2", "C G7"), ("G4 G4 F4 F4", "C F"), ("E4 E4 D4:2", "C G7")]),
        ("A'", [("C4 C4 G4 G4", "C"), ("A4 A4 G4:2", "F C"), ("F4 F4 E4 E4", "F C"), ("D4 D4 C4:2", "G7 C")]),
    ]
    sections = []
    for label, bars in song:
        sections.append({"label": label, "measures": [{"chords": chords(c), "beats": beats(m, "down")} for m, c in bars]})
    first, last = sections[0]["measures"][0], sections[-1]["measures"][-1]
    first["barStart"] = "repeat-start"
    last.update({"barEnd": "repeat-end", "repeatTimes": 2})
    meta = {"title": "Twinkle, Twinkle, Little Star", "artist": "Traditional", "key": "C", "capo": 0}
    return _document(meta | {"tempo": 100, "timeSignature": "4/4"}, sections, ["layout", "structure", "chords", "tab"])


def sakura() -> dict:
    # (melody, chords, verse 1, verse 2)
    a = [
        ("A4 A4 B4:2", "Am Esus4", "さくら", "さくら"),
        ("A4 A4 B4:2", "Am E7", "さくら", "さくら"),
        ("A4 B4 C5 B4", "Am Am/G", "やよいの", "のやまも"),
        ("A4 B4:8 A4:8 F4:2", "Dm7 FM7", "そらは", "さとも"),
    ]
    b = [
        ("E4 C4 E4 F4", "Am Dm", "みわたす", "みわたす"),
        ("E4 E4:8 C4:8 B3:2", "E7sus4 E7", "かぎり", "かぎり"),
        ("A4 B4 C5 B4", "Am Am/G", "かすみか", "かすみか"),
        ("A4 B4:8 A4:8 F4:2", "Dm7 FM7", "くもか", "くもか"),
        ("E4 C4 E4 F4", "Am Dm", "においぞ", "あさひに"),
        ("E4 E4:8 C4:8 B3:2", "Esus4 E", "いずる", "におう"),
    ]
    c = [
        ("A4 A4 B4:2", "Am E7@2.5", "いざや", "さくら"),
        ("A4 A4 B4:2", "Am E7", "いざや", "さくら"),
        ("E4 F4 B4:8 A4:8 F4", "C@1 Dm@2 Bm7-5@3 E7@4", "みにゆか", "はなざか"),
    ]
    sections = []
    for label, bars in (("A", a), ("B", b), ("C", c)):
        measures = []
        for melody, chord_spec, verse1, verse2 in bars:
            lyrics = [{"verse": 1, "text": verse1}, {"verse": 2, "text": verse2}]
            measures.append({"chords": chords(chord_spec), "lyrics": lyrics, "beats": beats(melody)})
        sections.append({"label": label, "measures": measures})
    ending = sections[-1]["measures"]
    ending.append(
        {
            "volta": [1],
            "barEnd": "repeat-end",
            "repeatTimes": 2,
            "chords": chords("E7sus4 E7"),
            "lyrics": [{"verse": 1, "text": "ん"}],
            "beats": beats("E4:2 r:2"),
        }
    )
    ending.append(
        {
            "volta": [2],
            "barEnd": "final",
            "chords": chords("E"),
            "lyrics": [{"verse": 2, "text": "り"}],
            "beats": beats("E3+B3+E4+G#4+B4+E5:1^"),
        }
    )
    sections[0]["measures"][0]["barStart"] = "repeat-start"
    meta = {"title": "さくらさくら", "artist": "日本古謡", "key": "Am", "capo": 2, "tempo": 72, "timeSignature": "4/4"}
    return _document(meta, sections, ["layout", "structure", "chords", "tab", "lyrics"])


def _document(meta: dict, sections: list[dict], layers: list[str]) -> dict:
    number = 0
    for section in sections:
        for i, measure in enumerate(section["measures"]):
            number += 1
            section["measures"][i] = {"id": f"m{number}", **measure}
    return {
        "format": "gts",
        "version": "0.1",
        "meta": meta | {"layers": layers},
        "source": {"file": "", "pages": []},
        "sections": sections,
    }


@dataclass
class Sample:
    build: Callable[[], dict]
    # (counter-clockwise turn on the scanner, skew in degrees) per page
    scans: list[tuple[int, float]]
    teacher_notes: Callable[[np.ndarray], np.ndarray]
    systems_per_page: int | None = None


SAMPLES = {
    "twinkle-twinkle": Sample(twinkle, [(90, 0.4)], add_teacher_notes),
    "sakura-sakura": Sample(sakura, [(0, -0.3), (180, 0.5)], add_japanese_teacher_notes, systems_per_page=2),
}


def scan_pages(sample: Sample, document: dict) -> list[np.ndarray]:
    upright, _ = engrave(document, sample.systems_per_page)
    scanned = []
    for i, (page, (rotation, skew)) in enumerate(zip(upright, sample.scans, strict=True)):
        if i == 0:
            page = sample.teacher_notes(page)
        scanned.append(simulate_scan(page, rotation=rotation, skew=skew, seed=i))
    return scanned


MEASURE_KEY_ORDER = ["id", "region", "barStart", "barEnd", "repeatTimes", "volta", "chords", "lyrics", "beats"]


def fill_layout(document: dict, pdf_path: Path) -> dict:
    """Store what layoutscan detects on the PDF as the layout layer."""
    scanned = [ScannedPage(index, analyze_page(image)[0]) for index, image in render_pages(pdf_path)]
    detected = build_document(pdf_path.name, sha256_of(pdf_path), scanned)
    regions = [m["region"] for m in detected["sections"][0]["measures"]]
    measures = [m for s in document["sections"] for m in s["measures"]]
    if len(regions) != len(measures):
        raise SystemExit(f"{pdf_path.name}: layoutscan found {len(regions)} measures, the song has {len(measures)}")
    for measure, region in zip(measures, regions):
        measure["region"] = region
        ordered = {k: measure[k] for k in MEASURE_KEY_ORDER if k in measure}
        assert len(ordered) == len(measure), set(measure) - set(ordered)
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


def main(names: list[str]) -> None:
    for name in names or SAMPLES:
        sample = SAMPLES[name]
        pdf_path = EXAMPLES / f"{name}.pdf"
        document = sample.build()
        write_pdf(scan_pages(sample, document), pdf_path)
        fill_layout(document, pdf_path)
        gts_path = EXAMPLES / f"{name}.gts.json"
        gts_path.write_text(compact_json(document) + "\n", encoding="utf-8")
        print(f"wrote {pdf_path.name} and {gts_path.name}")


if __name__ == "__main__":
    main(sys.argv[1:])
