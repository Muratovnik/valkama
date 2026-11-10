/**
 * The rail's list of work going on now, as behaviour a reader relies on: the work to follow
 * now freshest first with the rest under three folds and the pinned apart, the sessions under
 * no space after the spaces, a row that left fading where it stood, the folds kept on the
 * device, and the count on a phone's rail. The signs are `navLiveSigns.spec.ts`.
 */
import { createPinia, setActivePinia } from 'pinia'

import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FADING_MS } from '@/shared/stores/liveWorkStore.ts'

import { busyFrame, liveFrame, liveRow, liveSession, liveSpace } from '../support/liveFrame.ts'
import { drawn, hintOf, rail, row, unmountRails } from '../support/navRail.ts'
import type { Rail } from '../support/navRail.ts'

const STORAGE = 'valkama-nav-open'
const stored = () => JSON.parse(localStorage.getItem(STORAGE) ?? '{}') as Record<string, boolean>

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

afterEach(() => {
  unmountRails()
  vi.useRealTimers()
  document.body.innerHTML = ''
})

/** What a part of the list draws, an item by its reference and a session by its title. */
const within = (wrapper: Rail, selector: string) => drawn(wrapper, `.nav-work-list ${selector}`)

describe('the order of the list', () => {
  it('lists the work to follow now freshest first, the rest folded, the pinned apart', () => {
    const { wrapper } = rail(
      liveFrame([
        liveSpace('MAIN', [
          liveRow('MAIN-4', { kind: 'epic', title: 'Earlier epic' }),
          liveRow('MAIN-2', { state: 'waiting', updated_at: '2026-11-09T07:00:00Z' }),
          liveRow('MAIN-12', {
            parent: 'MAIN-4',
            state: 'working',
            updated_at: '2026-11-09T09:00:00Z',
          }),
          liveRow('MAIN-30', { state: 'working', updated_at: '2026-11-09T08:00:00Z' }),
          liveRow('MAIN-8', { state: 'held', updated_at: '2026-11-09T06:00:00Z' }),
          liveRow('MAIN-9', { state: 'waiting', long: true }),
          liveRow('MAIN-6', {
            state: 'quiet',
            quiet_since: '2026-11-01T00:00:00Z',
            updated_at: '2026-11-09T10:00:00Z',
          }),
          liveRow('MAIN-21', { pinned: true }),
          liveRow('MAIN-20', { pinned: true, state_name: 'Done', is_terminal: true }),
        ]),
        liveSpace('NEXT', [liveRow('NEXT-1', { state: 'working' })]),
      ]),
    )
    const main = '.nav-tree-space:first-child'
    expect(within(wrapper, `${main} .nav-tree-body > .nav-rows`)).toEqual([
      'MAIN-12',
      'MAIN-30',
      'MAIN-2',
    ])
    expect(wrapper.findAll(`${main} .nav-fold`)).toHaveLength(3)
    expect(within(wrapper, `${main} .nav-fold`)).toEqual(['MAIN-8', 'MAIN-9', 'MAIN-6'])
    expect(within(wrapper, `${main} .nav-tree-pinned`)).toEqual(['MAIN-20', 'MAIN-21'])
    // The epic is no row of its own: its title is said on its item's second line.
    expect(drawn(wrapper)).not.toContain('MAIN-4')
    expect(row(wrapper, 'MAIN-12').querySelector('.nav-row-detail')?.textContent).toMatch(
      / · Earlier epic$/u,
    )
    expect(wrapper.findAll('.nav-tree-space-name').map((name) => name.text())).toEqual([
      'MAIN · MAIN space',
      'NEXT · NEXT space',
    ])
  })

  it('stands the sessions on no item among the items, and those under no space last', async () => {
    const { wrapper } = rail(
      liveFrame(
        [
          liveSpace('MAIN', [liveRow('MAIN-3', { state: 'working' })], {
            sessions: [
              liveSession('00000000-0000-4000-8000-000000000001', {
                title: 'Compare two exports',
                state: 'working',
                since: '2026-11-01T10:00:00Z',
              }),
            ],
          }),
        ],
        [
          liveSession('00000000-0000-4000-8000-000000000002', { title: 'Read the logs' }),
          liveSession('00000000-0000-4000-8000-000000000003', { title: 'Old', long: true }),
        ],
      ),
    )
    expect(drawn(wrapper)).toEqual(['Compare two exports', 'MAIN-3', 'Read the logs', 'Old'])
    const heads = wrapper.findAll('.nav-tree-space-name').map((name) => name.text())
    expect(heads).toEqual(['MAIN · MAIN space', 'Sessions outside any space'])
    const outside = wrapper.findAll('.nav-tree-space')[1]
    expect(outside.find('a').exists()).toBe(false)
    // Its long wait folds under a fold of its own, kept on the device apart from any space's.
    const fold = outside.get('.nav-fold-toggle')
    expect(fold.text()).toBe('1 more waiting for hours')
    await fold.trigger('click')
    expect(stored()).toEqual({ 'long:': true })
  })
})

