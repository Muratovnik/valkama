/**
 * The browser executor of an open plan and the page's contract with the server.
 * The plans below are shaped as `server/session_open.py` answers them; fetch,
 * `window.open`, the clipboard and the desktop bridge are stubbed, so no test
 * follows a link or writes the clipboard of the machine it runs on.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { openTarget, prepareOpen, REFUSAL_REASONS } from '@/features/session-open/openPlan.ts'
import type { Outcome } from '@/features/session-open/openPlan.ts'
import { actionKey, outcomeWords, placeKey } from '@/features/session-open/placeWords.ts'

import {
  APP_REFUSALS,
  OPEN_PLACES,
  OPENED_HOSTS,
  OPENED_IN,
  PATH_REFUSALS,
  PLAN_REASONS,
  PLAN_STATES,
  validateOpenPlan,
} from '@/shared/api/openPlanModel.ts'
import { i18n, messages } from '@/shared/i18n/index.ts'
import { DEFAULT_SETTINGS, mergeSettings } from '@/shared/lib/settings.ts'

const SESSION = '6f1c2a8e-0000-4000-8000-000000000001'
const FOLDER = 'C:\\work\\example-project'
const FOLDER_LINK = 'vscode://file/C:/work/example-project'
const SESSION_LINK = `vscode://anthropic.claude-code/open?session=${SESSION}`

function plan(overrides: Record<string, unknown> = {}) {
  return {
    target: { kind: 'session', session: SESSION, agent: '' },
    surface: 'browser',
    client: 'claude',
    state: 'ended',
    place: { opened_in: 'ide', opened_host: 'vscode', source: 'recorded', first_open: false },
    opens: { opened_in: 'ide', opened_host: 'vscode', source: 'recorded', missed: '' },
    one_action: false,
    steps: [
      { kind: 'focus-folder', ide: 'vscode', folder: FOLDER, link: FOLDER_LINK },
      { kind: 'open-link', scheme: 'vscode', link: SESSION_LINK },
    ],
    ...overrides,
  }
}

let answers: unknown[] = []
const fetched: string[] = []
const opened = vi.fn()
const writeText = vi.fn()

function answer(...plans: unknown[]) {
  answers = plans
}

beforeEach(() => {
  i18n.global.locale.value = 'en'
  answers = []
  fetched.length = 0
  opened.mockReset()
  writeText.mockReset().mockResolvedValue(undefined)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      fetched.push(url)
      const body = answers.length > 1 ? answers.shift() : answers[0]
      return new Response(JSON.stringify(body), { status: 200 })
    }),
  )
  vi.spyOn(window, 'open').mockImplementation((...args) => {
    opened(...args)
    return null
  })
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  Reflect.deleteProperty(window, 'valkamaDesktop')
})

const claude = { kind: 'session', session: SESSION, family: 'claude' } as const
const defaults = { settings: DEFAULT_SETTINGS }

describe('opening in a browser', () => {
  it('takes two actions for the two VS Code steps: the window, then the session', async () => {
    answer(plan())
    const first = await openTarget(claude, defaults)

    expect(opened.mock.calls).toEqual([[FOLDER_LINK, '_blank', 'noreferrer']])
    expect(first.status).toBe('next')
    if (first.status !== 'next') return
    expect(first.next.steps.map((step) => step.kind)).toEqual(['open-link'])

    const second = await first.next.run()
    expect(opened.mock.calls.map(([link]) => link)).toEqual([FOLDER_LINK, SESSION_LINK])
    expect(second).toMatchObject({ status: 'opened', opens: { opened_host: 'vscode' } })
  })

  it('runs every step on one action only where the plan says one action may', async () => {
    answer(plan({ one_action: true }))
    const outcome = await openTarget(claude, defaults)
    expect(opened.mock.calls.map(([link]) => link)).toEqual([FOLDER_LINK, SESSION_LINK])
    expect(outcome.status).toBe('opened')
  })

  it('follows a codex:// link instead of refusing the Codex app', async () => {
    const link = `codex://threads/${SESSION}`
    answer(
      plan({
        client: 'codex',
        place: {
          opened_in: 'app',
          opened_host: 'codex-app',
          source: 'recorded',
          first_open: false,
        },
        opens: { opened_in: 'app', opened_host: 'codex-app', source: 'recorded', missed: '' },
        one_action: true,
        steps: [{ kind: 'open-link', scheme: 'codex', link }],
      }),
    )
    const outcome = await openTarget(
      { kind: 'session', session: SESSION, family: 'codex' },
      defaults,
    )
    expect(opened.mock.calls).toEqual([[link, '_blank', 'noreferrer']])
    expect(outcomeWords(i18n.global.t, outcome)).toBe('Opened in Codex')
  })

  it('follows a claude-cli link that types /resume, and copies a command where there is none', async () => {
    const link = `claude-cli://open?cwd=C%3A%5Cwork&q=%2Fresume%20${SESSION}`
    const terminal = { opened_in: 'terminal', opened_host: '', source: 'recorded' }
    answer(
      plan({
        place: { ...terminal, first_open: false },
        opens: { ...terminal, missed: '' },
        one_action: true,
        steps: [{ kind: 'open-link', scheme: 'claude-cli', link }],
      }),
    )
    await openTarget(claude, defaults)
    expect(opened.mock.calls).toEqual([[link, '_blank', 'noreferrer']])

    answer(
      plan({ one_action: true, steps: [{ kind: 'copy', text: `claude --resume ${SESSION}` }] }),
    )
    const copied = await openTarget(claude, defaults)
    expect(writeText).toHaveBeenCalledWith(`claude --resume ${SESSION}`)
    expect(copied).toMatchObject({ status: 'copied' })
  })

  it('names a refused clipboard by its code, never by the browser’s error text', async () => {
    writeText.mockRejectedValue(new Error('C:\\private\\denied.log'))
    answer(plan({ one_action: true, steps: [{ kind: 'copy', text: 'codex resume x' }] }))
    const outcome = await openTarget(claude, defaults)
    expect(outcome).toEqual({ status: 'refused', refusal: { reason: 'copy-failed' } })
    expect(outcomeWords(i18n.global.t, outcome)).not.toContain('private')
  })

  it('refuses with the plan’s reason when the plan only explains', async () => {
    answer(
      plan({
        state: 'gone',
        opens: null,
        steps: [{ kind: 'explain', reason: 'gone', archived: true }],
      }),
    )
    const outcome = await openTarget(claude, defaults)
    expect(opened).not.toHaveBeenCalled()
    expect(outcome).toEqual({ status: 'refused', refusal: { reason: 'gone', archived: true } })
    expect(outcomeWords(i18n.global.t, outcome)).toBe(
      'The client no longer has this session. A copy is kept in Valkama.',
    )
  })

  it('runs nothing on the click an explanation comes first on; the next click acts', async () => {
    answer(
      plan({
        state: 'live',
        steps: [{ kind: 'explain', reason: 'live-in-terminal' }, ...plan().steps],
      }),
    )
    const outcome = await openTarget(claude, defaults)
    expect(opened).not.toHaveBeenCalled()
    expect(outcome).toMatchObject({ status: 'next', notice: { reason: 'live-in-terminal' } })
    if (outcome.status !== 'next') return
    expect(actionKey(outcome.next)).toBe('open.action.focus-folder')
    const window = await outcome.next.run()
    expect(opened.mock.calls.map(([link]) => link)).toEqual([FOLDER_LINK])
    if (window.status !== 'next') throw new Error('expected the session after the window')
    expect(actionKey(window.next)).toBe('open.action.open-link-in-window')
  })

  it('hands a panel the plan’s actions in order with none of them run', async () => {
    answer(plan())
    const prepared = await prepareOpen(claude, defaults)
    expect(prepared.actions.map((action) => action.steps.map((step) => step.kind))).toEqual([
      ['focus-folder'],
      ['open-link'],
    ])
    expect(opened).not.toHaveBeenCalled()
  })

  it('says in a sentence where it opened, in the form the sentence takes', async () => {
    const terminal = { opened_in: 'terminal', opened_host: '', source: 'recorded' }
    const link = `claude-cli://open?q=%2Fresume%20${SESSION}`
    answer(
      plan({
        place: { ...terminal, first_open: false },
        opens: { ...terminal, missed: '' },
        one_action: true,
        steps: [{ kind: 'open-link', scheme: 'claude-cli', link }],
      }),
    )
    const outcome = await openTarget(claude, defaults)
    expect(outcomeWords(i18n.global.t, outcome)).toBe('Opened in a terminal')
    i18n.global.locale.value = 'ru'
    expect(outcomeWords(i18n.global.t, outcome)).toBe('Открыто в терминале')
  })

  it('reads a refused file as its path code', async () => {
    answer({
      ...plan({
        target: { kind: 'file', project: 'example-project', path: '../x.md', line: null },
      }),
      client: '',
      state: 'none',
      place: { opened_in: '', opened_host: '', source: 'none' },
      opens: null,
      steps: [{ kind: 'explain', reason: 'path-refused', code: 'outside_root' }],
    })
    const settings = mergeSettings({ editor: 'cursor' })
    const outcome = await openTarget(
      { kind: 'file', project: 'example-project', path: '../x.md', line: 4 },
      { settings },
    )
    const query = new URL(fetched[0] ?? '', 'https://valkama.invalid').searchParams
    expect(Object.fromEntries(query)).toEqual({
      target: 'file',
      project: 'example-project',
      path: '../x.md',
      line: '4',
      surface: 'browser',
      fallback: 'cursor',
    })
    expect(outcomeWords(i18n.global.t, outcome)).toBe('The path lies outside the project.')
  })
})

describe('asking for the plan', () => {
  it('sends a family’s fallback and "always" from the settings', async () => {
    const settings = mergeSettings({
      sessions: { codex: { fallback: 'codex-app', always: 'terminal', command: '' } },
    })
    answer(plan({ client: 'codex' }))
    await openTarget({ kind: 'session', session: SESSION, family: 'codex' }, { settings })
    const query = new URL(fetched[0] ?? '', 'https://valkama.invalid').searchParams
    expect([query.get('fallback'), query.get('always')]).toEqual(['codex-app', 'terminal'])
  })

  it('learns an unnamed family from the plan and asks again only when it is set apart', async () => {
    answer(plan())
    await openTarget({ kind: 'session', session: SESSION }, defaults)
    expect(fetched).toHaveLength(1)

    fetched.length = 0
    const settings = mergeSettings({
      sessions: { claude: { fallback: 'terminal', always: '', command: '' } },
    })
    await openTarget({ kind: 'session', session: SESSION }, { settings })
    expect(
      fetched.map((url) => new URL(url, 'https://valkama.invalid').searchParams.get('fallback')),
    ).toEqual([null, 'terminal'])
  })

  it('refuses a plan whose link is not of the scheme it names', async () => {
    answer(plan({ steps: [{ kind: 'open-link', scheme: 'vscode', link: 'https://example.com/' }] }))
    const outcome = await openTarget(claude, defaults)
    expect(outcome).toEqual({ status: 'refused', refusal: { reason: 'contract-invalid' } })
    expect(opened).not.toHaveBeenCalled()
  })

  it('copies the owner’s own command with the session’s folders filled in', async () => {
    const settings = mergeSettings({
      sessions: {
        claude: { fallback: 'vscode', always: 'custom', command: 'wt -d "{cwd}" {session}' },
      },
    })
    answer({
      kind: 'session',
      value: SESSION,
      resolved: true,
      detail: '',
      session: SESSION,
      session_cwd: 'C:\\work\\example-project\\web',
      space_root: {
        status: 'mapped',
        reason: '',
        canonical_root: FOLDER,
        resource_ref: { kind: 'planning-space', resource_id: 'x' },
      },
    })
    const outcome = await openTarget(claude, { settings })
    expect(fetched[0]).toBe(`/api/session?id=${SESSION}`)
    expect(outcome).toMatchObject({ status: 'copied', text: `wt -d ${FOLDER} ${SESSION}` })
  })
})

/** The app's bridge, answering each request with the next of these in turn. */
function app(...answers: unknown[]) {
  const call = vi.fn()
  for (const reply of answers) call.mockResolvedValueOnce(reply)
  Object.assign(window, { valkamaDesktop: { openSession: call } })
  return call
}

