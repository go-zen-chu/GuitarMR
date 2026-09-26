"""Build the `layout` layer of a gts document from detected page layouts."""

from __future__ import annotations

from dataclasses import dataclass

from .detect import PageLayout, System, measure_spans


@dataclass
class ScannedPage:
    index: int  # 0-based page index in the PDF
    layout: PageLayout


# Share of the gap between two systems given to the upper one. Chord names
# sit just above their own system, while the space right below a system holds
# its rhythm, stroke arrows and lyrics, which take less room.
UPPER_SHARE = 0.35


def system_bands(systems: list[System], page_height: int) -> list[tuple[float, float]]:
    """Vertical band (y0, y1) owned by each system, top to bottom.

    Each gap between two systems is split between them (see UPPER_SHARE), so
    a band also holds the chord names above and the rhythm/lyrics below its
    staves. The outer edges of the first and last systems mirror their inner
    gap.
    """
    if not systems:
        return []
    tops = [min(s.top_at(s.left), s.top_at(s.right), s.top) for s in systems]
    bottoms = [max(s.bottom_at(s.left), s.bottom_at(s.right), s.bottom) for s in systems]
    gaps = [tops[i + 1] - bottoms[i] for i in range(len(systems) - 1)] or [6 * systems[0].spacing]
    bands = []
    for i in range(len(systems)):
        above = gaps[i - 1] if i > 0 else gaps[0]
        below = gaps[i] if i < len(systems) - 1 else gaps[-1]
        y0 = max(tops[i] - (1 - UPPER_SHARE) * above, 0.0)
        y1 = min(bottoms[i] + UPPER_SHARE * below, float(page_height))
        bands.append((y0, y1))
    return bands


def build_document(pdf_name: str, sha256: str, pages: list[ScannedPage]) -> dict:
    """A gts document with only the layout layer filled.

    Pages without systems are expected to be filtered out by the caller.
    Measures are numbered m1, m2, ... in written order (page, system, left to
    right) and all go into one unlabeled section until the structure layer
    adds rehearsal marks.
    """
    measures: list[dict] = []
    for page in pages:
        layout = page.layout
        bands = system_bands(layout.systems, layout.height)
        for system, (y0, y1) in zip(layout.systems, bands):
            for x0, x1 in measure_spans(system):
                measures.append(
                    {
                        "id": f"m{len(measures) + 1}",
                        "region": {
                            "page": page.index,
                            "bbox": [
                                _norm(x0, layout.width),
                                _norm(y0, layout.height),
                                _norm(x1, layout.width),
                                _norm(y1, layout.height),
                            ],
                        },
                    }
                )
    title = pdf_name.rsplit(".", 1)[0]
    return {
        "format": "gts",
        "version": "0.1",
        "meta": {"title": title, "layers": ["layout"]},
        "source": {
            "file": pdf_name,
            "sha256": sha256,
            "pages": [{"index": p.index, "rotation": p.layout.rotation} for p in pages],
        },
        "sections": [{"measures": measures}],
    }


def _norm(value: float, size: int) -> float:
    return round(min(max(value / size, 0.0), 1.0), 4)
