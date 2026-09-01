"""Render valkama.ico from the same mark as the web favicon.

Stdlib only: an ICO is a header plus a bottom-up BGRA bitmap, so no image
library is needed for a rounded square, two filled polygons and a spark. The
geometry below is the mark's own 353x306 drawing space, placed on the same
64-unit grid the SVG favicon uses, which is what keeps one mark across the tab,
the taskbar, the tray and the installer.

The gradient is the accent family from `tokens.css`, copied literally because
an ICO resolves no custom property; `web/tests/brandMark.test.ts` fails when
this copy and the tokens drift apart.
"""

from __future__ import annotations

import os
import struct

SIZE = 256  # electron-builder rejects Windows icons smaller than this
UNIT = 64  # the design grid the SVG favicon uses
# --color-gray-900. A primitive step rather than a zone, and deliberately: an OS
# surface keeps a neutral ground when the application's own chrome takes a tint.
# The comment used to say --color-navigation, which this has not equalled for a while.
BACKGROUND = (0x18, 0x18, 0x18)
CORNER = 14
SCALE = SIZE / UNIT

# Where the mark sits on the 64-unit grid, matching public/favicon.svg.
MARK_OFFSET = (9.0, 12.0)
MARK_SCALE = 0.13031

# The mark, in its own drawing space. The two strokes of the V are polygons;
# the spark is the four-pointed star the SVG draws with curves, approximated by
# its eight extreme points because this is rasterized at 256px and below.
STROKE_POLYGONS = [
    [(0.0, 0.0), (88.0, 0.0), (230.0, 239.0), (190.0, 306.0)],
    [(210.0, 175.0), (240.0, 225.0), (339.0, 67.0), (284.0, 67.0)],
]
SPARK_POLYGON = [
    (338.5, 21.0),
    (342.0, 31.5),
    (353.0, 35.0),
    (342.0, 38.5),
    (338.5, 49.0),
    (335.0, 38.5),
    (324.0, 35.0),
    (335.0, 31.5),
]

# --brand-gradient-* and --brand-spark-*, with the gradient vectors the SVG uses.
# The channel triples are written by web/scripts/sync-tokens.mjs; edit tokens.css.
STROKE_GRADIENT = (
    (4.0, 279.0),
    (359.0, 19.0),
    ((0.0, (0xEC, 0xEC, 0xEC)), (0.55, (0xB9, 0xCD, 0xF5)), (1.0, (0x7C, 0xAC, 0xF8))),
)
SPARK_GRADIENT = (
    (324.0, 46.5),
    (353.0, 21.5),
    ((0.0, (0x7C, 0xAC, 0xF8)), (1.0, (0xEC, 0xEC, 0xEC))),
)

# Three subsamples per axis. The mark is all diagonals, and one sample per pixel
# keeps a stepped edge that survives Windows' own downscale to 16px.
SUBSAMPLES = 3


def _inside_rounded_square(x: float, y: float) -> bool:
    edge = UNIT - CORNER
    for corner_x, corner_y in ((CORNER, CORNER), (edge, CORNER), (CORNER, edge), (edge, edge)):
        beyond_x = x < CORNER if corner_x == CORNER else x > edge
        beyond_y = y < CORNER if corner_y == CORNER else y > edge
        if beyond_x and beyond_y:
            return (x - corner_x) ** 2 + (y - corner_y) ** 2 <= CORNER**2
    return True


def _inside_polygon(x: float, y: float, polygon: list[tuple[float, float]]) -> bool:
    """Even-odd crossing test, the rule the SVG fill uses for these shapes."""
    inside = False
    count = len(polygon)
    for index in range(count):
        first_x, first_y = polygon[index]
        second_x, second_y = polygon[(index + 1) % count]
        if (first_y > y) != (second_y > y):
            crossing = first_x + (y - first_y) / (second_y - first_y) * (second_x - first_x)
            if x < crossing:
                inside = not inside
    return inside


