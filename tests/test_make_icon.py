"""The Windows icon carries a frame for every size Windows shows it at.

`windows/make_icon.py` renders `windows/valkama.ico`; the tray, the taskbar, the
installer and a toast all read that file. The drawing itself is compared with the
web copies in `web/tests/brandMark.test.ts`; this holds the file the generator
writes.
"""

from __future__ import annotations

import importlib.util
import struct
import sys
import unittest
from pathlib import Path
from types import ModuleType

ROOT = Path(__file__).resolve().parents[1]
ICON = ROOT / "windows" / "valkama.ico"


def _load() -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        "valkama_make_icon", ROOT / "windows" / "make_icon.py"
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


make_icon = _load()

# The sizes Windows asks for: the tray and small icons at 100-200% scaling, the
# taskbar and Explorer, and the 256px image electron-builder requires.
REQUIRED = {16, 20, 24, 32, 40, 48, 64, 256}


def frames(data: bytes) -> dict[int, list[list[tuple[int, int, int, int]]]]:
    """Each frame of an ICO as rows of RGBA, top row first, keyed by its size."""
    reserved, kind, count = struct.unpack_from("<HHH", data, 0)
    assert (reserved, kind) == (0, 1), "not an icon file"
    found = {}
    for index in range(count):
        width, height, _, _, _, bits, length, offset = struct.unpack_from(
            "<BBBBHHII", data, 6 + 16 * index
        )
        size = width or 256
        assert (height or 256) == size and bits == 32
        header = struct.unpack_from("<IiiHHIIiiII", data, offset)
        assert header[:5] == (40, size, size * 2, 1, 32), header
        stride = ((size + 31) // 32) * 4
        assert length == 40 + size * size * 4 + stride * size, f"{size}px frame has a wrong length"
        pixels = data[offset + 40 : offset + 40 + size * size * 4]
        rows = []
        for y in range(size - 1, -1, -1):
            line = pixels[y * size * 4 : (y + 1) * size * 4]
            rows.append(
                [(line[x + 2], line[x + 1], line[x], line[x + 3]) for x in range(0, len(line), 4)]
            )
        found[size] = rows
    return found


class IconFileTests(unittest.TestCase):
    def test_the_committed_icon_is_what_the_generator_writes(self) -> None:
        # sync-tokens rewrites the colours in make_icon.py, not the binary, so
        # a palette change that skipped `python windows/make_icon.py` fails here.
        self.assertEqual(make_icon.build(), ICON.read_bytes(), "run: python windows/make_icon.py")

    def test_every_size_windows_asks_for_has_its_own_frame(self) -> None:
        self.assertEqual(REQUIRED, set(frames(ICON.read_bytes())))

    def test_the_tile_corners_are_transparent(self) -> None:
        for size, rows in frames(make_icon.build()).items():
            with self.subTest(size=size):
                for x, y in ((0, 0), (size - 1, 0), (0, size - 1), (size - 1, size - 1)):
                    self.assertLess(rows[y][x][3], 128)


if __name__ == "__main__":
    unittest.main()
