import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { python } from './browser/serverStore.ts'

/**
 * The machine's heavy-test lock, `tests/machine_lock.py`, as the web runners take it: the whole
 * browser suite (`tests/browser/allowedRun.ts`) and the Vitest suite (`tests/unitRun.ts`). The
 * Python side owns the lock and its one protocol; these only start a command through it.
 */

const lockScript = fileURLToPath(new URL('../../tests/machine_lock.py', import.meta.url))

/**
 * `command` as run holding the heavy-test lock for `run`: the Python side waits, says for whom,
 * runs the command and gives the lock back when it ends. `lockFile` stands in for the machine's
 * lock, for a test.
 */
export function lockedCommand(
  run: string,
  command: readonly string[],
  lockFile?: string,
): string[] {
  const path = lockFile === undefined ? [] : [`--path=${lockFile}`]
  return [
    python,
    lockScript,
    'run',
    `--run=${run}`,
    `--pid=${process.pid}`,
    ...path,
    '--',
    ...command,
  ]
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
