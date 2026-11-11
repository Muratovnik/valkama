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

/** The `index.html` this run built, as read from disk, and when it was written. */
export interface BuiltIndex {
  html: string
  writtenAt: number
}

/**
 * Why the app port does not serve the bundle this run has just built, or null when it
 * does. The page names every script and stylesheet by the hash of its content, so the
 * same page is the same bundle; a page written before the run started was left by an
 * earlier one, whatever it says.
 */
export function staleAppReason(
  served: string,
  built: BuiltIndex,
  runStartedAt: number,
): string | null {
  if (built.writtenAt < runStartedAt)
    return `${appBuild}/index.html was written before this run started: the build did not run`
  if (served !== built.html)
    return `port ${appPort} serves a page other than ${appBuild}/index.html: it is not this run's build`
  return null
}
