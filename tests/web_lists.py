"""The lists a strict web reader holds to the server's, read from the web's source.

A strict reader refuses a value its list lacks, and with it the whole answer that
carries it, so a list the server grows without the web's breaks a screen. A test
compares the two through `web_list`.
"""

from __future__ import annotations

import re
from pathlib import Path

#: Where the web's readers of the server's answers live.
WEB_API = Path(__file__).resolve().parents[1] / "web" / "src" / "shared" / "api"


def web_list(path: Path, name: str) -> list[str]:
    """The values of the constant list `name` in `path`, in their order."""

    source = path.read_text(encoding="utf-8")
    _, found, rest = source.partition(f"const {name} = [")
    if not found:
        raise ValueError(f"{path.name} declares no list {name}")
    return re.findall(r"'([a-z_]+)'", rest.split("]", 1)[0])
