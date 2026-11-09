/**
 * The rail's list of work going on now, as `kb`-free behaviour a reader relies on: the
 * frame's order drawn as it came, a row that left fading where it stood, the folds kept
 * on the device, and the rows that say a state other than work in words and no dots.
 */
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AppNav from '@/widgets/app-nav/components/AppNav.vue'

import type { LiveFrame } from '@/shared/api/liveFrameModel.ts'
import { planningTargetRoute } from '@/shared/api/planningTarget.ts'
import type { ModuleManifest } from '@/shared/api/platformModuleContract.ts'
import { messages, pluralRules } from '@/shared/i18n/index.ts'
import { FADING_MS, useLiveWorkStore } from '@/shared/stores/liveWorkStore.ts'
import { tooltipOf } from '@/shared/ui/tooltipAnchors.ts'

import { busyFrame, liveFrame, liveRow, liveSpace } from '../support/liveFrame.ts'

/** The hint a row shows: its number and title, and the state when it has one. */
const hintOf = (row: Element) => tooltipOf(row)?.text

const SCOPE = '123e4567-e89b-42d3-a456-426614174000'
const planning = {
  icon_key: 'board',
  module_id: 'planning',
  navigation_group: 'work',
  title_key: 'platform.modules.planning',
} as ModuleManifest

function target(place: { key: string; project_id: string | null; reference: string | null }) {
  if (place.project_id === null || place.reference === null) return null
  return planningTargetRoute({
    project_id: place.project_id,
    space_ref: { data_scope_id: SCOPE, space_key: place.key },
    reference: place.reference,
    writable: true,
  })
}

function rail(frame: LiveFrame | null, locale: 'en' | 'ru' = 'en', shown = null as never) {
  const store = useLiveWorkStore()
  if (frame) store.accept(frame)
  const wrapper = mount(AppNav, {
    attachTo: document.body,
    props: { active: 'planning', modules: [planning], liveTarget: target, liveShown: shown },
    global: {
      plugins: [
        createI18n({
          legacy: false,
          locale,
          fallbackLocale: 'en',
          messages,
          pluralRules,
          datetimeFormats: {
            en: { day: { month: 'short', day: '2-digit' } },
            ru: { day: { month: 'short', day: '2-digit' } },
          },
        }),
      ],
    },
  })
  return { store, wrapper }
}

/** The references the rail's list draws, in the order it draws them. */
const drawn = (wrapper: ReturnType<typeof rail>['wrapper']) =>
  wrapper
    .findAll('.nav-work-list .nav-row-link')
    .map((link) => link.attributes('aria-label')?.split(' ')[0])

