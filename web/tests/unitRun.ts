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

/**
 * The pool the whole suite runs in, and the CPUs it declares to the gate. Vitest's own default
 * is every logical CPU but one, which on a 32-CPU machine would ask for nearly all of it, while
 * the suite measured there used 2.6 cores at the median and 7.4 at p95: eight workers is what it
 * uses, and what lets it share the machine with a smaller heavy run.
 */
const suiteWorkers = 8

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
  const start = [
    process.execPath,
    join(web, 'node_modules/vitest/vitest.mjs'),
    'run',
    '--config',
    'vitest.config.ts',
  ]
  const vitest = [...start, ...args]
  if (targeted(args)) return { command: vitest, note: null, targeted: true }
  if (!canLock())
    return {
      command: vitest,
      note: 'No Python here runs tests/machine_lock.py: the Vitest suite runs without the heavy-test lock',
      targeted: false,
    }
  // A pool the caller sized is one this cannot count, so that run asks for the whole machine.
  const sized = args.some((argument) => /^--max-?workers(=|$)/i.test(argument))
  return {
    command: sized
      ? lockedCommand('npm test: the Vitest suite', vitest)
      : lockedCommand(
          'npm test: the Vitest suite',
          [...start, `--maxWorkers=${suiteWorkers}`, ...args],
          { cpus: suiteWorkers },
        ),
    note: null,
    targeted: false,
  }
}

/** What a run asks, starts and says, so a test can stand in for each. */
interface UnitIo {
  canLock: () => boolean
  /** The line naming who holds the lock, or `''`. */
  holder: () => string
  spawn: (command: readonly string[]) => Promise<number>
  write: (text: string) => void
}

/** Runs `npm run test:unit -- <args>` and resolves with the exit code of what it ran. */
export async function runUnits(args: readonly string[], io: UnitIo): Promise<number> {
  const run = unitRun(args, io.canLock)
  if (run.note !== null) io.write(`${run.note}\n`)
  const code = await io.spawn(run.command)
  if (code !== 0 && run.targeted) io.write(io.holder())
  return code
}

const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (entry === import.meta.url) {
  process.exitCode = await runUnits(process.argv.slice(2), {
    canLock: lockAvailable,
    holder: () => lockHolder(),
    spawn: (command) => spawnInherited(command, { cwd: web, env: process.env }),
    write: (text) => process.stdout.write(text),
  })
}
