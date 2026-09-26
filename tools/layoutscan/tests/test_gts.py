import json
from pathlib import Path

import jsonschema
import numpy as np

from layoutscan import cli
from layoutscan.detect import analyze_page
from layoutscan.gts import ScannedPage, build_document

from synthetic import standard_page

SCHEMA = json.loads((Path(__file__).parents[3] / "schemas" / "gts.schema.json").read_text())


def scanned_pages():
    page, _ = standard_page()
    layout, _ = analyze_page(page)
    return [ScannedPage(index=0, layout=layout), ScannedPage(index=2, layout=layout)]


def test_If_a_document_is_built_it_should_validate_against_the_gts_schema():
    document = build_document("song.pdf", "0" * 64, scanned_pages())

    jsonschema.validate(document, SCHEMA)
    assert document["meta"] == {"title": "song", "layers": ["layout"]}
    assert document["source"]["pages"] == [{"index": 0, "rotation": 0}, {"index": 2, "rotation": 0}]


def test_If_measures_are_built_they_should_be_numbered_in_written_order():
    document = build_document("song.pdf", "0" * 64, scanned_pages())

    measures = document["sections"][0]["measures"]
    assert [m["id"] for m in measures] == [f"m{i}" for i in range(1, 41)]
    assert [m["region"]["page"] for m in measures] == [0] * 20 + [2] * 20
    first_page = [m["region"]["bbox"] for m in measures[:20]]
    assert first_page == sorted(first_page, key=lambda b: (b[1], b[0]))


def test_If_regions_are_built_they_should_tile_each_system_without_overlap():
    document = build_document("song.pdf", "0" * 64, scanned_pages())

    boxes = [m["region"]["bbox"] for m in document["sections"][0]["measures"][:20]]
    rows = [boxes[i : i + 4] for i in range(0, 20, 4)]
    for row in rows:
        for left, right in zip(row, row[1:]):
            assert left[2] == right[0]  # adjacent measures share the bar line
    for upper, lower in zip(rows, rows[1:]):
        assert upper[0][3] <= lower[0][1]  # system bands do not overlap


def test_If_no_page_has_systems_the_cli_should_fail_without_writing(tmp_path, monkeypatch):
    pdf = tmp_path / "lyrics.pdf"
    pdf.write_bytes(b"%PDF-1.4")
    blank = np.full((3000, 2122, 3), 250, np.uint8)
    monkeypatch.setattr(cli, "render_pages", lambda path: iter([(0, blank)]))

    assert cli.main([str(pdf)]) == 1
    assert not (tmp_path / "lyrics.gts.json").exists()


def test_If_some_pages_have_no_systems_the_cli_should_skip_them(tmp_path, monkeypatch, caplog):
    pdf = tmp_path / "song.pdf"
    pdf.write_bytes(b"%PDF-1.4")
    blank = np.full((3000, 2122, 3), 250, np.uint8)
    page, _ = standard_page()
    monkeypatch.setattr(cli, "render_pages", lambda path: iter([(0, blank), (1, page)]))

    assert cli.main([str(pdf), "--debug-dir", str(tmp_path / "debug")]) == 0

    document = json.loads((tmp_path / "song.gts.json").read_text())
    jsonschema.validate(document, SCHEMA)
    assert document["source"]["pages"] == [{"index": 1, "rotation": 0}]
    assert "page index 0: no staff systems found, skipped" in caplog.text
    assert (tmp_path / "debug" / "song_p1.jpg").exists()
