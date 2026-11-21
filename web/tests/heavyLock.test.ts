/**
 * The heavy-test lock as the web runners take it: through the one Python tool that owns it, so a
 * run of either runtime waits for a holder of the other and says whose run it waits for, and a
 * failed run that took none says who held it.
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { python } from './browser/serverStore.ts'
import { lockAvailable, lockedCommand, lockHolder } from './heavyLock.ts'

/** A started process: what it has written so far, and its exit code once it ends. */
function started(command: readonly string[]) {
  const [program = '', ...args] = command
  const child = spawn(program, args, { stdio: ['pipe', 'pipe', 'inherit'] })
  const chunks: string[] = []
  child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk.toString()))
  const exited = new Promise<number>((resolve, reject) => {
    child.on('error', reject)
    child.on('exit', (code, signal) => resolve(signal ? 1 : Number(code)))
  })
  return { child, exited, said: () => chunks.join('') }
}

async function until(condition: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 15_000
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

/** Holds the lock at argv[1] from Python until its input closes, after saying its process id. */
const pythonHolder = `
import os, sys
sys.path.insert(0, sys.argv[2])
from pathlib import Path
from tests import machine_lock
with machine_lock.held("a Python holder", path=Path(sys.argv[1])):
    print("held", os.getpid(), flush=True)
    sys.stdin.read()
`

/** A lock in a directory of its own, held by a Python process until `release`. */
interface PythonHold {
  directory: string
  exited: Promise<number>
  lock: string
  pid: string
  release: () => void
}

/** Runs `check` once Python holds the lock, and ends the hold and removes the directory after. */
async function whilePythonHolds(check: (hold: PythonHold) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'valkama-lock-'))
  const lock = join(directory, 'heavy.lock')
  const root = fileURLToPath(new URL('../..', import.meta.url))
  const holder = started([python, '-c', pythonHolder, lock, root])
  try {
    await until(() => holder.said().startsWith('held'), 'the Python holder')
    const pid = holder.said().trim().split(' ')[1] ?? ''
    const release = () => holder.child.stdin.end()
    await check({ directory, exited: holder.exited, lock, pid, release })
  } finally {
    holder.child.kill()
    await holder.exited
    rmSync(directory, { recursive: true, force: true })
  }
}

describe('the heavy-test lock the web runners take', () => {
  // Without a Python to hold the lock there is nothing to wait for; the runners go unlocked.
  it.skipIf(!lockAvailable())(
    'makes a run wait, saying whose run it waits for, while Python holds the lock',
    () =>
      whilePythonHolds(async ({ directory, lock, pid, release }) => {
        const marker = join(directory, 'ran')
        const write = `require('node:fs').writeFileSync(${JSON.stringify(marker)}, '')`
        const waiter = started(lockedCommand('a node run', [process.execPath, '-e', write], lock))
        await until(() => waiter.said().includes('waiting'), 'the waiter to say so')
        expect(existsSync(marker)).toBe(false)
        expect(waiter.said()).toContain('it is held by a Python holder in ')
        expect(waiter.said()).toContain(`process ${pid},`)

        release()
        expect(await waiter.exited).toBe(0)
        expect(existsSync(marker)).toBe(true)
        expect(waiter.said()).toContain('took the heavy-test lock after')
      }),
    30_000,
  )

  it.skipIf(!lockAvailable())(
    'names the holder for a failed targeted run while Python holds the lock, and nothing once it is free',
    () =>
      whilePythonHolds(async ({ exited, lock, pid, release }) => {
        const named = lockHolder(lock)
        expect(named).toContain(`the heavy-test lock ${lock} was held as this run ended`)
        expect(named).toContain('by a Python holder in ')
        expect(named).toContain(`process ${pid},`)

        release()
        expect(await exited).toBe(0)
        expect(lockHolder(lock)).toBe('')
      }),
    30_000,
  )

  it('runs the command through the lock of this checkout, for the process of the runner', () => {
    const command = lockedCommand('a run', ['node', 'cli.js', '--workers=4'])
    expect(command.slice(0, 2)).toEqual([
      python,
      fileURLToPath(new URL('../../tests/machine_lock.py', import.meta.url)),
    ])
    expect(command.slice(2)).toEqual([
      'run',
      '--run=a run',
      `--pid=${process.pid}`,
      '--',
      'node',
      'cli.js',
      '--workers=4',
    ])
  })
})
