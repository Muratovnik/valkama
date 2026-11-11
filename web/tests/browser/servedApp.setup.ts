import { readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { appBuild, appPort, staleAppReason } from './browserRun.ts'

/**
 * Refuses the run before its first spec unless the app port serves the bundle this run
 * has just built. It runs once the servers are up, in the runner's own process, so that
 * process's start is the moment the build has to be newer than.
 */
export default async function servedAppIsThisRunsBuild(): Promise<void> {
  const index = fileURLToPath(new URL(`../../${appBuild}/index.html`, import.meta.url))
  const [html, written] = await Promise.all([readFile(index, 'utf8'), stat(index)])
  const response = await fetch(`http://127.0.0.1:${appPort}/`)
  const reason = staleAppReason(
    await response.text(),
    { html, writtenAt: written.mtimeMs },
    performance.timeOrigin,
  )
  if (reason) throw new Error(reason)
}
