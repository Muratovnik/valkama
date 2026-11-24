import { availableParallelism } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { lockAvailable, lockedCommand, lockHolder, spawnInherited } from './heavyLock.ts'

/**
 * `npm run test:unit`, the last step of `npm test`: the Vitest suite, run under a lease at the
 * machine's heavy-process gate, through `tests/heavy_gate.py`. Beside a whole browser run the
 * suite fails tests that pass alone, and a run started straight from a shell goes through no other
 * runner that could take the lease for it, so the command takes it itself. The gate gives it K
 * workers, its share of the machine, at most the eight it wants: Vitest runs with `--maxWorkers`
 * K. A run that finds no room exits 75 at once in an agent's session, saying why, and waits
 * elsewhere or with `HEAVY_GATE_WAIT=1`.
 *
 * A targeted run takes no lease: one that names test files, or test names with `-t` or
 * `--testNamePattern`. A word right after an option reads as that option's value, so
 * `--reporter dot` is still the whole suite, and a file named after a flag runs under the lease.
 * Nor does a run where the gate's Python side cannot run; that one says so and runs all the same
 * rather than failing. A targeted run that fails names the heavy runs going as it ends, if any,
 * since another checkout's heavy run may be why it failed.
 *
 *   npm run test:unit                              the whole suite, under a lease
 *   npm run test:unit -- tests/allowedRun.test.ts  one file, without one
 */

/** What runs: the command, a line to say first, if any, and whether it takes no lease by design. */
interface UnitRun {
  command: string[]
  note: string | null
  targeted: boolean
}

const web = fileURLToPath(new URL('..', import.meta.url))

/**
 * The pool the whole suite wants. Vitest's own default is every logical CPU but one, which on a
 * 32-CPU machine would take nearly all of it, while the suite measured there used 2.6 cores at the
 * median and 7.4 at p95: eight workers is what it uses. On a machine of fewer CPUs it is all of
 * them. The gate may give fewer, never fewer than the minimum `.heavy-gate.toml` sets.
 */
const suiteWorkers = 8

/** The gate's kind for the whole suite, as `.heavy-gate.toml` declares it. */
const suiteKind = 'vitest-suite'

/** A pool the caller sized: `--maxWorkers=N` or `--max-workers N`, with where it stands. */
function sizedPool(args: readonly string[]): { at: number; count: string; words: number } | null {
  const at = args.findIndex((argument) => /^--max-?workers(=|$)/i.test(argument))
  if (at < 0) return null
  const argument = args[at] ?? ''
  const joined = argument.includes('=')
  return {
    at,
    count: joined ? argument.slice(argument.indexOf('=') + 1) : (args[at + 1] ?? ''),
    words: joined ? 1 : 2,
  }
}

/** Whether these Vitest arguments narrow the run to some files or some test names. */
function targeted(args: readonly string[]): boolean {
  return args.some((argument, index) => {
    if (argument === '-t' || argument.startsWith('--testNamePattern')) return true
    const previous = args[index - 1]
    const optionValue = previous?.startsWith('-') === true && !previous.includes('=')
    return !argument.startsWith('-') && !optionValue
  })
}

/**
 * What `npm run test:unit -- <args>` runs on a machine of `cpus` logical CPUs; `canLock` is asked
 * only when the lease would be taken.
 */
export function unitRun(
  args: readonly string[],
  canLock: () => boolean,
  cpus: number = availableParallelism(),
): UnitRun {
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
      note: 'No Python here runs tests/heavy_gate.py: the Vitest suite runs without a lease at the heavy-process gate',
      targeted: false,
    }
  // A pool the caller sized in workers is the share it asks for; one given otherwise, such as a
  // percentage, is left as given and asks for the suite's own.
  const sized = sizedPool(args)
  const count = Number(sized?.count)
  if (sized !== null && !(Number.isInteger(count) && count >= 1))
    return {
      command: lockedCommand(suiteKind, vitest, {
        want: Math.max(1, Math.min(suiteWorkers, cpus)),
      }),
      note: null,
      targeted: false,
    }
  const want = sized === null ? Math.max(1, Math.min(suiteWorkers, cpus)) : count
  const rest =
    sized === null
      ? args
      : args.filter((_, index) => index < sized.at || index >= sized.at + sized.words)
  return {
    command: lockedCommand(suiteKind, [...start, '--maxWorkers={k}', ...rest], { want }),
    note: null,
    targeted: false,
  }
}

/** What a run asks, starts and says, so a test can stand in for each. */
interface UnitIo {
  canLock: () => boolean
  /** The line naming the heavy runs going, or `''`. */
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