describe('naming what is not installed', () => {
  it('names a known program, and no key path for one it has no word for', async () => {
    answer(
      plan({ opens: null, steps: [{ kind: 'explain', reason: 'not-installed', host: 'cursor' }] }),
    )
    expect(outcomeWords(i18n.global.t, await openTarget(claude, defaults))).toBe(
      'Cursor is not installed.',
    )
    app({ ok: false, mode: 'refused', reason: 'not-installed', host: 'nano', next: null })
    expect(outcomeWords(i18n.global.t, await openTarget(claude, defaults))).toBe(
      'The program it opens in is not installed.',
    )
  })

  it('refuses in a browser a command whose folder is not known, as the app does', async () => {
    const settings = mergeSettings({
      sessions: { claude: { fallback: 'vscode', always: 'custom', command: 'wt -d {cwd}' } },
    })
    answer({ kind: 'session', value: SESSION, resolved: true, detail: '', session: SESSION })
    expect(await openTarget(claude, { settings })).toEqual({
      status: 'refused',
      refusal: { reason: 'no-folder' },
    })
    expect(writeText).not.toHaveBeenCalled()
  })
})

describe('opening in the Valkama app', () => {
  // The app starts the editor itself, so a desktop plan's window step has no link.
  const desktopPlan = plan({
    surface: 'desktop',
    steps: [
      { kind: 'focus-folder', ide: 'vscode', folder: FOLDER },
      { kind: 'open-link', scheme: 'vscode', link: SESSION_LINK },
    ],
  })

  it('names the target and the next step, never a link, one action per click', async () => {
    const call = app(
      { ok: true, mode: 'opened', next: 1, plan: desktopPlan },
      { ok: true, mode: 'opened', next: null, plan: desktopPlan },
    )
    const first: Outcome = await openTarget(claude, defaults)
    expect(fetched).toEqual([])
    expect(call).toHaveBeenCalledWith({ session: SESSION, fallback: 'vscode' })
    if (first.status !== 'next') throw new Error('expected a second action')
    expect(first.next.steps.map((step) => step.kind)).toEqual(['open-link'])
    expect(call).toHaveBeenCalledTimes(1)

    const second = await first.next.run()
    expect(call).toHaveBeenLastCalledWith({ session: SESSION, fallback: 'vscode', step: 1 })
    expect(second).toMatchObject({ status: 'opened', opens: { opened_host: 'vscode' } })
    expect(opened).not.toHaveBeenCalled()
  })

  it('carries an explanation the app gave before the next step as a notice', async () => {
    app({ ok: false, mode: 'explained', reason: 'live-in-terminal', next: 1, plan: desktopPlan })
    const outcome = await openTarget(claude, defaults)
    expect(outcome).toMatchObject({ status: 'next', notice: { reason: 'live-in-terminal' } })
    expect(outcomeWords(i18n.global.t, outcome)).toContain('runs in a terminal')
  })

  it('asks for a file with its line and the editor, and for the owner’s command by itself', async () => {
    const call = app(
      { ok: true, mode: 'opened', next: null },
      { ok: false, mode: 'refused', reason: 'no-folder', next: null },
    )
    await openTarget(
      { kind: 'file', project: 'example-project', path: 'docs/a.md', line: 4 },
      { settings: mergeSettings({ editor: 'cursor' }) },
    )
    expect(call).toHaveBeenLastCalledWith({
      path: { kind: 'file', project: 'example-project', path: 'docs/a.md', line: 4 },
      fallback: 'cursor',
    })
    const settings = mergeSettings({
      sessions: { claude: { fallback: 'vscode', always: 'custom', command: 'wt -d {cwd}' } },
    })
    const outcome = await openTarget(claude, { settings })
    expect(call).toHaveBeenLastCalledWith({ session: SESSION, command: 'wt -d {cwd}' })
    expect(outcome).toEqual({ status: 'refused', refusal: { reason: 'no-folder' } })
  })

  it('reports a refusal it has no words for, or no answer at all, as the app failing', async () => {
    app(
      { ok: false, mode: 'refused', reason: 'ENOENT spawn C:\\x', next: null },
      { ok: false, mode: 'refused', error: 'C:\\private\\stack', next: null },
    )
    const failed = { status: 'refused', refusal: { reason: 'bridge-failed' } }
    expect(await openTarget(claude, defaults)).toEqual(failed)
    expect(await openTarget(claude, defaults)).toEqual(failed)
  })
})