def _gradient_colour(
    x: float,
    y: float,
    gradient: tuple[
        tuple[float, float], tuple[float, float], tuple[tuple[float, tuple[int, int, int]], ...]
    ],
) -> tuple[int, int, int]:
    """The colour at one point of a linear gradient, in the mark's own space."""
    (start_x, start_y), (end_x, end_y), stops = gradient
    run_x, run_y = end_x - start_x, end_y - start_y
    length = run_x * run_x + run_y * run_y
    along = 0.0 if length == 0 else ((x - start_x) * run_x + (y - start_y) * run_y) / length
    along = max(0.0, min(1.0, along))
    for index in range(len(stops) - 1):
        left_offset, left_colour = stops[index]
        right_offset, right_colour = stops[index + 1]
        if along <= right_offset or index == len(stops) - 2:
            span = right_offset - left_offset
            ratio = 0.0 if span == 0 else (along - left_offset) / span
            ratio = max(0.0, min(1.0, ratio))
            return tuple(  # type: ignore[return-value]
                round(left_colour[channel] + (right_colour[channel] - left_colour[channel]) * ratio)
                for channel in range(3)
            )
    return stops[-1][1]


def _sample(x: float, y: float) -> tuple[int, int, int] | None:
    """The colour at one point of the design grid, or None outside the icon."""
    if not _inside_rounded_square(x, y):
        return None
    mark_x = (x - MARK_OFFSET[0]) / MARK_SCALE
    mark_y = (y - MARK_OFFSET[1]) / MARK_SCALE
    if _inside_polygon(mark_x, mark_y, SPARK_POLYGON):
        return _gradient_colour(mark_x, mark_y, SPARK_GRADIENT)
    for polygon in STROKE_POLYGONS:
        if _inside_polygon(mark_x, mark_y, polygon):
            return _gradient_colour(mark_x, mark_y, STROKE_GRADIENT)
    return BACKGROUND


def _pixel(pixel_x: int, pixel_y: int) -> tuple[int, int, int, int]:
    step = 1.0 / SUBSAMPLES
    red = green = blue = 0.0
    covered = 0
    for row in range(SUBSAMPLES):
        for column in range(SUBSAMPLES):
            x = (pixel_x + (column + 0.5) * step) / SCALE
            y = (pixel_y + (row + 0.5) * step) / SCALE
            colour = _sample(x, y)
            if colour is None:
                continue
            covered += 1
            red += colour[0]
            green += colour[1]
            blue += colour[2]
    if not covered:
        return (0, 0, 0, 0)
    total = SUBSAMPLES * SUBSAMPLES
    alpha = round(255 * covered / total)
    return (round(blue / covered), round(green / covered), round(red / covered), alpha)


def build() -> bytes:
    # BMP scanlines run bottom-up
    rows = [
        bytes(channel for x in range(SIZE) for channel in _pixel(x, y))
        for y in range(SIZE - 1, -1, -1)
    ]
    pixels = b"".join(rows)
    mask = b"\x00" * (SIZE * SIZE // 8)  # fully opaque, alpha carries the shape
    header = struct.pack("<IiiHHIIiiII", 40, SIZE, SIZE * 2, 1, 32, 0, len(pixels), 0, 0, 0, 0)
    image = header + pixels + mask
    # A 256-wide image is written as 0 in the directory entry, which is the
    # documented escape for "256" in a single byte.
    directory = struct.pack("<HHH", 0, 1, 1) + struct.pack(
        "<BBBBHHII", SIZE % 256, SIZE % 256, 0, 0, 1, 32, len(image), 22
    )
    return directory + image


if __name__ == "__main__":
    target = os.path.join(os.path.dirname(os.path.abspath(__file__)), "valkama.ico")
    with open(target, "wb") as file:
        file.write(build())
    print(f"wrote {target} ({os.path.getsize(target)} bytes, {SIZE}x{SIZE})")
