"""Engrave a gts document onto staff + TAB paper and simulate a scan of it.

Test support only: it draws what the structure, chords, tab and lyrics
layers say (boxed section labels, repeat and final bars, volta brackets,
chord names, fret numbers, stems, lyrics inside the staff) so the
public-domain samples have realistic PDFs, and it returns where it drew
every measure so layout detection can be checked against the truth.

Japanese text needs a CJK font (see find_japanese_font); ASCII-only
documents are drawn with OpenCV's built-in font and need nothing else.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

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
GREEN = (70, 150, 60)
BLUE = (190, 110, 40)
FONT = cv2.FONT_HERSHEY_SIMPLEX

# Tried in order when GTS_JP_FONT is not set.
JAPANESE_FONT_CANDIDATES = [
    "/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf",
    "/usr/share/fonts/truetype/fonts-japanese-gothic.ttf",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
    "/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "C:/Windows/Fonts/meiryo.ttc",
    "C:/Windows/Fonts/msgothic.ttc",
]


class FontNotFound(RuntimeError):
    pass


@dataclass
class EngravedMeasure:
    page: int
    x0: int
    x1: int
    staff_top: int
    tab_bottom: int


@lru_cache(maxsize=1)
def find_japanese_font() -> str | None:
    """Path of a font with Japanese glyphs: $GTS_JP_FONT or a common system font."""
    override = os.environ.get("GTS_JP_FONT")
    if override:
        return override if Path(override).is_file() else None
    return next((p for p in JAPANESE_FONT_CANDIDATES if Path(p).is_file()), None)


def put_text(page: np.ndarray, text: str, x: int, baseline: int, scale: float, color, thickness: int = 2) -> None:
    """Draw text with its baseline at (x, baseline); non-ASCII text uses a CJK font."""
    if text.isascii():
        cv2.putText(page, text, (x, baseline), FONT, scale, color, thickness, cv2.LINE_AA)
        return
    from PIL import Image, ImageDraw, ImageFont

    path = find_japanese_font()
    if path is None:
        raise FontNotFound("no Japanese font found; set GTS_JP_FONT to a .ttf/.ttc/.otf file")
    font = ImageFont.truetype(path, int(scale * 34))
    left, top, right, bottom = font.getbbox(text)
    mask = Image.new("L", (right - left + 2, bottom - top + 2), 0)
    ImageDraw.Draw(mask).text((-left + 1, -top + 1), text, font=font, fill=255)
    alpha = np.asarray(mask, dtype=np.float64)[..., None] / 255
    ascent = font.getmetrics()[0]
    y0, x0 = baseline - ascent + top, x + left
    h = min(alpha.shape[0], page.shape[0] - y0)
    w = min(alpha.shape[1], page.shape[1] - x0)
    region = page[y0 : y0 + h, x0 : x0 + w].astype(np.float64)
    blended = region * (1 - alpha[:h, :w]) + np.array(color, dtype=np.float64) * alpha[:h, :w]
    page[y0 : y0 + h, x0 : x0 + w] = blended.astype(np.uint8)


def text_width(text: str, scale: float, thickness: int = 2) -> int:
    if text.isascii():
        return cv2.getTextSize(text, FONT, scale, thickness)[0][0]
    from PIL import ImageFont

    path = find_japanese_font()
    if path is None:
        raise FontNotFound("no Japanese font found; set GTS_JP_FONT to a .ttf/.ttc/.otf file")
    left, _, right, _ = ImageFont.truetype(path, int(scale * 34)).getbbox(text)
    return right - left


def engrave(document: dict, systems_per_page: int | None = None) -> tuple[list[np.ndarray], list[EngravedMeasure]]:
    """Draw every measure of the document; returns upright pages and truth."""
    measures = [m for section in document["sections"] for m in section["measures"]]
    labels = {section["measures"][0]["id"]: section.get("label") for section in document["sections"]}
    system_height = 4 * SPACING + STAFF_TO_TAB + 5 * SPACING
    per_page = systems_per_page or (HEIGHT - FIRST_SYSTEM_TOP - 200) // (system_height + SYSTEM_GAP) + 1

    pages: list[np.ndarray] = []
    truth: list[EngravedMeasure] = []
    width = (RIGHT - LEFT) / MEASURES_PER_SYSTEM
    for start in range(0, len(measures), MEASURES_PER_SYSTEM):
        system_index = start // MEASURES_PER_SYSTEM
        if system_index % per_page == 0:
            pages.append(_blank_page(document["meta"], first=not pages, number=len(pages) + 1))
        page = pages[-1]
        staff_top = FIRST_SYSTEM_TOP + (system_index % per_page) * (system_height + SYSTEM_GAP)
        tab_top = staff_top + 4 * SPACING + STAFF_TO_TAB
        in_system = measures[start : start + MEASURES_PER_SYSTEM]
        # A shorter last system ends at its last bar line, as on real paper
        # where the rest of the line is left blank or cut off.
        _draw_system_lines(page, staff_top, tab_top, int(LEFT + len(in_system) * width))
        for offset, measure in enumerate(in_system):
            x0 = int(LEFT + offset * width)
            x1 = int(LEFT + (offset + 1) * width)
            _draw_measure(page, measure, labels.get(measure.get("id")), x0, x1, staff_top, tab_top, offset == 0)
            truth.append(EngravedMeasure(len(pages) - 1, x0, x1, staff_top, tab_top + 5 * SPACING))
    return pages, truth


def _blank_page(meta: dict, first: bool, number: int) -> np.ndarray:
    page = np.full((HEIGHT, WIDTH, 3), PAPER, np.uint8)
    if number > 1:
        put_text(page, f"No. {number}", RIGHT - 120, 150, 0.9, PENCIL)
    if first:
        title = meta["title"]
        put_text(page, title, (WIDTH - text_width(title, 1.6, 3)) // 2, 180, 1.6, PENCIL, 3)
        if meta.get("artist"):
            put_text(page, meta["artist"], RIGHT - 220, 250, 0.9, PENCIL)
        info = f"Key = {meta.get('key', '?')}  {meta.get('timeSignature', '')}  q = {meta.get('tempo', '')}"
        if meta.get("capo"):
            info += f"  Capo {meta['capo']}"
        put_text(page, info, LEFT, 250, 0.9, PENCIL)
    return page


def _draw_system_lines(page: np.ndarray, staff_top: int, tab_top: int, right: int) -> None:
    for i in range(5):
        y = staff_top + i * SPACING
        cv2.line(page, (LEFT, y), (right, y), PRINT, 2)
    for i in range(6):
        y = tab_top + i * SPACING
        cv2.line(page, (LEFT, y), (right, y), PRINT, 2)
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
            put_text(page, f"x{measure['repeatTimes']}", x1 - 70, staff_top - 20, 1.0, PENCIL)
        content_x1 = x1 - 36
    elif measure.get("barEnd") == "final":
        cv2.line(page, (x1 - 14, staff_top), (x1 - 14, tab_bottom), PENCIL, 2)
        _thick_line(page, x1 - 4, staff_top, tab_bottom)
        content_x1 = x1 - 20

    if label:
        box_w = max(50, text_width(label, 1.2, 3) + 24)
        cv2.rectangle(page, (x0 - 10, staff_top - 140), (x0 - 10 + box_w, staff_top - 88), PENCIL, 2)
        put_text(page, label, x0 - 2, staff_top - 98, 1.2, PENCIL, 3)
    if measure.get("volta"):
        # Above the chord names, below the section label boxes.
        y = staff_top - 112
        cv2.line(page, (x0 + 4, y), (x1 - 12, y), PENCIL, 2)
        cv2.line(page, (x0 + 4, y), (x0 + 4, y + 30), PENCIL, 2)
        put_text(page, ",".join(str(v) for v in measure["volta"]) + ".", x0 + 14, y + 30, 0.9, PENCIL)

    usable = content_x1 - content_x0 - 30

    def beat_x(beat: float) -> int:
        return int(content_x0 + 20 + (beat - 1) / 4 * usable)

    chord_scale = 1.3 if len(measure.get("chords", [])) <= 2 else 0.9
    for chord in measure.get("chords", []):
        put_text(page, chord["symbol"], beat_x(chord.get("beat", 1)), staff_top - 30, chord_scale, PENCIL, 3)

    # Lyrics go inside the empty standard staff, one line per verse, as on
    # the handwritten scores.
    for lyric in measure.get("lyrics", []):
        baseline = staff_top + int((lyric["verse"] * 2 - 0.2) * SPACING)
        put_text(page, lyric["text"], content_x0 + 20, baseline, 0.9, GREEN if lyric["verse"] > 1 else PENCIL)

    beat = 1.0
    for event in measure.get("beats", []):
        x = beat_x(beat)
        for note in event.get("notes", []):
            y = tab_top + (note["string"] - 1) * SPACING
            text = "x" if note.get("dead") else str(note["fret"])
            (w, h), _ = cv2.getTextSize(text, FONT, 0.8, 2)
            cv2.rectangle(page, (x - 2, y - h // 2 - 3), (x + w + 2, y + h // 2 + 3), PAPER, -1)
            cv2.putText(page, text, (x, y + h // 2), FONT, 0.8, PENCIL, 2, cv2.LINE_AA)
        if event.get("rest"):
            # A short rest mark in the middle of the TAB instead of a stem.
            cv2.line(page, (x, tab_top + int(2.5 * SPACING)), (x + 18, tab_top + int(2.5 * SPACING)), PENCIL, 5)
        else:
            # Rhythm stems hang below the TAB, as on the handwritten scores.
            stem_x = x + 6
            cv2.line(page, (stem_x, tab_bottom + 10), (stem_x, tab_bottom + 55), PENCIL, 2)
            if event["duration"]["value"] >= 8:
                cv2.line(page, (stem_x, tab_bottom + 55), (stem_x + 25, tab_bottom + 55), PENCIL, 4)
        if event.get("fermata"):
            cv2.ellipse(page, (x + 8, staff_top - 8), (16, 12), 0, 180, 360, PENCIL, 2)
            cv2.circle(page, (x + 8, staff_top - 10), 3, PENCIL, -1)
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


def add_japanese_teacher_notes(page: np.ndarray) -> np.ndarray:
    """Japanese comments in red, green and blue pen, like the real scores."""
    page = page.copy()
    tab_top = FIRST_SYSTEM_TOP + 4 * SPACING + STAFF_TO_TAB
    put_text(page, "ゆっくり、しっとり", 1250, 330, 1.1, RED, 3)
    put_text(page, "ここは弦を押さえたまま", 600, tab_top + 5 * SPACING + 95, 0.8, BLUE)
    put_text(page, "2番は小さく", 1450, FIRST_SYSTEM_TOP + 4 * SPACING + 60, 0.8, GREEN)
    cv2.line(page, (1080, tab_top - 25), (1090, tab_top + 5 * SPACING + 25), RED, 3)
    cv2.arrowedLine(page, (300, tab_top + 5 * SPACING + 120), (300, tab_top + 5 * SPACING + 70), BLUE, 3)
    return page


def simulate_scan(page: np.ndarray, rotation: int = 90, skew: float = 0.4, seed: int = 0) -> np.ndarray:
    """Blur, noise, a small skew and a turn by `rotation` degrees, like a scan.

    `rotation` is how far the paper was turned counter-clockwise on the
    scanner, so layout detection should report it back as the clockwise
    correction (90 -> 90, 180 -> 180).
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