/** The text at a dotted key of a catalog, or what stands there instead. */
function walk(catalog: unknown, key: string): unknown {
  let node = catalog
  for (const part of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[part]
  return node
}

describe('the words for the plan', () => {
  it('name every reason the server and the app can give', () => {
    expect(REFUSAL_REASONS).toEqual(expect.arrayContaining([...PLAN_REASONS, ...APP_REFUSALS]))
  })

  it.each(['en', 'ru'] as const)('cover every refusal, place and state in %s', (locale) => {
    const catalog = messages[locale]
    const keys = [
      ...REFUSAL_REASONS.map((reason) => `open.refused.${reason}`),
      ...PATH_REFUSALS.map((code) => `open.pathRefused.${code}`),
      ...PLAN_STATES.map((state) => `open.state.${state}`),
      ...[...OPENED_IN, ...OPENED_HOSTS, ...OPEN_PLACES, 'claude-cli']
        .filter(Boolean)
        .map((word) => placeKey({ opened_in: word, opened_host: '' })),
    ]
    const missing = keys.filter((key) => typeof walk(catalog, key) !== 'string')
    expect(missing).toEqual([])
  })

  it('reads every step kind the server lists', () => {
    expect(() => validateOpenPlan(plan())).not.toThrow()
    expect(() => validateOpenPlan(plan({ steps: [{ kind: 'spawn', argv: ['x'] }] }))).toThrow()
  })
})
