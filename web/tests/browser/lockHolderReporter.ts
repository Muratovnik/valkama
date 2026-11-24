import type { FullResult, Reporter } from '@playwright/test/reporter'

import { lockHolder } from '../heavyLock.ts'

/**
 * A reporter beside the configured ones: a browser run that failed names, as it ends, the heavy
 * runs going on the machine, as a failed targeted unittest or Vitest run does. A run of
 * `npx playwright test <file>` outside the gate takes no lease, so another checkout's heavy run
 * may be why it failed. It says nothing when none goes or the run is under a lease itself: the
 * suite runner, `allowedRun.ts`, runs Playwright under one, which marks what it starts.
 *
 * A `--reporter` given on the command line replaces every configured reporter, this one with the
 * rest, so a run given one names no holder. The suite runner gives one.
 */
export default class LockHolderReporter implements Reporter {
  onEnd(result: FullResult): void {
    process.stdout.write(holderLine(result.status, () => lockHolder()))
  }
}

/**
 * What a run that ended as `status` says of the heavy runs going: `holder`'s line for a run that
 * failed or timed out, and nothing for one that passed or was interrupted, without asking.
 */
export function holderLine(status: FullResult['status'], holder: () => string): string {
  return status === 'failed' || status === 'timedout' ? holder() : ''
}
