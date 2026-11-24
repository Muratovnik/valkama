import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { python } from './browser/serverStore.ts'

/**
 * The machine's heavy-process gate as the web runners go through it: the whole browser suite
 * (`tests/browser/allowedRun.ts`) and the Vitest suite (`tests/unitRun.ts`), each as a kind of run
 * `.heavy-gate.toml` declares. The Python side, `tests/heavy_gate.py`, finds the installed gate,
 * runs the command directly where there is none, and keeps earlier branches' runs out; these only
 * start a command through it.
 */

const gateScript = fileURLToPath(new URL('../../tests/heavy_gate.py', import.meta.url))

/** What a run tells the gate besides its kind. */
interface GateOptions {
  /** Stands in for the installed gate's `heavy-gate.json`, for a test. */
  gate?: string
  /** Stands in for the earlier branches' lock, for a test. */
  lockFile?: string
  /** The size of the selection, such as the number of spec files; the gate keeps a profile per size. */
  size?: number
  /** The worker count the run would like; the gate gives it K, which replaces `{k}` in the command. */
  want?: number
}

/**
 * `command` as run under a lease of `kind` at the heavy-process gate: the Python side takes the
 * lease, runs the command and gives the lease back when it ends. With no room it exits 75, saying
 * why, or with `HEAVY_GATE_WAIT=1` waits and says why every minute.
 */
export function lockedCommand(
  kind: string,
  command: readonly string[],
  options: GateOptions = {},
): string[] {
  // An earlier version took the lock file as a string here. Read as options, a string names no
  // file, and the run would take the machine's lock without a word; `npm run test:unit` does
  // not typecheck, so the type alone does not stop it.
  if (typeof (options as unknown) === 'string')
    throw new TypeError('lockedCommand takes { size, want } after the command, not a path')
  const { size, want } = options
  return [
    python,
    gateScript,
    'run',
    `--kind=${kind}`,
    ...(size === undefined ? [] : [`--size=${size}`]),
    ...(want === undefined ? [] : [`--want=${want}`]),
    `--pid=${process.pid}`,
    ...standIns(options),
    '--',
    ...command,
  ]
}

/**
 * For a failed run that took no lease: the line naming the heavy runs going as it ends, which the
 * Python side prints, or `''` when none goes, the run is under a lease itself, or it cannot ask.
 */
export function lockHolder(options: Pick<GateOptions, 'gate' | 'lockFile'> = {}): string {
  const asked = spawnSync(python, [gateScript, 'holder', ...standIns(options)], {
    encoding: 'utf8',
  })
  return asked.status === 0 ? asked.stdout : ''
}

function standIns({ gate, lockFile }: Pick<GateOptions, 'gate' | 'lockFile'>): string[] {
  return [
    ...(lockFile === undefined ? [] : [`--lock=${lockFile}`]),
    ...(gate === undefined ? [] : [`--gate=${gate}`]),
  ]
}

/**
 * Whether the gate's Python side can run here: the interpreter starts it and it answers. Not
 * only whether a `python` exists, since on Windows a missing one may be a stub that exits with
 * an error, and a checkout without the tool cannot go through the gate either.
 */
export function lockAvailable(): boolean {
  return spawnSync(python, [gateScript, '--help'], { stdio: 'ignore' }).status === 0
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
