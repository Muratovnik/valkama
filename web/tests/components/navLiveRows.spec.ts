/**
 * A row of the rail's list in words and under the hand: the second line that says what the
 * session is doing and how long, moved on by one clock for the whole list; the sentence its
 * hint and its name say; a session's own row, named and opened from the row; «Open
 * session» at the end of an item's row where a session stands behind it; and the panel a
 * press goes on in, which outlives the row it came from.
 */
import { createPinia, setActivePinia } from 'pinia'

import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MINUTE_MS } from '@/widgets/app-nav/composables/useMinuteClock.ts'

import { liveFrame, liveRow, liveSession, liveSpace } from '../support/liveFrame.ts'
import { drawn, hintOf, rail, row, unmountRails } from '../support/navRail.ts'
import type { Rail } from '../support/navRail.ts'
import {
  answerPlans,
  buttonNamed,
  FOLDER_LINK,
  opened,
  plan,
  resetOutsideWorld,
  restoreOutsideWorld,
  SESSION,
  SESSION_LINK,
  vscode,
  windowSteps,
} from '../support/openActionHarness.ts'

const NOW = Date.parse('2026-11-10T12:00:00Z')
/** An ISO time this many milliseconds before the clock's now. */
const ago = (milliseconds: number) => new Date(NOW - milliseconds).toISOString()
const MINUTE = 60_000
/** A row that has waited since `since`, all of one age by its last change. */
const waitingSince = (reference: string, since: string | null) =>
  liveRow(reference, { state: 'waiting', since, updated_at: '2026-11-10T00:00:00Z' })

