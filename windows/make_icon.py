"""Render valkama.ico from the same mark as the web favicon.

Stdlib only: an ICO is a directory plus one bottom-up BGRA bitmap per frame, so
no image library is needed for a rounded square and three filled polygons. The
geometry below is the mark's own 96-unit drawing, placed on the same 64-unit
grid the SVG favicon uses, which is what keeps one mark across the tab, the
taskbar, the tray and the installer.

Every frame is rendered from the polygons at its own size. With one 256px image
Windows downscaled it for the 16px tray and the 24px taskbar, and the star blurred
into the tile; a frame drawn at the size it is shown keeps it.

The colours are the tokens from `tokens.css`, copied literally because an ICO
resolves no custom property; `web/scripts/sync-tokens.mjs` rewrites them here.
"""

from __future__ import annotations

import math
import os
import struct

# The sizes Windows asks an icon for: the tray and small icons at 100-200%
# scaling (16, 20, 24, 32), the taskbar and Explorer (24-64), and 256, below
# which electron-builder rejects a Windows icon.
SIZES = (16, 20, 24, 32, 40, 48, 64, 256)
UNIT = 64  # the design grid the SVG favicon uses
CORNER = 14

# --color-gray-900. A primitive step rather than a zone, and deliberately: an OS
# surface keeps a neutral ground when the application's own chrome takes a tint.
BACKGROUND = (0x18, 0x18, 0x18)
# --color-brand-body and --color-brand-accent. Written by sync-tokens; edit tokens.css.
BODY = (0xEC, 0xEC, 0xEC)
ACCENT = (0x08, 0xC5, 0xD5)

# Where the mark sits on the 64-unit grid, matching public/favicon.svg: at three
# quarters of the tile, an eighth in from each side.
MARK_OFFSET = (8.0, 8.0)
MARK_SCALE = 0.5

# The mark, in its own 96-unit drawing space: the path data of BrandMark.vue,
# which is straight lines only, as point lists.
BODY_POLYGONS = [
    [(48.0, 94.0), (59.0, 72.0), (24.0, 2.0), (2.0, 2.0)],
]
ACCENT_POLYGONS = [
    [(62.91, 64.17), (73.0, 44.0), (52.83, 44.0)],
    [
        (75.0, 0.0),
        (79.65, 13.35),
        (90.5, 18.0),
        (79.65, 22.65),
        (75.0, 36.0),
        (70.35, 22.65),
        (59.5, 18.0),
        (70.35, 13.35),
    ],
]

# Coverage is exact along a row and sampled down a column, this many rows per
# pixel. At 16px the star's arms are under a pixel wide, so a few point samples
# per pixel would decide whether an arm exists at all.
ROWS_PER_PIXEL = 16


def _tile_span(y: float) -> tuple[float, float] | None:
    """Where the rounded square covers one row of the grid, or None outside it."""
    if not 0.0 <= y < UNIT:
        return None
    rise = max(CORNER - y, y - (UNIT - CORNER), 0.0)
    inset = CORNER - math.sqrt(max(CORNER * CORNER - rise * rise, 0.0)) if rise else 0.0
    return (inset, UNIT - inset)


def _polygon_spans(y: float, polygon: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Where one polygon covers one row of its own space, by the even-odd rule."""
    crossings = []
    count = len(polygon)
    for index in range(count):
        first_x, first_y = polygon[index]
        second_x, second_y = polygon[(index + 1) % count]
        if (first_y > y) != (second_y > y):
            crossings.append(first_x + (y - first_y) / (second_y - first_y) * (second_x - first_x))
    crossings.sort()
    return list(zip(crossings[::2], crossings[1::2], strict=True))


def _mark_spans(y: float, polygons: list[list[tuple[float, float]]]) -> list[tuple[float, float]]:
    """A group of the mark's polygons on one row of the grid, in grid units."""
    mark_y = (y - MARK_OFFSET[1]) / MARK_SCALE
    return [
        (MARK_OFFSET[0] + left * MARK_SCALE, MARK_OFFSET[0] + right * MARK_SCALE)
        for polygon in polygons
        for left, right in _polygon_spans(mark_y, polygon)
    ]


def _add_coverage(row: list[float], left: float, right: float, weight: float) -> None:
    """Add how much of each pixel a span covers, exactly, scaled by `weight`."""
    left, right = max(left, 0.0), min(right, float(len(row)))
    for pixel in range(int(left), math.ceil(right)):
        covered = min(right, pixel + 1.0) - max(left, float(pixel))
        if covered > 0:
            row[pixel] += covered * weight


def _frame(size: int) -> list[list[tuple[int, int, int, int]]]:
    """One frame as rows of straight-alpha RGBA, top row first."""
    scale = size / UNIT
    weight = 1.0 / ROWS_PER_PIXEL
    frame = []
    for pixel_y in range(size):
        tile = [0.0] * size
        body = [0.0] * size
        accent = [0.0] * size
        for step in range(ROWS_PER_PIXEL):
            y = (pixel_y + (step + 0.5) * weight) / scale
            span = _tile_span(y)
            if span is None:
                continue
            _add_coverage(tile, span[0] * scale, span[1] * scale, weight)
            for left, right in _mark_spans(y, BODY_POLYGONS):
                _add_coverage(body, left * scale, right * scale, weight)
            for left, right in _mark_spans(y, ACCENT_POLYGONS):
                _add_coverage(accent, left * scale, right * scale, weight)
        frame.append([_pixel(tile[x], body[x], accent[x]) for x in range(size)])
    return frame


def _pixel(tile: float, body: float, accent: float) -> tuple[int, int, int, int]:
    """Mix what covers one pixel; the mark lies inside the tile, so the rest is ground."""
    if tile <= 0:
        return (0, 0, 0, 0)
    ground = max(tile - body - accent, 0.0)
    colour = tuple(
        round((BACKGROUND[c] * ground + BODY[c] * body + ACCENT[c] * accent) / tile)
        for c in range(3)
    )
    return (colour[0], colour[1], colour[2], round(255 * min(tile, 1.0)))


def _bitmap(size: int) -> bytes:
    """One frame as an ICO stores it: a BMP header, BGRA bottom-up, then the mask."""
    pixels = b"".join(
        bytes(channel for red, green, blue, alpha in row for channel in (blue, green, red, alpha))
        for row in reversed(_frame(size))
    )
    # The AND mask is one bit per pixel in rows padded to four bytes; all clear,
    # because the alpha channel carries the shape.
    mask = b"\x00" * (((size + 31) // 32) * 4 * size)
    header = struct.pack("<IiiHHIIiiII", 40, size, size * 2, 1, 32, 0, len(pixels), 0, 0, 0, 0)
    return header + pixels + mask


def build() -> bytes:
    images = [_bitmap(size) for size in SIZES]
    directory = struct.pack("<HHH", 0, 1, len(images))
    offset = len(directory) + 16 * len(images)
    for size, image in zip(SIZES, images, strict=True):
        # A 256-wide image is written as 0 in its directory entry, which is the
        # documented escape for "256" in a single byte.
        directory += struct.pack(
            "<BBBBHHII", size % 256, size % 256, 0, 0, 1, 32, len(image), offset
        )
        offset += len(image)
    return directory + b"".join(images)


if __name__ == "__main__":
    target = os.path.join(os.path.dirname(os.path.abspath(__file__)), "valkama.ico")
    with open(target, "wb") as file:
        file.write(build())
    frames = ", ".join(str(size) for size in SIZES)
    print(f"wrote {target} ({os.path.getsize(target)} bytes, frames {frames})")
