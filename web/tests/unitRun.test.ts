/**
 * `npm run test:unit`: the whole Vitest suite runs holding the heavy-test lock, a targeted run
 * does not, and a machine with no Python to take the lock runs the suite unlocked instead of
 * failing. The lock tool and Vitest are stood in for: what is checked is the command chosen.
 */

import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

import { python } from './browser/serverStore.ts'
import { unitRun } from './unitRun.ts'

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
    const { command, note } = unitRun([], () => true)
    expect(command.slice(0, 2)).toEqual([python, lockTool])
    const held = command.slice(command.indexOf('--') + 1)
    expect(held).toEqual(vitest)
    expect(note).toBeNull()
  })

  it('keeps an option of the whole suite on the command it holds the lock for', () => {
    const { command } = unitRun(['--reporter=dot'], () => true)
    expect(command.slice(0, 2)).toEqual([python, lockTool])
    expect(command.at(-1)).toBe('--reporter=dot')
  })

  it('runs the suite unlocked, and says so, where no Python can take the lock', () => {
    const { command, note } = unitRun([], () => false)
    expect(command).toEqual(vitest)
    expect(note).toContain('without the heavy-test lock')
  })

  it.each([[['tests/allowedRun.test.ts']], [['-t', 'refuses']], [['--testNamePattern=refuses']]])(
    'runs a targeted run %j without the lock, and does not look for one',
    (args) => {
      const canLock = vi.fn(() => true)
      const { command, note } = unitRun(args, canLock)
      expect(command).toEqual([...vitest, ...args])
      expect(note).toBeNull()
      expect(canLock).not.toHaveBeenCalled()
    },
  )
})
