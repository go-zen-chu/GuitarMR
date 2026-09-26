"""Synthetic score pages for tests: staff paper drawn with OpenCV."""

from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np

WIDTH, HEIGHT = 2122, 3000
LEFT, RIGHT = 90, 2030
SPACING = 18
INK = (90, 90, 90)  # pencil / print gray (BGR)
RED = (40, 40, 220)


@dataclass
class SystemSpec:
    top: int  # y of the first line of the system
    barlines: list[int]  # inner bar line x positions
    with_staff: bool = True
    stems: list[int] = field(default_factory=list)  # x of note stems hanging below the TAB
    red_lines: list[int] = field(default_factory=list)  # x of red pen strokes across the TAB


def tab_top(spec: SystemSpec) -> int:
    return spec.top + (4 * SPACING + 5 * SPACING if spec.with_staff else 0)


def draw_page(systems: list[SystemSpec]) -> np.ndarray:
    page = np.full((HEIGHT, WIDTH, 3), 250, np.uint8)
    for spec in systems:
        staff_top = spec.top
        t_top = tab_top(spec)
        t_bottom = t_top + 5 * SPACING
        if spec.with_staff:
            for i in range(5):
                y = staff_top + i * SPACING
                cv2.line(page, (LEFT, y), (RIGHT, y), INK, 2)
        for i in range(6):
            y = t_top + i * SPACING
            cv2.line(page, (LEFT, y), (RIGHT, y), INK, 2)
        # "TAB" clef letters just inside the left edge.
        for i, letter in enumerate("TAB"):
            cv2.putText(page, letter, (LEFT + 8, t_top + 22 + i * 30), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (30, 30, 30), 3)
        top = staff_top if spec.with_staff else t_top
        for x in [LEFT, *spec.barlines, RIGHT]:
            cv2.line(page, (x, top), (x, t_bottom), INK, 2)
        for x in spec.stems:
            # A stem from a note on the top string down to a beam under the TAB.
            cv2.line(page, (x, t_top - 2), (x, t_bottom + 3 * SPACING), INK, 2)
            cv2.line(page, (x, t_bottom + 3 * SPACING), (x + 60, t_bottom + 3 * SPACING), INK, 4)
        for x in spec.red_lines:
            cv2.line(page, (x, t_top - 10), (x, t_bottom + 10), RED, 3)
        # Chord names above the system.
        cv2.putText(page, "Am7", (LEFT + 40, top - 30), cv2.FONT_HERSHEY_SIMPLEX, 1.5, (30, 30, 30), 3)
    return page


def standard_page(with_staff: bool = True, gap: int = 16) -> tuple[np.ndarray, list[SystemSpec]]:
    """Five systems of four measures each, `gap` line spacings apart."""
    height = (4 + 5 + 5) * SPACING if with_staff else 5 * SPACING
    step = height + gap * SPACING
    specs = [
        SystemSpec(top=300 + i * step, barlines=[575, 1060, 1545], with_staff=with_staff)
        for i in range(5)
    ]
    return draw_page(specs), specs


def skew(image: np.ndarray, degrees: float) -> np.ndarray:
    h, w = image.shape[:2]
    matrix = cv2.getRotationMatrix2D((w / 2, h / 2), degrees, 1.0)
    return cv2.warpAffine(image, matrix, (w, h), borderValue=(250, 250, 250))
