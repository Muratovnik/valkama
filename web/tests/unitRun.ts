import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { lockAvailable, lockedCommand, lockHolder, spawnInherited } from './heavyLock.ts'

/**
 * `npm run test:unit`, the last step of `npm test`: the Vitest suite, run holding the machine's
 * heavy-test lock, `tests/machine_lock.py`. Beside a whole browser run the suite fails tests that
 * pass alone, and a run started straight from a shell goes through no other runner that could
 * take the lock for it, so the command takes it itself: a second heavy run of any checkout waits
 * for it, and it waits for one, saying whose run it waits for.
 *
 * A targeted run takes no lock: one that names test files, or test names with `-t` or
 * `--testNamePattern`. A word right after an option reads as that option's value, so
 * `--reporter dot` is still the whole suite, and a file named after a flag runs under the lock.
 * Nor does a run where the lock cannot be taken, with no Python to run the lock tool; that one
 * says so and runs all the same rather than failing. A targeted run that fails says who holds
 * the lock as it ends, if anyone, since another checkout's heavy run may be why it failed.
 *
 *   npm run test:unit                              the whole suite, holding the lock
 *   npm run test:unit -- tests/allowedRun.test.ts  one file, without it
 */

/** What runs: the command, a line to say first, if any, and whether it takes no lock by design. */
interface UnitRun {
  command: string[]
  note: string | null
  targeted: boolean
}

const web = fileURLToPath(new URL('..', import.meta.url))

/** Whether these Vitest arguments narrow the run to some files or some test names. */
function targeted(args: readonly string[]): boolean {
  return args.some((argument, index) => {
    if (argument === '-t' || argument.startsWith('--testNamePattern')) return true
    const previous = args[index - 1]
    const optionValue = previous?.startsWith('-') === true && !previous.includes('=')
    return !argument.startsWith('-') && !optionValue
  })
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
  if (targeted(args)) return { command: vitest, note: null, targeted: true }
  if (!canLock())
    return {
      command: vitest,
      note: 'No Python here runs tests/machine_lock.py: the Vitest suite runs without the heavy-test lock',
      targeted: false,
    }
  return {
    command: lockedCommand('npm test: the Vitest suite', vitest),
    note: null,
    targeted: false,
  }
}

const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (entry === import.meta.url) {
  const run = unitRun(process.argv.slice(2), lockAvailable)
  if (run.note !== null) process.stdout.write(`${run.note}\n`)
  const code = await spawnInherited(run.command, { cwd: web, env: process.env })
  if (code !== 0 && run.targeted) process.stdout.write(lockHolder())
  process.exitCode = code
}
