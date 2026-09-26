"""Engrave a gts document onto staff + TAB paper and simulate a scan of it.

Test support only: it draws what the structure, chords and tab layers say
(boxed section labels, repeat bars, chord names, fret numbers, stems) so the
public-domain sample has a realistic PDF, and it returns where it drew every
measure so layout detection can be checked against the truth.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

WIDTH, HEIGHT = 2122, 3000
LEFT, RIGHT = 150, 1970
SPACING = 18
FIRST_SYSTEM_TOP = 420
SYSTEM_GAP = 16 * SPACING  # from TAB bottom line to the next staff top line
STAFF_TO_TAB = 5 * SPACING  # from staff bottom line to TAB top line
MEASURES_PER_SYSTEM = 4
CLEF_WIDTH = 70  # room for the "TAB" clef before the first beat

PAPER = (244, 246, 248)
PENCIL = (85, 85, 90)
PRINT = (120, 120, 120)
RED = (50, 50, 215)
FONT = cv2.FONT_HERSHEY_SIMPLEX


@dataclass
class EngravedMeasure:
    page: int
    x0: int
    x1: int
    staff_top: int
    tab_bottom: int


def engrave(document: dict) -> tuple[list[np.ndarray], list[EngravedMeasure]]:
    """Draw every measure of the document; returns upright pages and truth."""
    measures = [m for section in document["sections"] for m in section["measures"]]
    labels = {section["measures"][0]["id"]: section.get("label") for section in document["sections"]}
    system_height = 4 * SPACING + STAFF_TO_TAB + 5 * SPACING
    per_page = (HEIGHT - FIRST_SYSTEM_TOP - 200) // (system_height + SYSTEM_GAP) + 1

    pages: list[np.ndarray] = []
    truth: list[EngravedMeasure] = []
    width = (RIGHT - LEFT) / MEASURES_PER_SYSTEM
    for start in range(0, len(measures), MEASURES_PER_SYSTEM):
        system_index = start // MEASURES_PER_SYSTEM
        if system_index % per_page == 0:
            pages.append(_blank_page(document["meta"], first=not pages))
        page = pages[-1]
        staff_top = FIRST_SYSTEM_TOP + (system_index % per_page) * (system_height + SYSTEM_GAP)
        tab_top = staff_top + 4 * SPACING + STAFF_TO_TAB
        _draw_system_lines(page, staff_top, tab_top)
        for offset, measure in enumerate(measures[start : start + MEASURES_PER_SYSTEM]):
            x0 = int(LEFT + offset * width)
            x1 = int(LEFT + (offset + 1) * width)
            _draw_measure(page, measure, labels.get(measure.get("id")), x0, x1, staff_top, tab_top, offset == 0)
            truth.append(EngravedMeasure(len(pages) - 1, x0, x1, staff_top, tab_top + 5 * SPACING))
    return pages, truth


def _blank_page(meta: dict, first: bool) -> np.ndarray:
    page = np.full((HEIGHT, WIDTH, 3), PAPER, np.uint8)
    if first:
        title = meta["title"]
        size = cv2.getTextSize(title, FONT, 1.6, 3)[0]
        cv2.putText(page, title, ((WIDTH - size[0]) // 2, 180), FONT, 1.6, PENCIL, 3, cv2.LINE_AA)
        if meta.get("artist"):
            cv2.putText(page, meta["artist"], (RIGHT - 220, 250), FONT, 0.9, PENCIL, 2, cv2.LINE_AA)
        info = f"Key = {meta.get('key', '?')}  {meta.get('timeSignature', '')}  q = {meta.get('tempo', '')}"
        cv2.putText(page, info, (LEFT, 250), FONT, 0.9, PENCIL, 2, cv2.LINE_AA)
    return page


def _draw_system_lines(page: np.ndarray, staff_top: int, tab_top: int) -> None:
    for i in range(5):
        y = staff_top + i * SPACING
        cv2.line(page, (LEFT, y), (RIGHT, y), PRINT, 2)
    for i in range(6):
        y = tab_top + i * SPACING
        cv2.line(page, (LEFT, y), (RIGHT, y), PRINT, 2)
    for i, letter in enumerate("TAB"):
        cv2.putText(page, letter, (LEFT + 8, tab_top + 24 + i * 30), FONT, 0.9, (40, 40, 40), 3, cv2.LINE_AA)


def _draw_measure(
    page: np.ndarray,
    measure: dict,
    label: str | None,
    x0: int,
    x1: int,
    staff_top: int,
    tab_top: int,
    first_in_system: bool,
) -> None:
    tab_bottom = tab_top + 5 * SPACING
    for x in (x0, x1):
        cv2.line(page, (x, staff_top), (x, tab_bottom), PRINT, 2)
    content_x0 = x0 + (CLEF_WIDTH if first_in_system else 0)
    if measure.get("barStart") == "repeat-start":
        bar_x = content_x0 + 6
        _thick_line(page, bar_x, staff_top, tab_bottom)
        cv2.line(page, (bar_x + 12, staff_top), (bar_x + 12, tab_bottom), PENCIL, 2)
        _repeat_dots(page, bar_x + 24, tab_top)
        content_x0 = bar_x + 30
    content_x1 = x1
    if measure.get("barEnd") == "repeat-end":
        _thick_line(page, x1 - 6, staff_top, tab_bottom)
        cv2.line(page, (x1 - 18, staff_top), (x1 - 18, tab_bottom), PENCIL, 2)
        _repeat_dots(page, x1 - 30, tab_top)
        if measure.get("repeatTimes"):
            cv2.putText(page, f"x{measure['repeatTimes']}", (x1 - 70, staff_top - 20), FONT, 1.0, PENCIL, 2, cv2.LINE_AA)
        content_x1 = x1 - 36

    if label:
        cv2.rectangle(page, (x0 - 10, staff_top - 140), (x0 + 40, staff_top - 88), PENCIL, 2)
        cv2.putText(page, label, (x0 - 2, staff_top - 98), FONT, 1.2, PENCIL, 3, cv2.LINE_AA)

    usable = content_x1 - content_x0 - 30

    def beat_x(beat: float) -> int:
        return int(content_x0 + 20 + (beat - 1) / 4 * usable)

    for chord in measure.get("chords", []):
        cv2.putText(page, chord["symbol"], (beat_x(chord.get("beat", 1)), staff_top - 30), FONT, 1.3, PENCIL, 3, cv2.LINE_AA)

    beat = 1.0
    for event in measure.get("beats", []):
        x = beat_x(beat)
        for note in event.get("notes", []):
            y = tab_top + (note["string"] - 1) * SPACING
            text = "x" if note.get("dead") else str(note["fret"])
            (w, h), _ = cv2.getTextSize(text, FONT, 0.8, 2)
            cv2.rectangle(page, (x - 2, y - h // 2 - 3), (x + w + 2, y + h // 2 + 3), PAPER, -1)
            cv2.putText(page, text, (x, y + h // 2), FONT, 0.8, PENCIL, 2, cv2.LINE_AA)
        # Rhythm stems hang below the TAB, as on the handwritten scores.
        stem_x = x + 6
        cv2.line(page, (stem_x, tab_bottom + 10), (stem_x, tab_bottom + 55), PENCIL, 2)
        if event["duration"]["value"] >= 8:
            cv2.line(page, (stem_x, tab_bottom + 55), (stem_x + 25, tab_bottom + 55), PENCIL, 4)
        beat += 4 / event["duration"]["value"] * (1.5 if event["duration"].get("dots") else 1)


def _thick_line(page: np.ndarray, x: int, top: int, bottom: int) -> None:
    cv2.rectangle(page, (x - 3, top), (x + 3, bottom), PENCIL, -1)


def _repeat_dots(page: np.ndarray, x: int, tab_top: int) -> None:
    for i in (2, 3):
        cv2.circle(page, (x, int(tab_top + (i - 0.5) * SPACING)), 4, PENCIL, -1)


def add_teacher_notes(page: np.ndarray) -> np.ndarray:
    """Colored pen that layout detection must ignore, crossing a TAB too."""
    page = page.copy()
    cv2.putText(page, "slow & legato!", (1200, 330), FONT, 1.2, RED, 3, cv2.LINE_AA)
    cv2.ellipse(page, (1300, 800), (140, 60), 0, 0, 360, RED, 3)
    tab_top = FIRST_SYSTEM_TOP + 4 * SPACING + STAFF_TO_TAB
    cv2.line(page, (780, tab_top - 20), (790, tab_top + 5 * SPACING + 20), RED, 3)
    return page


def simulate_scan(page: np.ndarray, rotation: int = 90, skew: float = 0.4, seed: int = 0) -> np.ndarray:
    """Blur, noise, a small skew and a 90-degree turn, like a phone/desk scan.

    `rotation` is how far the paper was turned counter-clockwise on the
    scanner, so layout detection should report it back as the clockwise
    correction.
    """
    h, w = page.shape[:2]
    matrix = cv2.getRotationMatrix2D((w / 2, h / 2), skew, 1.0)
    image = cv2.warpAffine(page, matrix, (w, h), borderValue=PAPER)
    image = cv2.GaussianBlur(image, (3, 3), 0.8)
    noise = np.random.default_rng(seed).normal(0, 2.5, image.shape)
    image = np.clip(image.astype(np.float64) + noise, 0, 255).astype(np.uint8)
    return np.ascontiguousarray(np.rot90(image, k=rotation // 90))


def write_pdf(pages: list[np.ndarray], path, quality: int = 80) -> None:
    """Write pages as JPEG images into a minimal PDF (A4 at 72 dpi units)."""
    objects: list[bytes] = []

    def add(obj: bytes) -> int:
        objects.append(obj)
        return len(objects)

    catalog = add(b"")  # filled in once the page tree number is known
    pages_obj = add(b"")
    kids = []
    for image in pages:
        ok, jpeg = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, quality])
        assert ok
        h, w = image.shape[:2]
        pw, ph = (595.28, 841.89) if h >= w else (841.89, 595.28)
        xobject = add(
            b"<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceRGB "
            b"/BitsPerComponent 8 /Filter /DCTDecode /Length %d >>\nstream\n" % (w, h, len(jpeg))
            + jpeg.tobytes()
            + b"\nendstream"
        )
        content = b"q %.2f 0 0 %.2f 0 0 cm /Im0 Do Q" % (pw, ph)
        stream = add(b"<< /Length %d >>\nstream\n" % len(content) + content + b"\nendstream")
        kids.append(
            add(
                b"<< /Type /Page /Parent %d 0 R /MediaBox [0 0 %.2f %.2f] "
                b"/Resources << /XObject << /Im0 %d 0 R >> >> /Contents %d 0 R >>"
                % (pages_obj, pw, ph, xobject, stream)
            )
        )
    objects[catalog - 1] = b"<< /Type /Catalog /Pages %d 0 R >>" % pages_obj
    objects[pages_obj - 1] = b"<< /Type /Pages /Kids [%s] /Count %d >>" % (
        b" ".join(b"%d 0 R" % k for k in kids),
        len(kids),
    )

    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for number, obj in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % number + obj + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    for offset in offsets:
        out += b"%010d 00000 n \n" % offset
    out += b"trailer\n<< /Size %d /Root %d 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, catalog, xref)
    with open(path, "wb") as f:
        f.write(bytes(out))
