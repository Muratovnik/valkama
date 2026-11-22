import { existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { runShots } from './browserRun.ts'
import { keptCount, keptRuns, removeStaleRuns, runName, shotRunVariable } from './keptShots.ts'

const web = fileURLToPath(new URL('../..', import.meta.url))

/**
 * Names this run's directory of kept files in `shotRunVariable` before any worker starts, so
 * every worker keeps into the same one, and removes the runs of this port past the newest
 * ten. At the end it says where the run's files are, when it kept any.
 */
export default function keepThisRunsShots(): () => void {
  const root = join(web, runShots)
  const run = join(root, runName(new Date()))
  process.env[shotRunVariable] = run
  removeStaleRuns(root, keptRuns - 1)
  return () => {
    if (existsSync(run))
      process.stdout.write(
        `Kept ${keptCount(run)} shots and attachments in ${relative(web, run)}\n`,
      )
  }
}