/** Another rail on its own store: a frame that replaced another would fade the rows it dropped. */
function fresh() {
  unmountRails()
  document.body.innerHTML = ''
  setActivePinia(createPinia())
}

const folds = (wrapper: Rail) =>
  wrapper.findAll('.nav-work-list .nav-fold-toggle').map((fold) => fold.text())

/** A space with `held` held items, `long` long waits and `quiet` quiet ones. */
function folded(held: number, long: number, quiet: number) {
  const rows = [
    ...Array.from({ length: held }, (_, at) => liveRow(`MAIN-${at + 1}`, { state: 'held' })),
    ...Array.from({ length: long }, (_, at) =>
      liveRow(`MAIN-${at + 11}`, { state: 'waiting', long: true }),
    ),
    ...Array.from({ length: quiet }, (_, at) =>
      liveRow(`MAIN-${at + 21}`, { state: 'quiet', quiet_since: '2026-11-01T00:00:00Z' }),
    ),
  ]
  return liveFrame([liveSpace('MAIN', rows)])
}

describe('the folds', () => {
  it('names each fold by what it holds, in Russian with each plural form', () => {
    expect(folds(rail(folded(1, 1, 1), 'ru').wrapper)).toEqual([
      'ещё 1\u{A0}у работающей сессии',
      'ещё 1\u{A0}давно ждёт',
      'ещё 1\u{A0}молчит больше суток',
    ])
    fresh()
    expect(folds(rail(folded(2, 3, 4), 'ru').wrapper)).toEqual([
      'ещё 2\u{A0}у работающих сессий',
      'ещё 3\u{A0}давно ждут',
      'ещё 4\u{A0}молчат больше суток',
    ])
    fresh()
    expect(folds(rail(folded(5, 0, 0), 'ru').wrapper)).toEqual(['ещё 5\u{A0}у работающих сессий'])
  })

  it('names each fold in English, one and many, and draws none that would hold nothing', () => {
    expect(folds(rail(folded(1, 0, 1)).wrapper)).toEqual([
      '1 more with a working session',
      '1 more silent for over a day',
    ])
    fresh()
    expect(folds(rail(folded(2, 2, 2)).wrapper)).toEqual([
      '2 more with working sessions',
      '2 more waiting for hours',
      '2 more silent for over a day',
    ])
  })

  it('starts each fold folded and opens it in place, its rows on one line', async () => {
    const { wrapper } = rail(folded(1, 1, 1))
    const toggles = wrapper.findAll('.nav-work-list .nav-fold-toggle')
    for (const toggle of toggles) {
      expect(toggle.attributes('aria-expanded')).toBe('false')
      expect(wrapper.get(`#${toggle.attributes('aria-controls')}`).isVisible()).toBe(false)
    }
    const above = wrapper.findAll('.nav-work-list .nav-fold').map((fold) => fold.element)
    await toggles[1].trigger('click')
    expect(toggles[1].attributes('aria-expanded')).toBe('true')
    const list = wrapper.get(`#${toggles[1].attributes('aria-controls')}`)
    expect(list.isVisible()).toBe(true)
    // In place: under its own row, inside its own fold, and the others stay folded.
    expect(above[1].contains(list.element)).toBe(true)
    expect(toggles.map((toggle) => toggle.attributes('aria-expanded'))).toEqual([
      'false',
      'true',
      'false',
    ])
    expect(list.findAll('.nav-row-detail')).toHaveLength(0)
    expect(list.findAll('.nav-row')).toHaveLength(1)
  })

  it('keeps each fold’s opening on the device on its own', async () => {
    const { wrapper } = rail(folded(1, 1, 1))
    const toggles = wrapper.findAll('.nav-work-list .nav-fold-toggle')
    await toggles[0].trigger('click')
    await toggles[2].trigger('click')
    expect(stored()).toEqual({ 'held:MAIN': true, 'quiet:MAIN': true })
    await toggles[0].trigger('click')
    expect(stored()).toEqual({ 'quiet:MAIN': true })
  })

  it('opens the quiet fold on a device that opened the one fold of quiet work before', () => {
    localStorage.setItem(STORAGE, JSON.stringify({ 'quiet:MAIN': true }))
    const { wrapper } = rail(folded(1, 1, 1))
    expect(
      wrapper
        .findAll('.nav-work-list .nav-fold-toggle')
        .map((toggle) => toggle.attributes('aria-expanded')),
    ).toEqual(['false', 'false', 'true'])
  })
})

