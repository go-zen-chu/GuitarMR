"""Command line entry point: PDF in, gts JSON (layout layer) out."""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

import cv2

from . import overlay
from .detect import analyze_page, measure_spans
from .gts import ScannedPage, build_document
from .render import render_pages, sha256_of

log = logging.getLogger("layoutscan")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="layoutscan",
        description="Detect page orientation, systems and measures of a scanned "
        "guitar score PDF and write the layout layer of a gts file.",
    )
    parser.add_argument("pdf", type=Path, help="input PDF")
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        help="output gts file (default: next to the PDF as <name>.gts.json)",
    )
    parser.add_argument(
        "--debug-dir",
        type=Path,
        help="write one overlay image per page (systems in blue, measure regions in red)",
    )
    parser.add_argument("-v", "--verbose", action="store_true", help="log per-system details")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s %(message)s",
        stream=sys.stderr,
    )
    if not args.pdf.is_file():
        log.error("input not found: %s", args.pdf)
        return 2
    output = args.output or args.pdf.with_suffix(".gts.json")
    if args.debug_dir:
        args.debug_dir.mkdir(parents=True, exist_ok=True)

    scanned: list[ScannedPage] = []
    for index, image in render_pages(args.pdf):
        layout, upright = analyze_page(image)
        if not layout.systems:
            log.warning("page index %d: no staff systems found, skipped", index)
            continue
        counts = [len(measure_spans(s)) for s in layout.systems]
        log.info(
            "page index %d: rotation %d, skew %.2f deg, %d systems, %d measures %s",
            index,
            layout.rotation,
            layout.skew,
            len(layout.systems),
            sum(counts),
            counts,
        )
        for number, system in enumerate(layout.systems, start=1):
            log.debug(
                "page index %d system %d: %s, bar lines at x=%s",
                index,
                number,
                "staff + TAB" if system.staff else "TAB only",
                system.barlines,
            )
        scanned.append(ScannedPage(index=index, layout=layout))
        if args.debug_dir:
            path = args.debug_dir / f"{args.pdf.stem}_p{index}.jpg"
            cv2.imwrite(str(path), overlay.draw(upright, layout))

    if not scanned:
        log.error("no page with staff systems in %s; nothing written", args.pdf)
        return 1
    document = build_document(args.pdf.name, sha256_of(args.pdf), scanned)
    output.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    total = len(document["sections"][0]["measures"])
    log.info("wrote %s (%d pages, %d measures)", output, len(scanned), total)
    return 0


if __name__ == "__main__":
    sys.exit(main())
