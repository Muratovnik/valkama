import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { lockAvailable, lockedCommand, spawnInherited } from './heavyLock.ts'

/**
 * `npm run test:unit`, the last step of `npm test`: the Vitest suite, run holding the machine's
 * heavy-test lock, `tests/machine_lock.py`. Beside a whole browser run the suite fails tests that
 * pass alone, and a run started straight from a shell goes through no other runner that could
 * take the lock for it, so the command takes it itself: a second heavy run of any checkout waits
 * for it, and it waits for one, saying whose run it waits for.
 *
 * A targeted run takes no lock: one that names test files, or test names with `-t` or
 * `--testNamePattern`; an option's value goes after `=` (`--reporter=dot`), or it reads as a file.
 * Nor does a run where the lock cannot be taken, with no Python to run the lock tool; that one
 * says so and runs all the same rather than failing.
 *
 *   npm run test:unit                              the whole suite, holding the lock
 *   npm run test:unit -- tests/allowedRun.test.ts  one file, without it
 */

/** What runs: the command, and a line to say first, if any. */
interface UnitRun {
  command: string[]
  note: string | null
}

const web = fileURLToPath(new URL('..', import.meta.url))

/** Whether these Vitest arguments narrow the run to some files or some test names. */
function targeted(args: readonly string[]): boolean {
  return args.some(
    (argument) =>
      !argument.startsWith('-') || argument === '-t' || argument.startsWith('--testNamePattern'),
  )
}

/** What `npm run test:unit -- <args>` runs; `canLock` is asked only when the lock would be taken. */
export function unitRun(args: readonly string[], canLock: () => boolean): UnitRun {
  const vitest = [
    process.execPath,
    join(web, 'node_modules/vitest/vitest.mjs'),
    'run',
    '--config',
    'vitest.config.ts',
    ...args,
  ]
  if (targeted(args)) return { command: vitest, note: null }
  if (!canLock())
    return {
      command: vitest,
      note: 'No Python here runs tests/machine_lock.py: the Vitest suite runs without the heavy-test lock',
    }
  return { command: lockedCommand('npm test: the Vitest suite', vitest), note: null }
}

if (import.meta.main) {
  const { command, note } = unitRun(process.argv.slice(2), lockAvailable)
  if (note !== null) process.stdout.write(`${note}\n`)
  process.exitCode = await spawnInherited(command, { cwd: web, env: process.env })
}
