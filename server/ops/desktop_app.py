"""Hand a work item's address to the desktop app installed on this machine.

An agent client's chat keeps a link only for ordinary schemes and opens it in the
default browser, so a click always reaches this listener through a new tab. What can
still go away is the tab: the listener starts the app with the card's route, and
answers a page that closes the tab it was opened in. The surface decides whether a
request may do that; this module knows where the app is and how it is started.

It also knows what the app was built from. `launcher install` publishes the server
and the web build, but the window is a separate artifact, and its version does not
move with its sources, so an app built long ago reads as current. `packed_sources`
compares the files it packs with the `desktop/` sources of the release the launcher
pins, for `launcher status` and `doctor` to say when the two drifted apart.
"""

from __future__ import annotations

import base64
import fnmatch
import hashlib
import html
import json
import os
import struct
import sys
from pathlib import Path

from .. import processes
from . import configuration

#: The per-user install under `%LOCALAPPDATA%`. `windows/tray.ps1` starts the same file
#: and `windows/install-desktop.ps1` compares its own target with the tray's, so
#: `tests/test_work_item_link.py` reads the tray's default against this one.
_INSTALLED_APP = ("Programs", "valkama-desktop", "Valkama.exe")

#: The argument `desktop/open_path.js` reads. It carries the card's route rather than
#: `/open/<number>`: the app's own navigation carries the same fetch metadata as an
#: address opened from outside, so loading the short address would start the app again.
_OPEN_PATH_SWITCH = "--open-path="

#: The word after `/open/` that names the panel of open questions rather than an item.
#: Every reference ends in `-<number>`, so none can be spelled this way.
QUESTIONS = "questions"

#: The one thing an item's address may ask of the page besides opening the card: to go on
#: to the card's waiting question. The page takes it out of the address as it obeys it.
REVEAL_QUESTION = "reveal=question"

_MESSAGES = {
    "en": {
        "opened": "{reference} opened in the Valkama app",
        "questions": "Questions waiting for your answer opened in the Valkama app",
        "close": "You can close this tab.",
        "here": "Open it here instead",
    },
    "ru": {
        "opened": "{reference} открыта в приложении Valkama",
        "questions": "Вопросы, ждущие вашего ответа, открыты в приложении Valkama",
        "close": "Эту вкладку можно закрыть.",
        "here": "Открыть здесь, в браузере",
    },
}

# The address bar keeps the browser's copy, so a reload, a duplicated tab or a restored
# session shows the card instead of starting the app again. A tab with history of its
# own, or a browser that lets no page close it, stays open and reads as it should.
_SCRIPT = (
    "history.replaceState(null, '', document.querySelector('a').getAttribute('href'));"
    "window.close();"
)

# The literals are written by web/scripts/sync-tokens.mjs from tokens.css: a page that
# loads none of the app's files resolves no custom property of it.
_STYLE = """
:root { color-scheme: dark; --ground: #030405; --text: #ececec; --muted: #c4c4c4; --link: #7cacf8; }
html, body { height: 100%; margin: 0; }
body {
  display: grid; place-items: center; padding: 32px; box-sizing: border-box;
  background: var(--ground); color: var(--text);
  font: 400 14px/1.5 'Segoe UI', system-ui, sans-serif;
}
main { width: min(560px, 100%); display: grid; gap: 12px; }
.brand { margin: 0 0 12px; font-size: 13px; font-weight: 600; color: var(--muted); }
h1 { margin: 0; font-size: 16px; font-weight: 600; line-height: 1.35; }
p { margin: 0; color: var(--muted); }
a { color: var(--link); }
"""


def installed_path() -> str | None:
    """The installed app, or None where this host has none: elsewhere it is never looked for."""

    if sys.platform != "win32":
        return None
    local = os.environ.get("LOCALAPPDATA")
    if not local:
        return None
    found = os.path.join(local, *_INSTALLED_APP)
    return found if os.path.isfile(found) else None


def open_card(location: str, *, port: int) -> bool:
    """Start the app on a card's route; whether it was started.

    A listener on another port than the one the app is told about, such as a second
    `serve --port`, keeps its links to itself: a window that is already open belongs
    to the other listener and would look the route up in the wrong store.

    `ELECTRON_RUN_AS_NODE` goes because a listener may have been started from a VS Code
    terminal, which exports it, and it makes an Electron executable run as plain Node.
    The app's own directory is the working directory, since it can outlive the pinned
    release this process runs from. A child that starts and then fails is not seen here.
    """

    if port != configuration.listener_port():
        return False
    app = installed_path()
    if app is None:
        return False
    environment = {k: v for k, v in os.environ.items() if k != "ELECTRON_RUN_AS_NODE"}
    environment["VALKAMA_PORT"] = str(port)
    try:
        processes.start_detached(
            [app, f"{_OPEN_PATH_SWITCH}{location}"],
            cwd=os.path.dirname(app),
            env=environment,
        )
    except OSError:
        return False
    return True


