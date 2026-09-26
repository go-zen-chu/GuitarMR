import numpy as np
import pytest

from layoutscan.detect import analyze_page, measure_spans, rotate90

from synthetic import LEFT, RIGHT, SystemSpec, draw_page, skew, standard_page


def measure_counts(layout):
    return [len(measure_spans(s)) for s in layout.systems]


def test_If_the_page_is_upright_it_should_find_every_system_and_measure():
    page, _ = standard_page()

    layout, _ = analyze_page(page)

    assert layout.rotation == 0
    assert measure_counts(layout) == [4] * 5
    assert all(s.staff is not None for s in layout.systems)


def test_If_the_page_is_TAB_only_it_should_find_every_system_and_measure():
    page, _ = standard_page(with_staff=False)

    layout, _ = analyze_page(page)

    assert layout.rotation == 0
    assert measure_counts(layout) == [4] * 5
    assert all(s.staff is None for s in layout.systems)


@pytest.mark.parametrize("with_staff", [True, False])
@pytest.mark.parametrize("scanned_rotation, expected", [(90, 270), (180, 180), (270, 90)])
def test_If_the_page_was_scanned_rotated_it_should_report_the_rotation_back_to_upright(
    with_staff, scanned_rotation, expected
):
    page, _ = standard_page(with_staff)
    scanned = rotate90(page, scanned_rotation)

    layout, upright = analyze_page(scanned)

    assert layout.rotation == expected
    assert upright.shape == page.shape
    assert measure_counts(layout) == [4] * 5


@pytest.mark.parametrize("scanned_rotation, expected", [(0, 0), (180, 180)])
def test_If_systems_are_close_together_it_should_still_pair_each_TAB_with_its_own_staff(
    scanned_rotation, expected
):
    # The next system's staff is within reach below each TAB, but farther
    # than the TAB's own staff above it.
    page, _ = standard_page(gap=7)

    layout, _ = analyze_page(rotate90(page, scanned_rotation))

    assert layout.rotation == expected
    assert len(layout.systems) == 5
    assert all(s.staff is not None for s in layout.systems)
    assert measure_counts(layout) == [4] * 5


def test_If_the_scan_is_slightly_skewed_it_should_still_find_the_measures():
    page, _ = standard_page()

    layout, _ = analyze_page(skew(page, 0.6))

    assert abs(layout.skew + 0.6) <= 0.1
    assert measure_counts(layout) == [4] * 5


def test_If_bar_lines_are_found_they_should_be_at_the_drawn_positions():
    page, specs = standard_page()

    layout, _ = analyze_page(page)

    for system in layout.systems:
        assert system.barlines == pytest.approx(specs[0].barlines, abs=3)
        assert system.left == pytest.approx(LEFT, abs=3)
        assert system.right == pytest.approx(RIGHT, abs=3)


@pytest.mark.parametrize("with_staff", [True, False])
def test_If_note_stems_cross_the_TAB_they_should_not_split_measures(with_staff):
    spec = SystemSpec(top=400, barlines=[1060], with_staff=with_staff, stems=[300, 700, 1300])

    layout, _ = analyze_page(draw_page([spec]))

    assert measure_counts(layout) == [2]


def test_If_colored_pen_crosses_the_TAB_it_should_be_ignored():
    spec = SystemSpec(top=400, barlines=[1060], red_lines=[500, 1500])

    layout, _ = analyze_page(draw_page([spec]))

    assert measure_counts(layout) == [2]


def test_If_the_page_has_no_staff_lines_it_should_report_no_systems():
    page = np.full((3000, 2122, 3), 250, np.uint8)

    layout, _ = analyze_page(page)

    assert layout.systems == []


def test_If_a_start_repeat_follows_the_clef_it_should_not_create_a_tiny_measure():
    spec = SystemSpec(top=400, barlines=[LEFT + 45, LEFT + 52, 1060])

    layout, _ = analyze_page(draw_page([spec]))

    assert measure_counts(layout) == [2]
