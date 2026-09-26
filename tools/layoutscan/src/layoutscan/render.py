"""PDF input: page rendering and file hashing (the only I/O besides the CLI)."""

from __future__ import annotations

import hashlib
from collections.abc import Iterator
from pathlib import Path

import numpy as np
import pypdfium2 as pdfium

# Long side of the rendered page in pixels. Staff lines of scanned A4 pages
# are 1-2 px thick at this size, enough for the morphology in detect.py.
RENDER_LONG_SIDE = 3000


def render_pages(pdf_path: Path, long_side: int = RENDER_LONG_SIDE) -> Iterator[tuple[int, np.ndarray]]:
    """Yield (page index, BGR image) for every page of the PDF."""
    pdf = pdfium.PdfDocument(str(pdf_path))
    try:
        for index in range(len(pdf)):
            page = pdf[index]
            width, height = page.get_size()
            bitmap = page.render(scale=long_side / max(width, height))
            # pypdfium2 renders BGR(A) by default, the order OpenCV expects.
            yield index, np.ascontiguousarray(bitmap.to_numpy()[:, :, :3])
    finally:
        pdf.close()


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()
