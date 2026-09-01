# Subprocess encoding: why text=True cannot be trusted on Windows

Routed from `AGENTS.md`. Read this before adding a `subprocess.run` anywhere in
this repository.

`test_subprocess_encoding.py` is this repository's vector for the subprocess
boundary of the workspace Unicode contract. On Windows `text=True` cannot make
a decode failure propagate: the read happens in a thread, the exception kills
it, and the stream comes back as `None` with a real exit code, so nothing
raises and nothing is noticed. Without `PYTHONUTF8` the same call decodes by
locale instead and returns mojibake — so the behavior of one line of code
depends on whether an environment variable happens to be set.

`taskkill` writes in the console OEM code page and is where this repository
meets it, so all three of its call sites capture bytes and read only the exit
code; a source guard fails if one of them starts decoding again. The git call
sites go through `processes.run_text` — bytes in, decoded with a named codec
and error policy — and the same guard holds every decoding call to naming both.
Strict decoding is the default; `errors="replace"` is only for text that goes
to a human in diagnostics, never for text that routes a decision, and it earns
a comment saying so.
