/**
 * The runner of the allowed browser set. Playwright given no spec runs the whole suite,
 * clipboard specs included, so every way to an empty or wrong list has to stop before
 * Playwright starts. Playwright is stood in for here: a refusal that failed would otherwise
 * start the very run it exists to prevent.
 */

import { describe, expect, it, vi } from 'vitest'

import { playwrightEnvironment, realIo, runAllowed } from './browser/allowedRun.ts'
import type { ProjectRule, RunnerIo } from './browser/allowedRun.ts'
import { clipboardOptIn, clipboardSpecs } from './browser/clipboardSpecs.ts'
import { spawnInherited } from './heavyLock.ts'

// The process start the real runner goes through, stood in for: no Playwright starts here.
vi.mock('./heavyLock.ts', async (actual) => ({
  ...(await actual<typeof import('./heavyLock.ts')>()),
  spawnInherited: vi.fn(() => Promise.resolve(0)),
}))

const allowed = ['production-settings.spec.ts', 'ui-buttons.spec.ts']
const notes = 'production-card-notes.spec.ts'
/** A spec file of the suite whose name no project's pattern takes. */
const scratch = 'zz-scratch-shots.spec.ts'
/** A spec file a project's pattern takes and its ignore list leaves out. */
const ignored = 'production-legacy.spec.ts'

const harnessMatch = /(?:^|[\\/])ui-[a-z0-9-]+\.spec\.ts$/
const productionMatch = /(?:^|[\\/])production-[a-z0-9-]+\.spec\.ts$/
const legacyIgnore = /(?:^|[\\/])production-legacy\.spec\.ts$/

/** Two projects, as a configuration states them: by the start of a spec file's name. */
const projects: ProjectRule[] = [
  { name: 'harness', testMatch: [harnessMatch], testIgnore: [] },
  { name: 'production', testMatch: [productionMatch], testIgnore: [legacyIgnore] },
]

