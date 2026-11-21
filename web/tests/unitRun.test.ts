/**
 * `npm run test:unit`: the whole Vitest suite runs holding the heavy-test lock, a targeted run
 * does not, and a machine with no Python to take the lock runs the suite unlocked instead of
 * failing. The lock tool and Vitest are stood in for: what is checked is the command chosen.
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
const lockTool = fileURLToPath(new URL('../../tests/machine_lock.py', import.meta.url))

describe('the Vitest run of npm test', () => {
  it('runs the whole suite through the lock tool, with Vitest as the command it holds the lock for', () => {
    const { command, note, targeted } = unitRun([], () => true, 32)
    expect(command.slice(0, 2)).toEqual([python, lockTool])
    const held = command.slice(command.indexOf('--') + 1)
    expect(held).toEqual([...vitest, '--maxWorkers=8'])
    expect(note).toBeNull()
    expect(targeted).toBe(false)
  })

  it('declares to the gate the pool of eight workers it runs the suite in', () => {
    const { command } = unitRun(['--reporter=dot'], () => true, 32)
    const gate = command.slice(0, command.indexOf('--'))
    expect(gate).toContain('--cpus=8')
    expect(command.slice(command.indexOf('--') + 1)).toEqual([
      ...vitest,
      '--maxWorkers=8',
      '--reporter=dot',
    ])
  })

  it('runs and declares no more workers than a smaller machine has CPUs', () => {
    const { command } = unitRun([], () => true, 4)
    expect(command.slice(0, command.indexOf('--'))).toContain('--cpus=4')
    expect(command.slice(command.indexOf('--') + 1)).toEqual([...vitest, '--maxWorkers=4'])
  })

  it.each([[['--maxWorkers=16']], [['--max-workers', '4']]])(
    'asks for the whole machine for a pool %j it did not size, and leaves that pool as given',
    (args) => {
      const { command } = unitRun(args, () => true)
      expect(
        command.slice(0, command.indexOf('--')).some((word) => word.startsWith('--cpus')),
      ).toBe(false)
      expect(command.slice(command.indexOf('--') + 1)).toEqual([...vitest, ...args])
    },
  )

  it.each([[['--reporter=dot']], [['--reporter', 'dot']]])(
    'keeps the option %j of the whole suite on the command it holds the lock for',
    (args) => {
      const { command } = unitRun(args, () => true)
      expect(command.slice(0, 2)).toEqual([python, lockTool])
      expect(command.slice(-args.length)).toEqual(args)
    },
  )

  it('runs the suite unlocked, and says so, where no Python can take the lock', () => {
    const { command, note, targeted } = unitRun([], () => false)
    expect(command).toEqual(vitest)
    expect(note).toContain('without the heavy-test lock')
    // Unlocked for want of Python, not by design: a failure of it names no holder.
    expect(targeted).toBe(false)
  })

  it.each([
    [['tests/allowedRun.test.ts']],
    [['--reporter=dot', 'tests/allowedRun.test.ts']],
    [['-t', 'refuses']],
    [['--testNamePattern=refuses']],
  ])('runs a targeted run %j without the lock, and does not look for one', (args) => {
    const canLock = vi.fn(() => true)
    const { command, note, targeted } = unitRun(args, canLock)
    expect(command).toEqual([...vitest, ...args])
    expect(note).toBeNull()
    expect(targeted).toBe(true)
    expect(canLock).not.toHaveBeenCalled()
  })
})

describe('the end of a run of npm run test:unit', () => {
  const named = 'the heavy-test lock L was held as this run ended, by R\n'

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

  it('names the holder of the heavy-test lock after a targeted run that failed', async () => {
    const { io, said } = ending(1)
    expect(await runUnits(['tests/allowedRun.test.ts'], io)).toBe(1)
    expect(said).toEqual([named])
  })

  it.each([
    ['a targeted run that passed', ['tests/allowedRun.test.ts'], 0, true],
    ['a whole-suite run that failed holding the lock', [], 1, true],
    ['a whole-suite run that failed unlocked for want of Python', [], 1, false],
  ])('asks for no holder after %s', async (_what, args, code, canLock) => {
    const { holder, io, said } = ending(code, canLock)
    expect(await runUnits(args, io)).toBe(code)
    expect(holder).not.toHaveBeenCalled()
    expect(said.join('')).not.toContain('was held as this run ended')
  })
})