beforeEach(() => {
  setActivePinia(createPinia())
  resetOutsideWorld()
  vi.useFakeTimers({ now: NOW, toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout'] })
})

afterEach(() => {
  unmountRails()
  vi.useRealTimers()
  restoreOutsideWorld()
})

const detailOf = (element: HTMLElement) =>
  element.querySelector('.nav-row-detail')?.textContent ?? null

/** One space whose rows a test names, and its sessions on no item. */
const space = (
  rows: ReturnType<typeof liveRow>[],
  sessions: ReturnType<typeof liveSession>[] = [],
) => liveFrame([liveSpace('MAIN', rows, { sessions })])

const EPIC = liveRow('MAIN-4', { kind: 'epic', title: 'Structured answers' })
const states = () =>
  space(
    [
      EPIC,
      liveRow('MAIN-1', { state: 'working', parent: 'MAIN-4', since: ago(5 * MINUTE) }),
      liveRow('MAIN-2', { state: 'waiting', asks: true, since: ago(3 * MINUTE) }),
      liveRow('MAIN-3', { state: 'waiting', since: ago(2 * 60 * MINUTE), agents: 2 }),
    ],
    [
      liveSession('00000000-0000-4000-8000-000000000001', {
        title: 'Compare two exports',
        folder: 'example-project',
        state: 'working',
        since: ago(25 * MINUTE),
      }),
    ],
  )

describe('the second line', () => {
  it('says each state in Russian, how long, and the epic or the folder after a dot', () => {
    const { wrapper } = rail(states(), 'ru')
    expect(
      ['MAIN-1', 'MAIN-2', 'MAIN-3', 'Compare two exports'].map((name) =>
        detailOf(row(wrapper, name)),
      ),
    ).toEqual([
      'работает 5\u{A0}мин · Structured answers',
      'спрашивает 3\u{A0}мин',
      'ждёт 2\u{A0}ч',
      'работает 25\u{A0}мин · example-project',
    ])
    // The epic leaves the first line of a row with two.
    expect(row(wrapper, 'MAIN-1').querySelector('.nav-row-epic')).toBeNull()
  })

  it('says each state in English', () => {
    const { wrapper } = rail(states())
    expect(
      ['MAIN-1', 'MAIN-2', 'MAIN-3', 'Compare two exports'].map((name) =>
        detailOf(row(wrapper, name)),
      ),
    ).toEqual([
      'working 5\u{A0}min · Structured answers',
      'asking 3\u{A0}min',
      'waiting 2\u{A0}h',
      'working 25\u{A0}min · example-project',
    ])
  })

  it('counts whole minutes under an hour and whole hours from one, and nothing under a minute', () => {
    const { wrapper } = rail(
      space([
        waitingSince('MAIN-1', ago(59_000)),
        waitingSince('MAIN-2', ago(60_000)),
        waitingSince('MAIN-3', ago(59 * MINUTE)),
        waitingSince('MAIN-4', ago(60 * MINUTE)),
        waitingSince('MAIN-5', null),
      ]),
      'ru',
    )
    expect(drawn(wrapper).map((name) => detailOf(row(wrapper, String(name))))).toEqual([
      'ждёт',
      'ждёт 1\u{A0}мин',
      'ждёт 59\u{A0}мин',
      'ждёт 1\u{A0}ч',
      'ждёт',
    ])
  })

  it('moves on once a minute from one clock for the whole list, in words only', async () => {
    const interval = vi.spyOn(globalThis, 'setInterval')
    const rows = Array.from({ length: 12 }, (_, at) =>
      liveRow(`MAIN-${at + 1}`, {
        state: 'working',
        since: ago(59_000 + at * MINUTE),
        updated_at: `2026-11-10T0${at % 10}:00:00Z`,
      }),
    )
    const { wrapper } = rail(space(rows))
    expect(interval.mock.calls.filter(([, ms]) => ms === MINUTE_MS)).toHaveLength(1)
    const before = drawn(wrapper)
    const elements = before.map((name) => row(wrapper, String(name)))
    expect(detailOf(elements[before.indexOf('MAIN-1')])).toBe('working')

    await vi.advanceTimersByTimeAsync(MINUTE_MS)
    expect(detailOf(row(wrapper, 'MAIN-1'))).toBe('working 1\u{A0}min')
    expect(detailOf(row(wrapper, 'MAIN-12'))).toBe('working 12\u{A0}min')
    // The same rows in the same order, each the same element: only their words moved.
    expect(drawn(wrapper)).toEqual(before)
    expect(before.map((name) => row(wrapper, String(name)))).toEqual(elements)
  })
})

describe('the sentence a row says', () => {
  it('says what it is, where it belongs, the state with what it means, how long and the agents', () => {
    const { wrapper } = rail(states())
    const said = (name: string) => [
      hintOf(row(wrapper, name)),
      row(wrapper, name).querySelector('.nav-row-link')?.getAttribute('aria-label'),
    ]
    expect(said('MAIN-2')).toEqual(
      Array.from(
        { length: 2 },
        () =>
          'MAIN-2 Work MAIN-2: asking for 3\u{A0}min — the session stopped in the middle of a turn for a permission or an answer',
      ),
    )
    expect(said('MAIN-3')[0]).toBe(
      'MAIN-3 Work MAIN-3: waiting for 2\u{A0}h — the session’s turn is over, 2 agents',
    )
    expect(said('MAIN-1')[0]).toBe(
      'MAIN-1 Work MAIN-1, part of Structured answers: working for 5\u{A0}min',
    )
    expect(said('Compare two exports')[0]).toBe(
      'Session “Compare two exports” in example-project: working for 25\u{A0}min',
    )
  })

  it('says a row’s meaning in Russian, and how long as a sentence does, not as its second line', () => {
    const waiting = liveSession(SESSION, {
      title: 'Compare two exports',
      folder: '',
      since: ago(2 * 60 * MINUTE),
    })
    const { wrapper } = rail(space([liveRow('MAIN-8', { state: 'held' })], [waiting]), 'ru')
    expect(hintOf(row(wrapper, 'MAIN-8'))).toBe(
      'MAIN-8 Work MAIN-8: у сессии — сессия сейчас работает над другой задачей',
    )
    const session = row(wrapper, 'Compare two exports')
    expect(session.querySelector('.nav-row-detail')?.textContent).toBe('ждёт 2\u{A0}ч')
    expect(hintOf(session)).toBe(
      'Сессия «Compare two exports»: ждёт уже 2\u{A0}ч — ход сессии закончен',
    )
  })
})

const ID = (tail: string) => `00000000-0000-4000-8000-00000000${tail}`

describe('a session’s row', () => {
  it('is named by its title, else its folder, else as a session with no name', () => {
    const { wrapper } = rail(
      space(
        [],
        [
          liveSession(ID('0001'), { title: 'Compare two exports', since: ago(MINUTE) }),
          liveSession(ID('0002'), { title: null, folder: 'tools', since: ago(2 * MINUTE) }),
          liveSession(ID('0003'), { title: null, folder: '', since: ago(3 * MINUTE) }),
        ],
      ),
      'ru',
    )
    expect(drawn(wrapper)).toEqual(['Compare two exports', 'tools', 'Сессия без названия'])
    // A session named by its folder does not say the folder twice.
    expect(detailOf(row(wrapper, 'tools'))).toBe('ждёт 2\u{A0}мин')
    // The glyph of a session stands in the number's column, and the row has no card or pin.
    const session = row(wrapper, 'tools')
    expect(session.querySelector('.nav-row-numeral .nav-row-glyph')).not.toBeNull()
    expect(session.querySelector('.nav-row-number')).toBeNull()
    expect(session.querySelector('a')).toBeNull()
    expect(session.querySelector('.nav-row-pin, .nav-row-open')).toBeNull()
  })

  it('opens its session on a press, through the session’s own plan', async () => {
    const reads = answerPlans(plan(vscode, { ...vscode, source: 'recorded' }, windowSteps.slice(1)))
    const { wrapper } = rail(space([], [liveSession(SESSION, { title: 'Compare two exports' })]))
    row(wrapper, 'Compare two exports').querySelector<HTMLElement>('button.nav-row-link')?.click()
    await flushPromises()
    const asked = reads.mock.calls.map(String)
    expect(
      asked.some((url) => url.includes('/api/open-plan') && url.includes(`session=${SESSION}`)),
    ).toBe(true)
    expect(opened.mock.calls.map(([link]) => link)).toEqual([SESSION_LINK])
  })

  it('leaves at once when the frame drops it: it does not fade as an item does', async () => {
    const { store, wrapper } = rail(
      space(
        [liveRow('MAIN-3', { state: 'working' })],
        [liveSession(ID('0001'), { title: 'Gone' })],
      ),
    )
    store.accept(space([]))
    await flushPromises()
    expect(drawn(wrapper)).toEqual(['MAIN-3'])
    expect(row(wrapper, 'MAIN-3').classList).toContain('muted')
  })
})

describe('«Open session» on an item’s row', () => {
  const executor = {
    session: SESSION,
    agent: null,
    opened_in: 'ide',
    opened_host: 'vscode',
    family: 'claude',
    state: 'live',
  } as const

  it('stands only where a session is behind the item, named by the item', () => {
    const { wrapper } = rail(
      space([
        liveRow('MAIN-1', { state: 'working', executor }),
        liveRow('MAIN-2', { state: 'working', executor: null }),
      ]),
      'ru',
    )
    const control = row(wrapper, 'MAIN-1').querySelector('.nav-row-open')
    expect(control?.getAttribute('aria-label')).toBe('Открыть сессию MAIN-1 Work MAIN-1')
    expect(row(wrapper, 'MAIN-2').querySelector('.nav-row-open')).toBeNull()
  })

  it('is reached by the keyboard between the row and its pin, and opens the row’s session', async () => {
    const reads = answerPlans(plan(vscode, { ...vscode, source: 'recorded' }, windowSteps.slice(1)))
    const { wrapper } = rail(space([liveRow('MAIN-1', { state: 'working', executor })]))
    const order = [...row(wrapper, 'MAIN-1').querySelectorAll('a, button')].map(
      (control) => control.className.split(' ')[0],
    )
    expect(order).toEqual(['nav-row-link', 'nav-row-open', 'nav-row-pin'])
    row(wrapper, 'MAIN-1').querySelector<HTMLElement>('.nav-row-open')?.click()
    await flushPromises()
    expect(reads.mock.calls.some((call) => String(call).includes(`session=${SESSION}`))).toBe(true)
    expect(opened.mock.calls.map(([link]) => link)).toEqual([SESSION_LINK])
  })
})

describe('the panel a press on a session goes on in', () => {
  const NAMED = { title: 'Compare two exports', state: 'working' } as const
  const holder = {
    ...vscode,
    session: SESSION,
    agent: null,
    family: 'claude',
    state: 'live',
  } as const
  const fromSession = {
    frame: () => space([], [liveSession(SESSION, NAMED)]),
    press: (wrapper: Rail) =>
      row(wrapper, 'Compare two exports').querySelector<HTMLElement>('button.nav-row-link'),
    name: 'Compare two exports',
  }
  const fromItem = {
    frame: () => space([liveRow('MAIN-1', { state: 'working', executor: holder })]),
    press: (wrapper: Rail) => row(wrapper, 'MAIN-1').querySelector<HTMLElement>('.nav-row-open'),
    name: 'MAIN-1 Work MAIN-1',
  }

  it.each([
    ['a session’s row the frame drops', fromSession, () => space([])],
    [
      'a session’s row the frame moves into the long fold',
      fromSession,
      () => space([], [liveSession(SESSION, { ...NAMED, state: 'waiting', long: true })]),
    ],
    ['an item’s «Open session» whose row starts to fade', fromItem, () => space([])],
  ])('stays open and usable after a refresh: %s', async (_, from, next) => {
    answerPlans(plan(vscode, { ...vscode, source: 'recorded' }, windowSteps))
    const { store, wrapper } = rail(from.frame())
    from.press(wrapper)?.click()
    await flushPromises()
    const first = buttonNamed('Open the project window in VS Code')
    expect(document.activeElement).toBe(first)

    store.accept(next())
    await flushPromises()
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog?.textContent).toContain(from.name)
    expect(document.activeElement).toBe(first)
    first.click()
    await flushPromises()
    buttonNamed('Open the session in VS Code').click()
    await flushPromises()
    expect(opened.mock.calls.map(([link]) => link)).toEqual([FOLDER_LINK, SESSION_LINK])
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
})