/** A runner whose suite is `allowed`, the clipboard specs and `more`, and whose lists are `lists`. */
function runner(lists: Record<string, string> = {}, more: readonly string[] = []) {
  const written: string[][] = []
  const said: string[] = []
  const playwright = vi.fn((_args: readonly string[], _clipboard: boolean, _lock: string | null) =>
    Promise.resolve(0),
  )
  const io: RunnerIo = {
    playwright,
    projects: () => Promise.resolve(projects),
    readList: (file) => lists[file] ?? null,
    say: (line) => said.push(line),
    suiteSpecs: () => [...allowed, ...clipboardSpecs, ...more],
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

  it('says the form a list file takes when it names no spec, by a name of the suite', async () => {
    const lists = { 'batch.txt': 'tests/browser/ui-buttons.spec.ts\nui-buttons\n' }
    const { io, playwright, said } = runner(lists)
    expect(await runAllowed(['--specs=batch.txt'], io)).toBe(2)
    expect(playwright).not.toHaveBeenCalled()
    expect(said).toEqual([
      'Refused, no test ran: no such spec under tests/browser: ' +
        'tests/browser/ui-buttons.spec.ts, ui-buttons; a list file names spec files bare, ' +
        `by their names relative to tests/browser, one a line, such as ${allowed[0]}`,
    ])
  })

  it('refuses a listed spec no project runs, naming it and the rule of each project', async () => {
    const lists = { 'batch.txt': `ui-buttons.spec.ts\n${scratch}\nproduction-settings.spec.ts\n` }
    const { io, playwright, said } = runner(lists, [scratch])
    expect(await runAllowed(['--specs=batch.txt'], io)).toBe(2)
    expect(playwright).not.toHaveBeenCalled()
    expect(said).toEqual([
      `Refused, no test ran: no project of playwright.config.ts runs ${scratch}: ` +
        `harness runs a path matching ${harnessMatch}; ` +
        `production runs a path matching ${productionMatch} but not ${legacyIgnore}`,
    ])
  })

  it('refuses a listed spec a project takes by its pattern and leaves out by its ignore list', async () => {
    const { io, playwright, said } = runner({ 'batch.txt': `${ignored}\n` }, [ignored])
    expect(await runAllowed(['--specs=batch.txt'], io)).toBe(2)
    expect(playwright).not.toHaveBeenCalled()
    expect(said[0]).toContain(`no project of playwright.config.ts runs ${ignored}: `)
  })

  it('runs a list whole when a project runs each of its specs', async () => {
    const lists = { 'batch.txt': 'ui-buttons.spec.ts\nproduction-settings.spec.ts\n' }
    const { io, playwright, written } = runner(lists, [scratch, ignored])
    expect(await runAllowed(['--specs=batch.txt'], io)).toBe(0)
    expect(written).toEqual([['ui-buttons.spec.ts', 'production-settings.spec.ts']])
    expect(playwright).toHaveBeenCalledOnce()
  })

  it('takes the projects from playwright.config.ts itself, as Playwright will load it', async () => {
    vi.stubEnv('VALKAMA_BROWSER_STORE', undefined)
    try {
      const suite = realIo.suiteSpecs()
      const harnessSpec = suite.find(
        (name) => name.startsWith('ui-') && !clipboardSpecs.includes(name),
      )
      expect(harnessSpec).toBeDefined()
      const valid = [harnessSpec, 'production-settings.spec.ts', 'production-locale.spec.ts', notes]
      const lists = { 'scratch.txt': `${scratch}\n`, 'valid.txt': valid.join('\n') }
      const io = {
        ...runner(lists).io,
        projects: realIo.projects,
        suiteSpecs: () => [...suite, scratch],
      }

      const refused = { ...io, say: vi.fn() }
      expect(await runAllowed(['--specs=scratch.txt'], refused)).toBe(2)
      const { default: config } = await import('../playwright.config.ts')
      const message = String(refused.say.mock.calls[0]?.[0])
      expect(message).toContain(`runs ${scratch}: `)
      expect(config.projects?.length).toBeGreaterThan(0)
      for (const project of config.projects ?? [])
        expect(message).toContain(
          `${project.name} runs a path matching ${String(project.testMatch)}`,
        )

      const named = runner(lists)
      const real = { ...named.io, projects: realIo.projects, suiteSpecs: () => suite }
      expect(await runAllowed(['--specs=valid.txt', `--with-clipboard=${notes}`], real)).toBe(0)
      expect(named.written).toEqual([valid])
    } finally {
      vi.unstubAllEnvs()
    }
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

  it('holds the heavy-test lock for a run, naming what it runs, and for --list holds none', async () => {
    const whole = runner()
    expect(await runAllowed([], whole.io)).toBe(0)
    expect(whole.playwright.mock.calls[0]?.[2]).toMatch(
      /^npm run test:browser:allowed, the whole suite, harness port \d+$/,
    )

    const batch = runner({ 'batch.txt': 'ui-buttons.spec.ts\n' })
    expect(await runAllowed(['--specs=batch.txt'], batch.io)).toBe(0)
    expect(batch.playwright.mock.calls[0]?.[2]).toContain('the specs batch.txt names')

    const listed = runner()
    expect(await runAllowed(['--list'], listed.io)).toBe(0)
    expect(listed.playwright.mock.calls[0]?.[2]).toBeNull()
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

  it('runs Playwright through the gate declaring no CPUs, so it asks for the whole machine', async () => {
    expect(await realIo.playwright(['--workers=4'], false, 'the whole browser suite')).toBe(0)
    expect(spawnInherited).toHaveBeenCalledTimes(1)
    const [call] = vi.mocked(spawnInherited).mock.calls
    const command = call?.[0] ?? []
    const gate = command.slice(0, command.indexOf('--'))
    expect(gate).toContain('--run=the whole browser suite')
    // The present control is the Vitest run's `--cpus=8`, in `unitRun.test.ts`.
    expect(gate.some((word) => word.startsWith('--cpus'))).toBe(false)
    expect(command.at(-1)).toBe('--workers=4')
  })
})
