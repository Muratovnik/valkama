"""Hand a work item's address to the desktop app installed on this machine.

An agent client's chat keeps a link only for ordinary schemes and opens it in the
default browser, so a click always reaches this listener through a new tab. What can
still go away is the tab: the listener starts the app with the card's route, and
answers a page that closes the tab it was opened in. The surface decides whether a
request may do that; this module knows where the app is and how it is started.
"""

from __future__ import annotations

import base64
import hashlib
import html
import os
import sys

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


__all__ = ["QUESTIONS", "REVEAL_QUESTION", "installed_path", "open_card", "opened_page"]
