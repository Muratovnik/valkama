/**
 * The heavy-process gate as the web runners go through it: through the one Python side that owns
 * it, so a run gets its share K and its lease, a run that finds no room never starts, and a failed
 * run that took none names the heavy runs going. The gate is stood in for by
 * `tests/heavy_gate_double.py`, and the earlier branches' lock is a file in a directory of its own.
 */

import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { python } from './browser/serverStore.ts'
import { lockAvailable, lockedCommand, lockHolder } from './heavyLock.ts'

const double = fileURLToPath(new URL('../../tests/heavy_gate_double.py', import.meta.url))

/** A started process's exit code and everything it wrote, once it ends. */
function finished(command: readonly string[]): Promise<{ code: number; said: string }> {
  const [program = '', ...args] = command
  // Not under this run's own lease, nor in an agent's session: the stand-in decides.
  const env = { ...process.env }
  for (const name of ['HEAVY_GATE_LEASE', 'HEAVY_GATE_K', 'VALKAMA_HEAVY_TEST_LOCK_HELD'])
    delete env[name]
  const child = spawn(program, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
  const chunks: string[] = []
  child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk.toString()))
  child.stderr.on('data', (chunk: Buffer) => chunks.push(chunk.toString()))
  return new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code, signal) =>
      resolve({ code: signal ? 1 : Number(code), said: chunks.join('') }),
    )
  })
}

describe('the heavy-process gate the web runners go through', () => {
  let directory = ''
  let gate = ''
  let lockFile = ''
  let state = ''

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'valkama-gate-'))
    state = join(directory, 'gate')
    mkdirSync(state)
    gate = join(state, 'heavy-gate.json')
    lockFile = join(directory, 'heavy.lock')
    const argv = [python, double, '--state', state]
    writeFileSync(gate, JSON.stringify({ protocol: 1, argv, state }))
  })

  afterEach(() => rmSync(directory, { recursive: true, force: true }))

  // Without a Python to run the gate's side there is nothing to go through; the runners go direct.
  it.skipIf(!lockAvailable())(
    'runs the command under a lease, with every {k} the share the gate gave',
    async () => {
      const out = join(directory, 'seen')
      const write = `require('node:fs').writeFileSync(${JSON.stringify(out)}, [process.argv[1], process.env.HEAVY_GATE_K, process.env.HEAVY_GATE_LEASE].join(' '))`
      const run = await finished(
        lockedCommand('vitest-suite', [process.execPath, '-e', write, '--', '--max={k}'], {
          gate,
          lockFile,
          want: 3,
        }),
      )
      expect(run.code).toBe(0)
      const [argument, k, lease] = readFileSync(out, 'utf8').split(' ')
      expect([argument, k]).toEqual(['--max=3', '3'])
      expect(lease).toMatch(/^double-/)
      expect(run.said).toContain('heavy-gate: admitted valkama:vitest-suite after 0 s: K=3')
    },
    30_000,
  )

  it.skipIf(!lockAvailable())(
    'starts nothing and exits 75 when the gate has no room, saying why',
    async () => {
      writeFileSync(join(state, 'refuse'), '')
      const out = join(directory, 'ran')
      const write = `require('node:fs').writeFileSync(${JSON.stringify(out)}, '')`
      const run = await finished(
        lockedCommand('browser-suite', [process.execPath, '-e', write], { gate, lockFile }),
      )
      expect(run.code).toBe(75)
      expect(run.said).toContain('no room for valkama:browser-suite')
      expect(() => readFileSync(out)).toThrow()
    },
    30_000,
  )

  it.skipIf(!lockAvailable())(
    "names the gate's leases for a failed run that took none, and nothing once none goes",
    () => {
      mkdirSync(join(state, 'leases'))
      const lease = join(state, 'leases', 'L.json')
      writeFileSync(
        lease,
        JSON.stringify({ name: 'valkama:browser-suite', holder_pid: 31, since: 1 }),
      )
      const env = { ...process.env }
      delete env['HEAVY_GATE_LEASE']
      delete env['VALKAMA_HEAVY_TEST_LOCK_HELD']
      const saved = process.env
      process.env = env
      try {
        const named = lockHolder({ gate, lockFile })
        expect(named).toContain('heavy runs were going as this run ended: valkama:browser-suite')
        expect(named).toContain('process 31,')
        rmSync(lease)
        expect(lockHolder({ gate, lockFile })).toBe('')
      } finally {
        process.env = saved
      }
    },
    30_000,
  )

  it('runs the command through the gate script of this checkout, for the process of the runner', () => {
    const command = lockedCommand('browser-suite', ['node', 'cli.js', '--workers=4'])
    expect(command.slice(0, 2)).toEqual([
      python,
      fileURLToPath(new URL('../../tests/heavy_gate.py', import.meta.url)),
    ])
    expect(command.slice(2)).toEqual([
      'run',
      '--kind=browser-suite',
      `--pid=${process.pid}`,
      '--',
      'node',
      'cli.js',
      '--workers=4',
    ])
  })

  it('gives the size, the want and the stand-ins a test names, before the command', () => {
    const command = lockedCommand('vitest-suite', ['node'], {
      gate: 'G',
      lockFile: 'L',
      size: 12,
      want: 8,
    })
    expect(command.slice(2)).toEqual([
      'run',
      '--kind=vitest-suite',
      '--size=12',
      '--want=8',
      `--pid=${process.pid}`,
      '--lock=L',
      '--gate=G',
      '--',
      'node',
    ])
  })

  it('refuses a lock file passed as a path, the way an earlier version took it', () => {
    // Untyped, as a caller on a branch from before the options reaches it at run time.
    const earlier = lockedCommand as (run: string, command: string[], lockFile: string) => string[]
    expect(() => earlier('a run', ['node'], 'L')).toThrow(TypeError)
  })
})
