/**
 * A failed browser run names who holds the heavy-test lock as it ends, as a failed targeted
 * unittest or Vitest run does, and the configuration adds the reporter that says it beside `line`
 * in both of its branches. Who holds the lock is stood in for; `heavyLock.test.ts` asks the real
 * Python side.
 */

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { holderLine } from './browser/lockHolderReporter.ts'

const named = 'the heavy-test lock L was held as this run ended, by R\n'
const reporter = fileURLToPath(new URL('browser/lockHolderReporter.ts', import.meta.url))

describe('the end of a browser run', () => {
  it.each(['failed', 'timedout'] as const)('names the holder after a run that %s', (status) => {
    const holder = vi.fn(() => named)
    expect(holderLine(status, holder)).toBe(named)
    expect(holder).toHaveBeenCalledOnce()
  })

  it.each(['passed', 'interrupted'] as const)(
    'asks for no holder after a run that was %s',
    (status) => {
      const holder = vi.fn(() => named)
      expect(holderLine(status, holder)).toBe('')
      expect(holder).not.toHaveBeenCalled()
    },
  )
})

describe('the reporters of the browser configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it.each([
    ['the mocked app', undefined],
    ['a real store', join(tmpdir(), 'valkama-browser-store')],
  ])('keep line and add the holder reporter, against %s', async (_against, store) => {
    vi.resetModules()
    vi.stubEnv('VALKAMA_BROWSER_STORE', store)
    const { default: config } = await import('../playwright.config.ts')
    expect(Boolean(config.webServer && !Array.isArray(config.webServer))).toBe(store !== undefined)
    expect(config.reporter).toEqual([['line'], [reporter]])
  })
})
