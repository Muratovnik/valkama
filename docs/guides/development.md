# Building and development

A clone serves Valkama with no build step, because the built UI is committed.
This guide is for changing the web UI or the desktop app: how to run each from
source and rebuild it. Building either needs Node.js; the version is under
[Requirements](../../README.md#requirements). The gates every change runs, the
commit convention and the architectural rules are in
[`CONTRIBUTING.md`](../../CONTRIBUTING.md).

## Building the web UI

```bash
python valkama.py serve --development-origin http://127.0.0.1:5173
cd web
npm ci
npm run dev      # Vite on :5173, proxying /api to the Python server on :8642
npm run build    # refresh web/dist
```

Vue 3 + Vite + TypeScript. `web/dist` is committed on purpose, so a clone serves
the built UI with no build step — **rebuild and commit it whenever `web/src`
changes.**

`npm run build` is not optional and not last. The server serves the snapshot of
`web/dist` it read at startup, so a browser check against a listener that
predates the build inspects the bundle that build replaced. Rebuild, restart the
listener, *then* verify anything live.

What the Python side serves, and why `--development-origin` takes only that one
origin, is in [Local HTTP security](http-security.md).

## The desktop app

```bash
cd desktop
npm ci
npm start        # run the window from source
npm run dist     # build the installer into release/
```

`release/` is git-ignored — a 90 MB installer does not belong in a repository.
Rebuild and reinstall after changing `desktop/main.js`; UI-only changes just
need `npm run build` in `web/`. Installing the build you made, and removing the
copies an older product name left, is described under
[The desktop app (Windows)](installation.md#the-desktop-app-windows).

> Running `electron` from a VS Code terminal fails with `app is undefined`,
> because VS Code exports `ELECTRON_RUN_AS_NODE=1`. Clear that variable first.
> The installed app is unaffected.

## Checks before a pull request

Every change runs all of [the gates](../../CONTRIBUTING.md#the-gates), from the
repository root. The Python toolchain is pinned in `requirements-dev.txt` and
configured in `pyproject.toml`; none of it is a runtime dependency.