/** MAIN-5 has been at work for twelve minutes when the frame drops it. */
const before = () =>
  liveFrame([
    liveSpace('MAIN', [
      liveRow('MAIN-3', { state: 'working' }),
      liveRow('MAIN-5', {
        state: 'working',
        since: new Date(Date.now() - 12 * 60_000).toISOString(),
      }),
      liveRow('MAIN-8', { state: 'held' }),
    ]),
  ])
const after = () =>
  liveFrame([
    liveSpace('MAIN', [
      liveRow('MAIN-3', { state: 'working' }),
      liveRow('MAIN-8', { state: 'held' }),
    ]),
  ])

describe('a row the frame no longer has', () => {
  it('stays muted where it stood for twenty seconds, then goes', async () => {
    vi.useFakeTimers()
    const { store, wrapper } = rail(before())
    store.accept(after())
    await flushPromises()
    expect(drawn(wrapper)).toEqual(['MAIN-3', 'MAIN-5', 'MAIN-8'])
    expect(row(wrapper, 'MAIN-5').classList).toContain('muted')
    expect(row(wrapper, 'MAIN-5').querySelector('.session-sign')).toBeNull()
    // Its second line says what its hint says, and no state or time that no longer runs.
    expect(row(wrapper, 'MAIN-5').querySelector('.nav-row-detail')?.textContent).toBe('work ended')
    expect(hintOf(row(wrapper, 'MAIN-5'))).toBe('MAIN-5 Work MAIN-5: work ended')
    vi.advanceTimersByTime(FADING_MS - 1)
    await flushPromises()
    expect(drawn(wrapper)).toContain('MAIN-5')
    vi.advanceTimersByTime(1)
    await flushPromises()
    expect(drawn(wrapper)).toEqual(['MAIN-3', 'MAIN-8'])
  })

  it('does not leave while the pointer or focus is on it', async () => {
    vi.useFakeTimers()
    const { store, wrapper } = rail(before())
    store.accept(after())
    await flushPromises()
    row(wrapper, 'MAIN-5').dispatchEvent(new Event('pointerenter'))
    vi.advanceTimersByTime(FADING_MS * 2)
    await flushPromises()
    expect(drawn(wrapper)).toContain('MAIN-5')
    // Focus moves in while the pointer is still there, and the pointer leaves first.
    row(wrapper, 'MAIN-5').dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    row(wrapper, 'MAIN-5').dispatchEvent(new Event('pointerleave'))
    await flushPromises()
    expect(drawn(wrapper)).toContain('MAIN-5')
    row(wrapper, 'MAIN-5').dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    await flushPromises()
    expect(drawn(wrapper)).toEqual(['MAIN-3', 'MAIN-8'])
  })

  it('takes its old place back, and its normal look, when the frame brings it back', async () => {
    vi.useFakeTimers()
    const { store, wrapper } = rail(before())
    store.accept(after())
    store.accept(before())
    await flushPromises()
    expect(drawn(wrapper)).toEqual(['MAIN-3', 'MAIN-5', 'MAIN-8'])
    expect(row(wrapper, 'MAIN-5').classList).not.toContain('muted')
    vi.advanceTimersByTime(FADING_MS)
    await flushPromises()
    expect(drawn(wrapper)).toContain('MAIN-5')
  })
})

