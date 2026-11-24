/**
 * `npm run test:unit`: the whole Vitest suite runs under a lease at the heavy-process gate with the
 * share K it gives, a targeted run takes none, and a machine with no Python for the gate's side
 * runs the suite without one instead of failing. The gate and Vitest are stood in for: what is
 * checked is the command chosen.
 */

import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

import { python } from './browser/serverStore.ts'
import { runUnits, unitRun } from './unitRun.ts'

const vitest = [
  process.execPath,
  fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url)),
  'run',
  '--config',
  'vitest.config.ts',
]
const gateScript = fileURLToPath(new URL('../../tests/heavy_gate.py', import.meta.url))

/** What a command asks the gate for, and the command it runs under the lease. */
function split(command: readonly string[]) {
  return {
    asked: command.slice(0, command.indexOf('--')),
    run: command.slice(command.indexOf('--') + 1),
  }
}

describe('the Vitest run of npm test', () => {
  it('runs the whole suite under a lease of its kind, with K workers in place of {k}', () => {
    const { command, note, targeted } = unitRun([], () => true, 32)
    const { asked, run } = split(command)
    expect(asked.slice(0, 4)).toEqual([python, gateScript, 'run', '--kind=vitest-suite'])
    expect(asked).toContain('--want=8')
    expect(run).toEqual([...vitest, '--maxWorkers={k}'])
    expect(note).toBeNull()
    expect(targeted).toBe(false)
  })

  it('wants the pool of eight workers and keeps the options of the whole suite after it', () => {
    const { command } = unitRun(['--reporter=dot'], () => true, 32)
    const { asked, run } = split(command)
    expect(asked).toContain('--want=8')
    expect(run).toEqual([...vitest, '--maxWorkers={k}', '--reporter=dot'])
  })

  it('wants no more workers than a smaller machine has CPUs', () => {
    const { command } = unitRun([], () => true, 4)
    expect(split(command).asked).toContain('--want=4')
  })

  it.each([
    [['--maxWorkers=16'], '16', []],
    [['--max-workers', '4', '--reporter=dot'], '4', ['--reporter=dot']],
  ])('wants the pool %j the caller sized, as K in its place', (args, want, rest) => {
    const { command } = unitRun(args, () => true, 32)
    const { asked, run } = split(command)
    expect(asked).toContain(`--want=${want}`)
    expect(run).toEqual([...vitest, '--maxWorkers={k}', ...rest])
  })

  it("leaves a pool sized otherwise than in workers as given, and wants the suite's own", () => {
    const { command } = unitRun(['--maxWorkers=50%'], () => true, 32)
    const { asked, run } = split(command)
    expect(asked).toContain('--want=8')
    expect(run).toEqual([...vitest, '--maxWorkers=50%'])
  })

  it.each([[['--reporter=dot']], [['--reporter', 'dot']]])(
    'keeps the option %j of the whole suite on the command it runs under the lease',
    (args) => {
      const { command } = unitRun(args, () => true)
      expect(command.slice(0, 2)).toEqual([python, gateScript])
      expect(command.slice(-args.length)).toEqual(args)
    },
  )

  it('runs the suite without a lease, and says so, where no Python can run the gate side', () => {
    const { command, note, targeted } = unitRun([], () => false)
    expect(command).toEqual(vitest)
    expect(note).toContain('without a lease at the heavy-process gate')
    // Without a lease for want of Python, not by design: a failure of it names no one.
    expect(targeted).toBe(false)
  })

  it.each([
    [['tests/allowedRun.test.ts']],
    [['--reporter=dot', 'tests/allowedRun.test.ts']],
    [['-t', 'refuses']],
    [['--testNamePattern=refuses']],
  ])('runs a targeted run %j without a lease, and does not look for the gate', (args) => {
    const canLock = vi.fn(() => true)
    const { command, note, targeted } = unitRun(args, canLock)
    expect(command).toEqual([...vitest, ...args])
    expect(note).toBeNull()
    expect(targeted).toBe(true)
    expect(canLock).not.toHaveBeenCalled()
  })
})

describe('the end of a run of npm run test:unit', () => {
  const named = 'heavy runs were going as this run ended: R\n'

  /** A run whose command exits with `code`, and what it said. */
  function ending(code: number, canLock = true) {
    const said: string[] = []
    const holder = vi.fn(() => named)
    const io = {
      canLock: () => canLock,
      holder,
      spawn: () => Promise.resolve(code),
      write: (text: string) => said.push(text),
    }
    return { holder, io, said }
  }

  it('names the heavy runs going after a targeted run that failed', async () => {
    const { io, said } = ending(1)
    expect(await runUnits(['tests/allowedRun.test.ts'], io)).toBe(1)
    expect(said).toEqual([named])
  })

  it.each([
    ['a targeted run that passed', ['tests/allowedRun.test.ts'], 0, true],
    ['a whole-suite run that failed under a lease', [], 1, true],
    ['a whole-suite run that failed without a lease for want of Python', [], 1, false],
  ])('asks for no holder after %s', async (_what, args, code, canLock) => {
    const { holder, io, said } = ending(code, canLock)
    expect(await runUnits(args, io)).toBe(code)
    expect(holder).not.toHaveBeenCalled()
    expect(said.join('')).not.toContain('heavy runs were going')
  })
})