def _language(accept_language: str | None) -> str:
    """The rule the web app falls back on when it has no stored language."""

    languages = (accept_language or "").split(",")
    return "ru" if any(item.strip().lower().startswith("ru") for item in languages) else "en"


def opened_page(
    reference: str, accept_language: str | None, *, reveal_question: bool = False
) -> tuple[bytes, str]:
    """The page answered for what the app was started on, and its content policy.

    `reference` is an item's reference, or `QUESTIONS` for the panel. `reveal_question`
    says the address asked for the card's question, so opening it here asks the same.
    """

    language = _language(accept_language)
    text = _MESSAGES[language]
    name = html.escape(reference)
    heading = text["questions"] if reference == QUESTIONS else text["opened"].format(reference=name)
    order = html.escape(f"&{REVEAL_QUESTION}") if reveal_question else ""
    page = f"""<!doctype html>
<html lang="{language}">
<head>
<meta charset="utf-8">
<title>Valkama</title>
<style>{_STYLE}</style>
</head>
<body>
<main>
<p class="brand">Valkama</p>
<h1>{heading}</h1>
<p>{text["close"]}</p>
<p><a href="/open/{name}?in=browser{order}">{text["here"]}</a></p>
</main>
<script>{_SCRIPT}</script>
</body>
</html>
"""
    digest = base64.b64encode(hashlib.sha256(_SCRIPT.encode("utf-8")).digest()).decode("ascii")
    policy = f"default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-{digest}'"
    return page.encode("utf-8"), policy


#: The archive electron-builder packs the app's own files into, beside the executable.
_ARCHIVE = ("resources", "app.asar")

#: The keys electron-builder drops from the `package.json` it packs (app-builder-lib's
#: `cleanupPackageJson`, with scripts and keywords removed as it does by default), so the
#: packed manifest is compared with the source one without them.
_BUILD_ONLY_KEYS = frozenset(
    {
        "ava",
        "build",
        "bundleDependencies",
        "contributors",
        "devDependencies",
        "dist",
        "eslintConfig",
        "gitHead",
        "jspm",
        "keywords",
        "nyc",
        "scripts",
        "tags",
        "xo",
    }
)

#: What to do when the app and the release differ, in one wording for both readers.
REINSTALL = (
    "Install the desktop app from the commit the launcher pins: run"
    " `windows/install-desktop.ps1 -Build` in a source checkout at that commit, or run"
    " that release's Valkama-Setup-<version>.exe. If the app is the newer of the two,"
    " `valkama launcher install` from its commit pins the matching release instead."
)


class _UnreadableError(ValueError):
    """An archive or a release whose layout this reading cannot follow."""


def _archive_files(archive: Path) -> dict[str, bytes]:
    """Every file an asar archive holds, by its path inside the archive.

    The format is a header and the files' bytes after it: four bytes saying four, the
    header's length, then the header as a length-prefixed JSON string whose tree gives
    each file's size and its offset from the end of the header. A file kept outside the
    archive (`unpacked`) is read from the `.unpacked` directory beside it.
    """

    data = archive.read_bytes()
    if len(data) < 16:
        raise _UnreadableError("the archive is shorter than its header")
    marker, header_size, _payload, length = struct.unpack_from("<4I", data)
    base = 8 + header_size
    if marker != 4 or 16 + length > base or base > len(data):
        raise _UnreadableError("the archive's header does not fit the file")
    header = json.loads(data[16 : 16 + length].decode("utf-8"))
    unpacked = archive.with_name(archive.name + ".unpacked")
    files: dict[str, bytes] = {}
    pending: list[tuple[str, object]] = [("", header)]
    while pending:
        prefix, node = pending.pop()
        children = node.get("files") if isinstance(node, dict) else None
        if not isinstance(children, dict):
            raise _UnreadableError(f"the archive's entry {prefix or '/'} is not a directory")
        for name, entry in children.items():
            if (
                not isinstance(entry, dict)
                or name in {"", ".", ".."}
                or any(separator in name for separator in "/\\:")
            ):
                raise _UnreadableError(f"the archive holds an entry it cannot name: {prefix}{name}")
            path = f"{prefix}{name}"
            if "files" in entry:
                pending.append((f"{path}/", entry))
                continue
            size, offset = entry.get("size"), entry.get("offset")
            if entry.get("unpacked") is True:
                files[path] = unpacked.joinpath(*path.split("/")).read_bytes()
                continue
            if not isinstance(size, int) or not isinstance(offset, str) or not offset.isdigit():
                raise _UnreadableError(f"the archive does not say where {path} is")
            start = base + int(offset)
            if size < 0 or start + size > len(data):
                raise _UnreadableError(f"the archive's {path} lies past its end")
            files[path] = data[start : start + size]
    return files


