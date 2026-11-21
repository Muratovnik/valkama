import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { python } from './browser/serverStore.ts'

/**
 * The machine's heavy-test gate, `tests/machine_lock.py`, as the web runners go through it: the
 * whole browser suite (`tests/browser/allowedRun.ts`) and the Vitest suite (`tests/unitRun.ts`),
 * each declaring the CPUs it needs. The Python side owns the gate and its one protocol; these
 * only start a command through it.
 */

const lockScript = fileURLToPath(new URL('../../tests/machine_lock.py', import.meta.url))

/** What a run tells the gate besides its name. */
interface GateOptions {
  /** The logical CPUs the run needs; without it, the whole machine, so it goes alone. */
  cpus?: number
  /** Stands in for the machine's lock, for a test. */
  lockFile?: string
}

/**
 * `command` as run holding a place at the heavy-test gate for `run`: the Python side waits
 * until the run fits, says why it waits, runs the command and gives the place back when it ends.
 */
export function lockedCommand(
  run: string,
  command: readonly string[],
  { cpus, lockFile }: GateOptions = {},
): string[] {
  return [
    python,
    lockScript,
    'run',
    `--run=${run}`,
    ...(cpus === undefined ? [] : [`--cpus=${cpus}`]),
    `--pid=${process.pid}`,
    ...pathOption(lockFile),
    '--',
    ...command,
  ]
}

/**
 * For a failed run that took no lock: the line saying who holds the lock as it ends, which the
 * Python side prints, or `''` when it is free, held by this run's own holder, or cannot be asked.
 */
export function lockHolder(lockFile?: string): string {
  const asked = spawnSync(python, [lockScript, 'holder', ...pathOption(lockFile)], {
    encoding: 'utf8',
  })
  return asked.status === 0 ? asked.stdout : ''
}

function pathOption(lockFile: string | undefined): string[] {
  return lockFile === undefined ? [] : [`--path=${lockFile}`]
}

/**
 * Whether the lock can be taken here: the interpreter starts the lock tool and it answers. Not
 * only whether a `python` exists, since on Windows a missing one may be a stub that exits with
 * an error, and a checkout without the tool cannot take the lock either.
 */
export function lockAvailable(): boolean {
  return spawnSync(python, [lockScript, '--help'], { stdio: 'ignore' }).status === 0
}

/** Runs `command` with this process's output and resolves with its exit code. */
export function spawnInherited(
  command: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<number> {
  return new Promise((resolve, reject) => {
    const [program = '', ...args] = command
    const child = spawn(program, args, { ...options, stdio: 'inherit' })
    child.on('error', reject)
    // A code is null only when a signal ended the process, which is a failed run.
    child.on('exit', (code, signal) => resolve(signal ? 1 : Number(code)))
  })
}
