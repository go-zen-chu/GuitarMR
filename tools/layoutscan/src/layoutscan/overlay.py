"""Debug overlays: draw detected systems and measure regions on the page."""

from __future__ import annotations

import cv2
import numpy as np

from .detect import PageLayout, measure_spans
from .gts import system_bands

SYSTEM_COLOR = (255, 0, 0)  # BGR blue: staff/TAB extent
MEASURE_COLOR = (0, 0, 255)  # BGR red: measure region (bbox written to gts)


def draw(upright: np.ndarray, layout: PageLayout) -> np.ndarray:
    image = upright.copy()
    thickness = max(image.shape[0] // 700, 2)
    bands = system_bands(layout.systems, layout.height)
    for system, (y0, y1) in zip(layout.systems, bands):
        cv2.rectangle(
            image,
            (system.left, int(system.top)),
            (system.right, int(system.bottom)),
            SYSTEM_COLOR,
            thickness,
        )
        for number, (x0, x1) in enumerate(measure_spans(system), start=1):
            cv2.rectangle(image, (x0 + thickness, int(y0)), (x1 - thickness, int(y1)), MEASURE_COLOR, thickness)
            cv2.putText(
                image,
                str(number),
                (x0 + 3 * thickness, int(y0) + 12 * thickness),
                cv2.FONT_HERSHEY_SIMPLEX,
                thickness / 2,
                MEASURE_COLOR,
                thickness,
            )
    return image