def _release_files(release: Path) -> dict[str, bytes]:
    """The `desktop/` files a release's own build configuration says the app packs."""

    desktop = release / "desktop"
    manifest = json.loads((desktop / "package.json").read_bytes().decode("utf-8"))
    build = manifest.get("build") if isinstance(manifest, dict) else None
    patterns = build.get("files") if isinstance(build, dict) else None
    if not isinstance(patterns, list) or not all(isinstance(item, str) for item in patterns):
        raise _UnreadableError("the release's desktop/package.json names no files to pack")
    sources = sorted(
        path.relative_to(desktop).as_posix() for path in desktop.rglob("*") if path.is_file()
    )
    chosen = {"package.json"}
    for pattern in patterns:
        excluded = pattern.startswith("!")
        matched = {path for path in sources if fnmatch.fnmatchcase(path, pattern.lstrip("!"))}
        chosen = chosen - matched if excluded else chosen | matched
    return {path: (desktop / path).read_bytes() for path in chosen}


def _same_manifest(packed: bytes, source: bytes) -> bool:
    """Whether the packed `package.json` is the source one less what the build drops."""

    packed_value = json.loads(packed.decode("utf-8"))
    source_value = json.loads(source.decode("utf-8"))
    if not isinstance(source_value, dict):
        return False
    kept = {
        key: value
        for key, value in source_value.items()
        if key not in _BUILD_ONLY_KEYS and not key.startswith("_")
    }
    return bool(packed_value == kept)


def packed_sources(release: Path | None) -> dict[str, object]:
    """Whether the installed app packs the `desktop/` sources of `release`; reads only.

    The comparison is of the bytes themselves: each file the release's build
    configuration packs against the same path in the archive, and a file on one side
    only is a difference too. `package.json` is the one file the build rewrites, so it
    is compared as JSON without the keys the build drops. The app's version is not
    asked, because it stays the same across changes to everything it packs.

    `state` is `unsupported` off Windows, `absent` with no app installed, `no-release`
    when the launcher pins none, `current`, `differs` (with the paths in `differs`), or
    `unreadable` when either side cannot be read, with the reason in `detail`.
    """

    if sys.platform != "win32":
        return {"state": "unsupported"}
    app = installed_path()
    if app is None:
        return {"state": "absent"}
    reading: dict[str, object] = {"app": app}
    if release is None:
        return {**reading, "state": "no-release", "fix": "Run `valkama launcher install`."}
    reading["release"] = str(release)
    archive = Path(app).parent.joinpath(*_ARCHIVE)
    try:
        packed = _archive_files(archive)
    except (OSError, ValueError) as error:
        detail = f"the app's {archive.name} cannot be read: {error}"
        return {**reading, "state": "unreadable", "detail": detail, "fix": REINSTALL}
    try:
        expected = _release_files(release)
    except (OSError, ValueError) as error:
        detail = f"the release's desktop sources cannot be read: {error}"
        return {**reading, "state": "unreadable", "detail": detail, "fix": REINSTALL}
    differs = []
    for path in sorted(packed.keys() | expected.keys()):
        if path not in packed or path not in expected:
            differs.append(path)
        elif path == "package.json":
            try:
                same = _same_manifest(packed[path], expected[path])
            except ValueError:
                same = False
            if not same:
                differs.append(path)
        elif packed[path] != expected[path]:
            differs.append(path)
    if not differs:
        return {**reading, "state": "current"}
    return {**reading, "state": "differs", "differs": differs, "fix": REINSTALL}


__all__ = [
    "QUESTIONS",
    "REINSTALL",
    "REVEAL_QUESTION",
    "installed_path",
    "open_card",
    "opened_page",
    "packed_sources",
]