describe('the space folds', () => {
  it('opens a node nobody folded, and keeps a fold on the device', async () => {
    const { wrapper } = rail(busyFrame())
    const fold = wrapper.get('.nav-tree-fold')
    expect(fold.attributes('aria-expanded')).toBe('true')
    await fold.trigger('click')
    expect(fold.attributes('aria-expanded')).toBe('false')
    expect(stored()).toEqual({ 'space:MAIN': false })
    unmountRails()

    setActivePinia(createPinia())
    const again = rail(busyFrame()).wrapper
    const spaceFolds = again.findAll('.nav-tree-fold')
    expect(spaceFolds.map((each) => each.attributes('aria-expanded'))).toEqual([
      'false',
      'true',
      'true',
    ])
    // Opened again, the memory forgets the node rather than keeping it as open.
    await spaceFolds[0].trigger('click')
    expect(stored()).toEqual({})
  })

  it('folds a fold, then the space, then the list on Escape, focus going to each fold', async () => {
    const { wrapper } = rail(busyFrame())
    const more = wrapper.get('.nav-fold-toggle')
    await more.trigger('click')
    const link = row(wrapper, 'MAIN-13').querySelector<HTMLElement>('.nav-row-link')
    link?.focus()
    link?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(more.attributes('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(more.element)
    // Folded, the next Escape goes on to the space around it.
    more.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    const spaceFold = wrapper.get('.nav-tree-fold').element
    expect(spaceFold.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(spaceFold)
    // And past the spaces it folds the list and goes to the fold on «Work».
    spaceFold.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    const workFold = wrapper.get('.nav-entry-fold').element
    expect(workFold.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(workFold)
  })
})

describe('the empty line', () => {
  it('says nobody is working when no space has rows or sessions and none is outside', () => {
    const { wrapper } = rail(liveFrame([]), 'ru')
    expect(wrapper.get('.nav-work-list').text()).toBe('Сейчас никто не работает')
  })

  it('is not drawn while sessions work on no item, in a space or outside any', async () => {
    const session = liveSession('00000000-0000-4000-8000-000000000001', { title: 'Alone' })
    const { store, wrapper } = rail(liveFrame([liveSpace('MAIN', [], { sessions: [session] })]))
    expect(drawn(wrapper)).toEqual(['Alone'])
    expect(wrapper.find('.nav-tree-empty').exists()).toBe(false)
    store.accept(liveFrame([], [session]))
    await flushPromises()
    expect(drawn(wrapper)).toEqual(['Alone'])
    expect(wrapper.find('.nav-tree-empty').exists()).toBe(false)
  })
})

describe('the count on a phone’s rail', () => {
  it('counts the rows to follow now, items and sessions, and nothing folded or pinned', async () => {
    const { store, wrapper } = rail(busyFrame())
    const count = () => wrapper.get('.nav-work-rail').attributes('aria-label')
    // On view: the epic at work, MAIN-12, MAIN-31 and NEXT-5, the session in MAIN and the one
    // outside any space. The held MAIN-13, the quiet rows and the pinned ones are not counted.
    expect(count()).toBe('Work going on now: 6')
    const dropped = busyFrame()
    dropped.spaces[0].rows = dropped.spaces[0].rows.filter((each) => each.reference !== 'MAIN-12')
    dropped.elsewhere[0] = { ...dropped.elsewhere[0], long: true }
    store.accept(dropped)
    await flushPromises()
    // A row that left still fades in the list, but nobody is on it now; a long wait folds.
    expect(drawn(wrapper)).toContain('MAIN-12')
    expect(count()).toBe('Work going on now: 4')
  })
})

describe('the row on show', () => {
  it('marks the open card’s row as the current page, and no other', () => {
    const { wrapper } = rail(busyFrame(), 'en', { key: 'MAIN', reference: 'MAIN-12' } as never)
    const current = wrapper.findAll('[aria-current="page"]')
    expect(current).toHaveLength(1)
    expect(current[0].attributes('aria-label')).toMatch(/^MAIN-12 /u)
  })
})

describe('pins on the rail', () => {
  it('pins through the store and draws the frame the pin answers with', async () => {
    const { store, wrapper } = rail(busyFrame())
    const pinned = busyFrame()
    const at = pinned.spaces[0].rows.findIndex((each) => each.reference === 'MAIN-12')
    pinned.spaces[0].rows[at] = { ...pinned.spaces[0].rows[at], pinned: true }
    const pin = vi.spyOn(store, 'pin').mockImplementation(async () => store.accept(pinned))
    row(wrapper, 'MAIN-12').querySelector<HTMLElement>('.nav-row-pin')?.click()
    await flushPromises()
    expect(pin).toHaveBeenCalledWith('MAIN-12', true)
    expect(row(wrapper, 'MAIN-12').classList).toContain('pinned')
  })
})
