/**
 * Where one browser run keeps what it writes. Everything sits under the ignored
 * `test-results/`, in a directory named by the run's harness port, so a run leaves the
 * tracked `dist/` alone and two runs on different ports never share a file.
 */

/** The harness port VALKAMA_BROWSER_PORT names; the built app takes the next one. */
export const harnessPort = Number(process.env.VALKAMA_BROWSER_PORT ?? 4174)

/** The port the built app is served on. */
export const appPort = harnessPort + 1

/** The app's bundle as this run builds and serves it, relative to `web/`. */
export const appBuild = `test-results/${harnessPort}/app`