const row = (wrapper: ReturnType<typeof rail>['wrapper'], reference: string) => {
  const link = wrapper
    .findAll('.nav-work-list .nav-row-link')
    .find((candidate) => candidate.attributes('aria-label')?.startsWith(`${reference} `))
  if (!link) throw new Error(`no row ${reference}`)
  return link.element.closest('.nav-row') as HTMLElement
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('the order the frame came in', () => {
  it('draws rows as the frame orders them and never sorts them itself', () => {
    // Out of numeric order on purpose: the frame's order is the server's, by position.
    const { wrapper } = rail(
      liveFrame([
        liveSpace('MAIN', [
          liveRow('MAIN-9', { kind: 'epic', title: 'Later epic' }),
          liveRow('MAIN-30', { parent: 'MAIN-9', state: 'working' }),
          liveRow('MAIN-4', { kind: 'epic', title: 'Earlier epic' }),
          liveRow('MAIN-12', { parent: 'MAIN-4', state: 'held' }),
          liveRow('MAIN-2', { state: 'waiting' }),
        ]),
        liveSpace('NEXT', [liveRow('NEXT-1', { state: 'working' })]),
      ]),
    )
    expect(drawn(wrapper)).toEqual(['MAIN-9', 'MAIN-30', 'MAIN-4', 'MAIN-12', 'MAIN-2', 'NEXT-1'])
    // A row stands in its parent's group, a level deeper; one with no parent at the space's.
    const level = (reference: string) =>
      row(wrapper, reference).style.getPropertyValue('--nav-row-depth')
    expect([level('MAIN-9'), level('MAIN-30'), level('MAIN-2')]).toEqual(['1', '2', '1'])
    expect(wrapper.findAll('.nav-tree-space-name').map((name) => name.text())).toEqual([
      'MAIN · MAIN space',
      'NEXT · NEXT space',
    ])
  })

  it('prints a row by its number alone, the space being named above it', () => {
    const { wrapper } = rail(busyFrame())
    expect(row(wrapper, 'MAIN-12').querySelector('.nav-row-number')?.textContent).toBe('12')
    expect(hintOf(row(wrapper, 'MAIN-12'))).toBe(
      'MAIN-12 Answer a review in one form\nworking, 2 agents',
    )
  })
})

const before = () =>
  liveFrame([
    liveSpace('MAIN', [
      liveRow('MAIN-3', { state: 'working' }),
      liveRow('MAIN-5', { state: 'working' }),
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
    expect(row(wrapper, 'MAIN-5').querySelector('.work-dots')).toBeNull()
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

describe('folds', () => {
  it('opens a node nobody folded, and keeps a fold on the device', async () => {
    const { wrapper } = rail(busyFrame())
    const fold = wrapper.get('.nav-tree-fold')
    expect(fold.attributes('aria-expanded')).toBe('true')
    await fold.trigger('click')
    expect(fold.attributes('aria-expanded')).toBe('false')
    expect(JSON.parse(localStorage.getItem('valkama-nav-open') ?? '{}')).toEqual({
      'space:MAIN': false,
    })
    wrapper.unmount()

    setActivePinia(createPinia())
    const again = rail(busyFrame()).wrapper
    const folds = again.findAll('.nav-tree-fold')
    expect(folds.map((each) => each.attributes('aria-expanded'))).toEqual(['false', 'true'])
    // Opened again, the memory forgets the node rather than keeping it as open.
    await folds[0].trigger('click')
    expect(JSON.parse(localStorage.getItem('valkama-nav-open') ?? '{}')).toEqual({})
  })

  it('folds the group around focus on Escape and gives focus to its fold', async () => {
    const { wrapper } = rail(busyFrame())
    const link = row(wrapper, 'MAIN-12').querySelector<HTMLElement>('.nav-row-link')
    link?.focus()
    link?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    const epicFold = row(wrapper, 'MAIN-4').querySelector<HTMLElement>('.nav-row-fold')
    expect(epicFold?.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(epicFold)
    // Folded, the next Escape goes on to the space around it.
    epicFold?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
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

describe('rows with no work moving', () => {
  it('mutes a quiet row, draws no dots for it, and says since when it is silent', () => {
    const { wrapper } = rail(busyFrame(), 'ru')
    const quiet = row(wrapper, 'MAIN-14')
    expect(quiet.classList).toContain('muted')
    expect(quiet.querySelector('.work-dots')).toBeNull()
    // The number and the title are on the row: its hint is the reason alone, and always shows.
    expect(hintOf(quiet)).toMatch(/^молчит с 03 нояб\.?$/u)
    expect(tooltipOf(quiet)?.clipped).toBe(false)
  })

  it('keeps the sign’s room on a pinned row with no work, and says why it is there', () => {
    const { wrapper } = rail(busyFrame())
    const idle = row(wrapper, 'MAIN-20')
    const working = row(wrapper, 'MAIN-31')
    expect(idle.classList).toContain('muted')
    expect(idle.querySelector('.nav-row-lead')?.children).toHaveLength(0)
    expect(working.querySelector('.nav-row-lead')?.children).toHaveLength(1)
    expect(hintOf(idle)).toBe('Pinned · no work now · Backlog')
    expect(idle.querySelector('.nav-row-meta')).toBeNull()
    expect(idle.querySelector('.nav-row-pin')?.getAttribute('aria-label')).toBe(
      'Pinned to Work: press to remove the pin',
    )
  })

  it('says a pinned closed item’s state where the agents would be counted', () => {
    const { wrapper } = rail(busyFrame())
    const closed = row(wrapper, 'MAIN-7')
    expect(closed.classList).toContain('muted')
    expect(closed.querySelector('.nav-row-meta')?.textContent?.trim()).toBe('Done')
  })

  it('says nobody is working when the frame has nothing to show', () => {
    const { wrapper } = rail(liveFrame([]), 'ru')
    expect(wrapper.get('.nav-work-list').text()).toBe('Сейчас никто не работает')
  })

  it('counts agents on no row in their space and outside every space', () => {
    const { wrapper } = rail(busyFrame(), 'ru')
    const notes = wrapper.findAll('.nav-tree-note').map((note) => note.text())
    expect(notes).toEqual(['без задачи · 2\u{A0}агента', 'Вне пространств · 1\u{A0}агент'])
  })
})

describe('the count on a phone’s rail', () => {
  it('counts the items a session is on now, and nothing that only stands in the list', async () => {
    const { store, wrapper } = rail(busyFrame())
    const count = () => wrapper.get('.nav-work-rail').attributes('aria-label')
    // Working, held or waiting: the epic at work, MAIN-12, MAIN-13, MAIN-31 and NEXT-5.
    // The quiet row and the two pinned rows with no work stand in the list uncounted.
    expect(count()).toBe('Work going on now: 5')
    const dropped = busyFrame()
    dropped.spaces[0].rows = dropped.spaces[0].rows.filter((each) => each.reference !== 'MAIN-12')
    store.accept(dropped)
    await flushPromises()
    // A row that left still fades in the list, but nobody is on it now.
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
