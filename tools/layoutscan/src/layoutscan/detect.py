"""Pure image analysis: from a rendered page image to systems and measures.

Every function takes and returns plain numpy arrays / dataclasses and does no
I/O, so the whole detection can be tested with synthetic images.

Coordinates are pixels in the "upright" image, i.e. after the page has been
rotated by a multiple of 90 degrees and deskewed.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np

# Pixels whose HSV saturation exceeds this are colored pen, not pencil/print.
COLOR_SATURATION_MIN = 80


@dataclass
class Line:
    """A staff line that may bend slightly (paper curvature), as a polyline."""

    xs: np.ndarray  # anchor x positions, increasing
    ys: np.ndarray  # y at each anchor
    left: int = 0
    right: int = 0

    def y(self, x: float | np.ndarray) -> float | np.ndarray:
        return np.interp(x, self.xs, self.ys)

    @property
    def mid_y(self) -> float:
        return float(np.median(self.ys))


@dataclass
class Staff:
    """A group of evenly spaced lines (5 = standard staff, 6 = TAB)."""

    lines: list[Line]  # top to bottom

    @property
    def left(self) -> int:
        return int(np.median([ln.left for ln in self.lines]))

    @property
    def right(self) -> int:
        return int(np.median([ln.right for ln in self.lines]))

    def top_at(self, x: float) -> float:
        return float(self.lines[0].y(x))

    def bottom_at(self, x: float) -> float:
        return float(self.lines[-1].y(x))

    @property
    def top(self) -> float:
        return self.lines[0].mid_y

    @property
    def bottom(self) -> float:
        return self.lines[-1].mid_y

    @property
    def spacing(self) -> float:
        return float(np.median(np.diff([ln.mid_y for ln in self.lines])))


@dataclass
class System:
    """One line of music: a TAB, optionally with a standard staff above it."""

    tab: Staff
    staff: Staff | None = None
    barlines: list[int] = field(default_factory=list)  # x of inner bar lines

    @property
    def top(self) -> float:
        return self.staff.top if self.staff else self.tab.top

    @property
    def bottom(self) -> float:
        return self.tab.bottom

    def top_at(self, x: float) -> float:
        return self.staff.top_at(x) if self.staff else self.tab.top_at(x)

    def bottom_at(self, x: float) -> float:
        return self.tab.bottom_at(x)

    @property
    def left(self) -> int:
        return self.tab.left

    @property
    def right(self) -> int:
        return self.tab.right

    @property
    def spacing(self) -> float:
        return self.tab.spacing


@dataclass
class PageLayout:
    rotation: int  # clockwise degrees applied to the rendered page
    skew: float  # additional small counter-clockwise correction, degrees
    width: int  # size of the upright image
    height: int
    systems: list[System]


# --------------------------------------------------------------------------
# Ink extraction
# --------------------------------------------------------------------------


def ink_mask(bgr: np.ndarray) -> np.ndarray:
    """Binary mask (255 = ink) of pencil and printed ink; colored pen is dropped.

    An adaptive threshold keeps faint printed staff lines that a global
    threshold loses on light scans.
    """
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    saturation = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)[:, :, 1]
    mask = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY_INV, 31, 12
    )
    mask[saturation > COLOR_SATURATION_MIN] = 0
    return mask


def vertical_ink(bgr: np.ndarray, contrast: int = 20) -> np.ndarray:
    """Mask of strokes darker than the paper to their left and right.

    Compared with `ink_mask`, the background is estimated along the row only,
    so faint printed bar lines between closely spaced TAB lines survive, while
    horizontal lines (dark along the whole row) are excluded.
    """
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    saturation = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)[:, :, 1]
    background = cv2.dilate(gray, cv2.getStructuringElement(cv2.MORPH_RECT, (15, 1)))
    mask = ((background.astype(np.int16) - gray) > contrast).astype(np.uint8) * 255
    mask[saturation > COLOR_SATURATION_MIN] = 0
    return mask


def horizontal_lines(mask: np.ndarray) -> np.ndarray:
    """Keep only long horizontal strokes (staff lines)."""
    bridged = cv2.morphologyEx(
        mask, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (9, 1))
    )
    length = max(mask.shape[1] // 20, 10)
    return cv2.morphologyEx(
        bridged, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (length, 1))
    )


def rotate90(image: np.ndarray, clockwise_degrees: int) -> np.ndarray:
    return np.ascontiguousarray(np.rot90(image, k=-(clockwise_degrees // 90) % 4))


def rotate_small(image: np.ndarray, degrees: float) -> np.ndarray:
    """Rotate counter-clockwise by a small angle around the center, keeping size."""
    if abs(degrees) < 1e-3:
        return image
    h, w = image.shape[:2]
    matrix = cv2.getRotationMatrix2D((w / 2, h / 2), degrees, 1.0)
    return cv2.warpAffine(image, matrix, (w, h), flags=cv2.INTER_NEAREST, borderValue=0)


# --------------------------------------------------------------------------
# Orientation and skew
# --------------------------------------------------------------------------


def line_score(mask: np.ndarray) -> float:
    """Fraction of the image covered by long horizontal strokes."""
    return float((horizontal_lines(mask) > 0).mean())


def estimate_skew(mask: np.ndarray, max_degrees: float = 2.0, step: float = 0.05) -> float:
    """Counter-clockwise angle that makes the staff lines horizontal.

    Chooses the angle maximizing the sharpness (sum of squares) of the row
    profile of the horizontal-line mask, on a downscaled image for speed.
    """
    lines = horizontal_lines(mask)
    scale = 1000 / max(lines.shape)
    small = cv2.resize(lines, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    best_angle, best_score = 0.0, -1.0
    for angle in np.arange(-max_degrees, max_degrees + step / 2, step):
        profile = rotate_small(small, float(angle)).astype(np.float64).sum(axis=1)
        score = float((profile**2).sum())
        if score > best_score:
            best_angle, best_score = float(angle), score
    return round(best_angle, 3)


# --------------------------------------------------------------------------
# Staff lines and systems
# --------------------------------------------------------------------------


def _row_runs(profile: np.ndarray, threshold: float) -> list[float]:
    """Centers of runs of rows whose profile reaches the threshold."""
    on = profile >= threshold
    centers: list[float] = []
    y = 0
    while y < len(on):
        if not on[y]:
            y += 1
            continue
        end = y
        while end < len(on) and on[end]:
            end += 1
        centers.append((y + end - 1) / 2)
        y = end
    return centers


def find_lines(
    lines_mask: np.ndarray, ink: np.ndarray | None = None, strips: int = 8, min_coverage: float = 0.5
) -> list[Line]:
    """Trace staff lines across vertical strips so bent lines stay whole.

    Each strip yields the rows where a line crosses most of it; points of
    neighboring strips are linked into tracks when they are close in y. Only
    tracks spanning at least a third of the page width are kept.
    """
    height, width = lines_mask.shape
    edges = np.linspace(0, width, strips + 1).astype(int)
    points: list[list[float]] = []
    for x0, x1 in zip(edges, edges[1:]):
        profile = (lines_mask[:, x0:x1] > 0).sum(axis=1)
        points.append(_row_runs(profile, min_coverage * (x1 - x0)))

    all_diffs = np.concatenate([np.diff(p) for p in points if len(p) > 1] or [np.array([])])
    if len(all_diffs) == 0:
        return []
    small = np.sort(all_diffs)[: max(1, len(all_diffs) // 2)]
    link_distance = 0.45 * float(np.median(small))

    points = [_merge_close_values(p, link_distance) for p in points]
    tracks: list[list[tuple[float, float]]] = []  # (x, y) anchors
    for i, ys in enumerate(points):
        x = (edges[i] + edges[i + 1]) / 2
        taken: set[int] = set()
        for y in ys:
            best, best_d = None, link_distance
            for t_index, track in enumerate(tracks):
                if t_index in taken or x - track[-1][0] > 3 * (edges[1] - edges[0]):
                    continue
                d = abs(track[-1][1] - y)
                if d < best_d:
                    best, best_d = t_index, d
            if best is None:
                tracks.append([(x, y)])
                taken.add(len(tracks) - 1)
            else:
                tracks[best].append((x, y))
                taken.add(best)

    result: list[Line] = []
    for track in _merge_parallel_tracks(tracks, link_distance):
        xs = np.array([p[0] for p in track])
        ys = np.array([p[1] for p in track])
        line = Line(xs=xs, ys=ys)
        line.left, line.right = _line_extent(lines_mask, line, ink)
        if line.right - line.left >= width / 3:
            result.append(line)
    result.sort(key=lambda ln: ln.mid_y)
    return result


def _merge_close_values(values: list[float], distance: float) -> list[float]:
    """Collapse runs of one thick line that were split into nearby centers."""
    merged: list[list[float]] = []
    for v in sorted(values):
        if merged and v - merged[-1][-1] < distance:
            merged[-1].append(v)
        else:
            merged.append([v])
    return [float(np.mean(g)) for g in merged]


def _merge_parallel_tracks(
    tracks: list[list[tuple[float, float]]], distance: float
) -> list[list[tuple[float, float]]]:
    """Join tracks that follow the same line (e.g. split around a gap)."""
    tracks = sorted(tracks, key=lambda t: float(np.median([p[1] for p in t])))
    merged: list[list[tuple[float, float]]] = []
    for track in tracks:
        if merged:
            prev = merged[-1]
            xs = sorted({p[0] for p in prev} | {p[0] for p in track})
            prev_y = np.interp(xs, [p[0] for p in prev], [p[1] for p in prev])
            this_y = np.interp(xs, [p[0] for p in track], [p[1] for p in track])
            if float(np.median(np.abs(prev_y - this_y))) < distance:
                by_x: dict[float, list[float]] = {}
                for x, y in prev + track:
                    by_x.setdefault(x, []).append(y)
                merged[-1] = [(x, float(np.mean(ys))) for x, ys in sorted(by_x.items())]
                continue
        merged.append(track)
    return merged


def _line_extent(
    lines_mask: np.ndarray, line: Line, ink: np.ndarray | None = None, band: int = 3, max_gap: int = 4
) -> tuple[int, int]:
    """Leftmost and rightmost x of the line.

    The core comes from the long-stroke mask; it is then extended along the
    raw ink, because the ends of staff lines touch the clef letters and short
    pieces there do not survive the long-stroke filter.
    """
    height, width = lines_mask.shape
    xs = np.arange(width)
    ys = np.round(line.y(xs)).astype(int)

    def along(mask: np.ndarray) -> np.ndarray:
        hit = np.zeros(width, dtype=bool)
        for dy in range(-band, band + 1):
            hit |= mask[np.clip(ys + dy, 0, height - 1), xs] > 0
        return hit

    cols = np.where(along(lines_mask))[0]
    if len(cols) == 0:
        return 0, 0
    left, right = int(np.percentile(cols, 0.5)), int(np.percentile(cols, 99.5))
    if ink is not None:
        raw = along(ink)
        left = _extend(raw, left, -1, max_gap)
        right = _extend(raw, right, 1, max_gap)
    return left, right


def _extend(hit: np.ndarray, start: int, step: int, max_gap: int) -> int:
    """Walk from `start` while `hit` stays true, tolerating short gaps."""
    end, gap, x = start, 0, start
    while 0 <= x + step < len(hit):
        x += step
        if hit[x]:
            end, gap = x, 0
        else:
            gap += 1
            if gap > max_gap:
                break
    return end


def group_staves(lines: list[Line]) -> list[Staff]:
    """Group lines into staves of evenly spaced lines."""
    if len(lines) < 2:
        return []
    mids = np.array([ln.mid_y for ln in lines])
    diffs = np.diff(mids)
    spacing = float(np.median(np.sort(diffs)[: max(1, len(diffs) // 2)]))
    groups: list[list[Line]] = [[lines[0]]]
    for line, gap in zip(lines[1:], diffs):
        if gap < 1.6 * spacing:
            groups[-1].append(line)
        else:
            groups.append([line])
    return [Staff(lines=_clean_group(g)) for g in groups if len(_clean_group(g)) >= 4]


def _clean_group(group: list[Line]) -> list[Line]:
    """Drop stray strokes (long beams, underlines) caught in a staff group.

    Staff lines of one staff share their extent, so clearly shorter lines are
    removed; if more than six remain, the six most evenly spaced are kept.
    """
    longest = max(ln.right - ln.left for ln in group)
    lines = [ln for ln in group if ln.right - ln.left >= 0.7 * longest]
    if len(lines) <= 6:
        return lines
    best, best_var = lines[:6], float("inf")
    for i in range(len(lines) - 5):
        window = lines[i : i + 6]
        var = float(np.var(np.diff([ln.mid_y for ln in window])))
        if var < best_var:
            best, best_var = window, var
    return best


def build_systems(staves: list[Staff]) -> tuple[list[System], bool]:
    """Pair each TAB with its own standard staff.

    A TAB's own staff is the nearer of the 5-line staves directly above and
    below it (the gap to the neighboring system is larger than the gap
    inside a system). Returns the systems and whether the page looks upside
    down, i.e. most TABs have their own staff below them.
    """
    systems: list[System] = []
    above = below = 0
    used: set[int] = set()
    for i, st in enumerate(staves):
        if len(st.lines) != 6:
            continue
        system = System(tab=st)
        limit = 12 * st.spacing
        gap_above = st.top - staves[i - 1].bottom if i > 0 and len(staves[i - 1].lines) == 5 else None
        gap_below = (
            staves[i + 1].top - st.bottom if i + 1 < len(staves) and len(staves[i + 1].lines) == 5 else None
        )
        if gap_above is not None and gap_above < limit and (gap_below is None or gap_above <= gap_below):
            system.staff = staves[i - 1]
            used.add(i - 1)
            above += 1
        elif gap_below is not None and gap_below < limit:
            used.add(i + 1)
            below += 1
        systems.append(system)
    # Groups that are neither a TAB nor a staff paired with one: a TAB with a
    # missed line. Keep them as TABs so their measures are not lost.
    for i, st in enumerate(staves):
        if len(st.lines) != 6 and i not in used:
            systems.append(System(tab=st))
    systems.sort(key=lambda s: s.top)
    return systems, below > above


def find_barlines(strokes: np.ndarray, system: System) -> list[int]:
    """x positions of bar lines crossing the whole TAB of a system.

    A bar line covers the TAB from its top to its bottom line and, unlike note
    stems, does not continue past it, except upwards into the standard staff
    of the same system. The TAB edges are followed per column, so bent lines
    are handled. `strokes` is the vertical ink combined with the staff lines,
    so crossing a staff line does not interrupt a bar line.
    """
    s = system.spacing
    if s <= 0:
        return []
    # Tolerate slightly slanted hand-drawn lines by widening strokes first.
    widened = cv2.dilate(strokes, cv2.getStructuringElement(cv2.MORPH_RECT, (5, 1))) > 0
    xs = np.arange(system.left, system.right + 1)
    tops = np.round(system.tab.lines[0].y(xs)).astype(int)
    bottoms = np.round(system.tab.lines[-1].y(xs)).astype(int)
    coverage = np.array(
        [widened[t : b + 1, x].mean() if b > t else 0.0 for x, t, b in zip(xs, tops, bottoms)]
    )
    candidates = xs[coverage >= 0.9]

    accepted: list[int] = []
    for cluster in _clusters(candidates, max_gap=2):
        x = int(round(float(np.mean(cluster))))
        column = widened[:, max(x - 2, 0) : x + 3].any(axis=1)
        tab_top, tab_bottom = system.tab.top_at(x), system.tab.bottom_at(x)
        if _covered(column, tab_bottom + 0.3 * s, tab_bottom + 1.2 * s):
            continue  # continues below the TAB: a stem
        staff = system.staff
        if staff is not None:
            # On staff + TAB paper, bar lines run through both staves; strokes
            # confined to the TAB (stems, boxed labels) are not bar lines.
            # Search a little sideways: printed bar lines are often slightly
            # slanted, so the staff part is offset from the TAB part.
            reach = max(int(0.5 * s), 2)
            if not any(
                _covered(widened[:, xx], staff.top_at(xx), staff.bottom_at(xx))
                for xx in range(max(x - reach, 0), min(x + reach + 1, widened.shape[1]))
            ):
                continue
        elif _covered(column, tab_top - 1.2 * s, tab_top - 0.3 * s):
            continue  # continues above the TAB: a stem
        accepted.append(x)
    edge = 1.5 * s  # the lines closing the system at both ends are not inner bar lines
    return [x for x in _merge_close(accepted, 1.2 * s) if system.left + edge < x < system.right - edge]


def _covered(column: np.ndarray, y0: float, y1: float, ratio: float = 0.6) -> bool:
    """Whether a stroke covers most of the rows y0..y1 of a column."""
    lo, hi = max(int(y0), 0), min(int(y1), len(column) - 1)
    return hi > lo and float(column[lo : hi + 1].mean()) >= ratio


def _clusters(xs: np.ndarray, max_gap: int) -> list[list[int]]:
    clusters: list[list[int]] = []
    for x in xs:
        if clusters and x - clusters[-1][-1] <= max_gap:
            clusters[-1].append(int(x))
        else:
            clusters.append([int(x)])
    return clusters


def _merge_close(xs: list[int], distance: float) -> list[int]:
    """Merge double bar lines and repeat signs into a single boundary."""
    merged: list[list[int]] = []
    for x in sorted(xs):
        if merged and x - merged[-1][-1] <= distance:
            merged[-1].append(x)
        else:
            merged.append([x])
    return [int(round(float(np.mean(g)))) for g in merged]


def measure_spans(system: System, min_width: float = 5.0) -> list[tuple[int, int]]:
    """Horizontal (x0, x1) spans of the measures of a system, left to right.

    Spans narrower than `min_width` staff spacings (e.g. the clef area before
    a start-repeat bar line, or a double bar line split in two) cannot hold a
    measure; they are merged into their neighbor so the regions still cover
    the whole system.
    """
    s = system.spacing
    bounds = _merge_close(sorted([system.left, *system.barlines, system.right]), 1.5 * s)
    bounds[0] = min(bounds[0], system.left)
    bounds[-1] = max(bounds[-1], system.right)
    changed = True
    while changed and len(bounds) > 2:
        changed = False
        widths = np.diff(bounds)
        i = int(np.argmin(widths))
        if widths[i] < min_width * s:
            # Drop the inner bound shared with the narrower neighbor.
            if i == 0:
                del bounds[1]
            elif i == len(widths) - 1:
                del bounds[-2]
            elif widths[i - 1] <= widths[i + 1]:
                del bounds[i]
            else:
                del bounds[i + 1]
            changed = True
    return list(zip(bounds, bounds[1:]))


# --------------------------------------------------------------------------
# Page level
# --------------------------------------------------------------------------


def _detect_upright(mask: np.ndarray) -> tuple[list[System], bool]:
    return build_systems(group_staves(find_lines(horizontal_lines(mask), mask)))


def analyze_page(bgr: np.ndarray) -> tuple[PageLayout, np.ndarray]:
    """Detect orientation, skew, systems and bar lines of a rendered page.

    Returns the layout and the upright (rotated and deskewed) BGR image, which
    callers use for debug overlays. A page without staff lines yields a layout
    with no systems.
    """
    mask = ink_mask(bgr)
    rotation = 0 if line_score(mask) >= line_score(rotate90(mask, 90)) else 90
    mask = rotate90(mask, rotation)
    skew = estimate_skew(mask)
    mask = rotate_small(mask, skew)
    systems, upside_down = _detect_upright(mask)
    if not systems:
        return PageLayout(rotation, skew, mask.shape[1], mask.shape[0], []), rotate90(bgr, rotation)
    if upside_down or (not any(s.staff for s in systems) and _tab_labels_on_right(mask, systems)):
        rotation += 180
        mask = rotate90(mask, 180)
        systems, _ = _detect_upright(mask)
    upright = rotate_small(rotate90(bgr, rotation), skew)
    strokes = cv2.bitwise_or(vertical_ink(upright), horizontal_lines(mask))
    for system in systems:
        system.barlines = find_barlines(strokes, system)
    return PageLayout(rotation % 360, skew, mask.shape[1], mask.shape[0], systems), upright


def _tab_labels_on_right(mask: np.ndarray, systems: list[System]) -> bool:
    """For TAB-only pages: is the printed "TAB" clef at the right end?

    The clef letters sit just inside the left edge of an upright TAB; at the
    right edge there is at most a bar line. Staff lines are removed first.
    """
    content = cv2.subtract(mask, horizontal_lines(mask))
    votes = 0
    for system in systems:
        s = system.spacing
        top, bottom = int(min(system.tab.lines[0].ys)), int(max(system.tab.lines[-1].ys))
        inner = int(0.4 * s)
        width = int(2.5 * s)
        left = content[top:bottom, system.left + inner : system.left + inner + width]
        right = content[top:bottom, system.right - inner - width : system.right - inner]
        votes += 1 if right.mean() > left.mean() else -1
    return votes > 0
