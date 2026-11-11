/**
 * The runner of the allowed browser set. Playwright given no spec runs the whole suite,
 * clipboard specs included, so every way to an empty or wrong list has to stop before
 * Playwright starts. Playwright is stood in for here: a refusal that failed would otherwise
 * start the very run it exists to prevent.
 */

import { describe, expect, it, vi } from 'vitest'

import { playwrightEnvironment, realIo, runAllowed } from './browser/allowedRun.ts'
import type { RunnerIo } from './browser/allowedRun.ts'
import { clipboardOptIn, clipboardSpecs } from './browser/clipboardSpecs.ts'

const allowed = ['production-settings.spec.ts', 'ui-buttons.spec.ts']
const notes = 'production-card-notes.spec.ts'

/** A runner whose suite is `allowed` plus the clipboard specs, and whose lists are `lists`. */
function runner(lists: Record<string, string> = {}) {
  const written: string[][] = []
  const said: string[] = []
  const playwright = vi.fn((_args: readonly string[], _clipboard: boolean) => Promise.resolve(0))
  const io: RunnerIo = {
    playwright,
    readList: (file) => lists[file] ?? null,
    say: (line) => said.push(line),
    suiteSpecs: () => [...allowed, ...clipboardSpecs],
    writeList: (specs) => {
      written.push([...specs])
      return 'list.txt'
    },
  }
  return { io, playwright, said, written }
}

describe('the allowed browser run', () => {
  it('runs every spec but the clipboard ones, through a list file rather than the command line', async () => {
    const { io, playwright, said, written } = runner()
    expect(await runAllowed(['--workers=4'], io)).toBe(0)
    expect(written).toEqual([allowed])
    const [args, clipboard] = playwright.mock.calls[0] ?? []
    expect(args?.slice(0, 2)).toEqual(['test', '--test-list=list.txt'])
    expect(args?.at(-1)).toBe('--workers=4')
    expect(clipboard).toBe(false)
    expect(said.join('\n')).toContain(`clipboard specs left out: ${clipboardSpecs.join(', ')}`)
  })

  it('refuses a list file that does not exist, and starts nothing', async () => {
    const { io, playwright, said } = runner()
    expect(await runAllowed(['--specs=batch.txt'], io)).not.toBe(0)
    expect(playwright).not.toHaveBeenCalled()
    expect(said).toEqual(['Refused, no test ran: the list file batch.txt does not exist'])
  })

  it('refuses a list file that names no spec, and starts nothing', async () => {
    const { io, playwright, said } = runner({ 'batch.txt': '\n# none yet\n  \n' })
    expect(await runAllowed(['--specs', 'batch.txt'], io)).not.toBe(0)
    expect(playwright).not.toHaveBeenCalled()
    expect(said).toEqual(['Refused, no test ran: the list file batch.txt names no spec'])
  })

  it('refuses a suite with no spec in it, and starts nothing', async () => {
    const { io, playwright } = runner()
    expect(await runAllowed([], { ...io, suiteSpecs: () => [] })).not.toBe(0)
    expect(playwright).not.toHaveBeenCalled()
  })

  it('runs the specs a list file names, as it names them', async () => {
    const { io, playwright, written } = runner({ 'batch.txt': 'ui-buttons.spec.ts\r\n' })
    expect(await runAllowed(['--specs=batch.txt'], io)).toBe(0)
    expect(written).toEqual([['ui-buttons.spec.ts']])
    expect(playwright).toHaveBeenCalledOnce()
  })

  it('refuses a name in the list that is no spec, which would select nothing without a word', async () => {
    const { io, playwright } = runner({ 'batch.txt': 'ui-buttons.spec.ts\nui-button.spec.ts\n' })
    expect(await runAllowed(['--specs=batch.txt'], io)).not.toBe(0)
    expect(playwright).not.toHaveBeenCalled()
  })

  it('runs a clipboard spec only when --with-clipboard names it', async () => {
    const lists = { 'batch.txt': `${notes}\n` }
    const refused = runner(lists)
    expect(await runAllowed(['--specs=batch.txt'], refused.io)).not.toBe(0)
    expect(refused.playwright).not.toHaveBeenCalled()

    const named = runner(lists)
    expect(await runAllowed(['--specs=batch.txt', `--with-clipboard=${notes}`], named.io)).toBe(0)
    expect(named.written).toEqual([[notes]])

    const whole = runner()
    expect(await runAllowed([`--with-clipboard=${notes}`], whole.io)).toBe(0)
    expect(whole.written).toEqual([[...allowed, notes]])
  })

  it('lets the configuration select the clipboard specs only when --with-clipboard names one', async () => {
    const plain = runner({ 'batch.txt': 'ui-buttons.spec.ts\n' })
    expect(await runAllowed(['--specs=batch.txt'], plain.io)).toBe(0)
    expect(plain.playwright.mock.calls.map(([, clipboard]) => clipboard)).toEqual([false])

    const named = runner()
    expect(await runAllowed([`--with-clipboard=${notes}`], named.io)).toBe(0)
    expect(named.playwright.mock.calls.map(([, clipboard]) => clipboard)).toEqual([true])
  })

  it('runs Playwright with the opt-in set only when asked, whatever the shell held', () => {
    const shell = { PATH: '/bin', [clipboardOptIn]: '1' }
    expect(playwrightEnvironment(shell, false)).toEqual({ PATH: '/bin' })
    expect(playwrightEnvironment({ PATH: '/bin' }, true)).toEqual({
      PATH: '/bin',
      [clipboardOptIn]: '1',
    })
  })

  it('refuses --with-clipboard on a spec that is not a clipboard one', async () => {
    const { io, playwright } = runner()
    expect(await runAllowed(['--with-clipboard=ui-buttons.spec.ts'], io)).not.toBe(0)
    expect(playwright).not.toHaveBeenCalled()
  })

  it('refuses a bare argument, which Playwright would take for a spec name', async () => {
    const { io, playwright } = runner()
    expect(await runAllowed(['production-settings'], io)).not.toBe(0)
    expect(playwright).not.toHaveBeenCalled()
  })

  it('reads a list file that is not on disk as missing', () => {
    expect(realIo.readList('tests/browser/no-such-list.txt')).toBeNull()
  })

  it('finds the suite on disk, clipboard specs among it', () => {
    expect(realIo.suiteSpecs()).toEqual(expect.arrayContaining([...clipboardSpecs]))
  })
})
