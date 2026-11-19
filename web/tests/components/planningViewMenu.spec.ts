/**
 * The view's menu and a saved view this build does not read: it is removed from the
 * owner's settings as the space opens, and the menu names it once, before its entries.
 * The menu itself, its keys and its focus, is `VMenu`'s; this reads the entries it is
 * handed and answers its close as the real menu does.
 */
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent } from 'vue'
import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import PlanningViewMenu from '@/pages/planning/PlanningViewMenu.vue'

import { messages, pluralRules } from '@/shared/i18n/index.ts'
import { readSavedViews } from '@/shared/lib/savedViews.ts'
import type { SavedViews } from '@/shared/lib/savedViews.ts'
import type { MenuEntry } from '@/shared/ui/menuEntries.ts'

const PLACE = 'scope:MAIN'
const OTHER = 'scope:SIDE'
const STORAGE = 'valkama-settings'

const MenuStub = defineComponent({
  name: 'VMenu',
  props: {
    entries: { type: Array as () => MenuEntry[], required: true },
    label: { type: String, required: true },
  },
  emits: ['close'],
  template: '<div class="menu-stub" :aria-label="label" />',
})

function store(views: SavedViews) {
  localStorage.setItem(STORAGE, JSON.stringify({ views }))
}

const stored = () => readSavedViews(JSON.parse(localStorage.getItem(STORAGE) ?? '{}').views)

function menu(locale = 'en') {
  setActivePinia(createPinia())
  return mount(PlanningViewMenu, {
    props: { grouping: 'none', place: PLACE, state: { view: 'kanban' } },
    global: {
      plugins: [createI18n({ legacy: false, locale, messages, pluralRules })],
      stubs: { VMenu: MenuStub, SaveViewDialog: true },
    },
  })
}

/** The entries of the menu the row shows now: both copies are handed the same ones. */
const entriesOf = (wrapper: ReturnType<typeof menu>) =>
  wrapper.getComponent(MenuStub).props('entries') as MenuEntry[]

const noteOf = (wrapper: ReturnType<typeof menu>) =>
  entriesOf(wrapper).find((entry) => entry.kind === 'note')?.label

beforeEach(() => {
  localStorage.clear()
})
afterEach(() => {
  document.body.innerHTML = ''
})

describe('the view menu and a saved view this build does not read', () => {
  it('removes such views from the settings and names them once, before its entries', async () => {
    store({
      [PLACE]: [
        { name: 'Lanes', state: { view: 'kanban', group: 'goal' } },
        { name: 'Former lanes', state: { view: 'kanban', group: 'former' } },
        { name: 'Old column', state: { view: 'kanban', cat: 'queued' } },
        { name: 'Old scope', state: { chain: 'MAIN-1', chain_scope: 'former' } },
        { name: 'Tree', state: { chain: 'MAIN-1', chain_scope: 'tree' } },
      ],
      // Another space's views wait until that space is opened.
      [OTHER]: [{ name: 'Former lanes', state: { group: 'former' } }],
    })
    const wrapper = menu()

    expect(entriesOf(wrapper)[0]).toMatchObject({ kind: 'note', key: 'dropped' })
    expect(noteOf(wrapper)).toBe(
      'Removed views with values this version does not know: “Former lanes”, “Old column”, “Old scope”',
    )
    const listed = entriesOf(wrapper).find((entry) => entry.key === 'views')
    expect(listed?.kind === 'choice' && listed.options.map((option) => option.label)).toEqual([
      'Lanes',
      'Tree',
    ])
    expect(stored()[PLACE]?.map((view) => view.name)).toEqual(['Lanes', 'Tree'])
    expect(stored()[OTHER]?.map((view) => view.name)).toEqual(['Former lanes'])

    // Once the menu that said so has closed, it says it no more, nor after a reload. A menu
    // closes a moment after the space opened, never in the tick of the write that opening made.
    await wrapper.vm.$nextTick()
    wrapper.getComponent(MenuStub).vm.$emit('close')
    await wrapper.vm.$nextTick()
    expect(noteOf(wrapper)).toBeUndefined()
    wrapper.unmount()
    expect(noteOf(menu())).toBeUndefined()
  })

  it('names one view in the singular, in Russian too', () => {
    store({ [PLACE]: [{ name: 'Старые колонки', state: { cat: 'queued' } }] })
    expect(noteOf(menu('ru'))).toBe(
      'Убран вид со значениями, которых эта версия не знает: «Старые колонки»',
    )
    expect(stored()[PLACE]).toBeUndefined()
  })

  it('names several views in Russian as the plural the note takes', () => {
    store({
      [PLACE]: [
        { name: 'Старые колонки', state: { cat: 'queued' } },
        { name: 'Старые полосы', state: { group: 'former' } },
      ],
    })
    expect(noteOf(menu('ru'))).toBe(
      'Убраны виды со значениями, которых эта версия не знает: «Старые колонки», «Старые полосы»',
    )
  })

  it('names the views it removed though the menu went before it was opened, and after a reload', async () => {
    store({
      [PLACE]: [
        { name: 'Lanes', state: { view: 'kanban', group: 'goal' } },
        { name: 'Former lanes', state: { view: 'kanban', group: 'former' } },
      ],
    })
    // The space was opened and left, and the page reloaded, with the menu never opened.
    menu().unmount()
    expect(stored()[PLACE]?.map((view) => view.name)).toEqual(['Lanes'])
    menu().unmount()
    const wrapper = menu()
    expect(noteOf(wrapper)).toBe(
      'Removed a view with values this version does not know: “Former lanes”',
    )

    // Said once, whichever menu said it: the next one, and the next page, say nothing.
    wrapper.getComponent(MenuStub).vm.$emit('close')
    await wrapper.vm.$nextTick()
    expect(noteOf(wrapper)).toBeUndefined()
    wrapper.unmount()
    expect(noteOf(menu())).toBeUndefined()
  })

  it('names a view only in the space it was removed from', () => {
    store({ [OTHER]: [{ name: 'Former lanes', state: { group: 'former' } }] })
    setActivePinia(createPinia())
    mount(PlanningViewMenu, {
      props: { grouping: 'none', place: OTHER, state: { view: 'kanban' } },
      global: {
        plugins: [createI18n({ legacy: false, locale: 'en', messages, pluralRules })],
        stubs: { VMenu: MenuStub, SaveViewDialog: true },
      },
    }).unmount()
    expect(noteOf(menu())).toBeUndefined()
  })

  it('says nothing and keeps every view this build reads', () => {
    const views: SavedViews = {
      [PLACE]: [
        { name: 'Lanes', state: { view: 'kanban', group: 'goal' } },
        { name: 'Bugs', state: { view: 'list', kind: 'bug,stage', cat: 'triage,%-ready' } },
      ],
    }
    store(views)
    const wrapper = menu()
    expect(noteOf(wrapper)).toBeUndefined()
    expect(stored()).toEqual(views)
  })
})

/** The menu of a board offering every grouping, in the order given. */
function ordered(sort: { descending: boolean; key: 'created' | 'queue' | 'title' }) {
  setActivePinia(createPinia())
  return mount(PlanningViewMenu, {
    props: {
      grouping: 'stage',
      groupings: ['none', 'goal', 'stage', 'project'],
      place: PLACE,
      sort,
      state: { view: 'kanban' },
    },
    global: {
      plugins: [createI18n({ legacy: false, locale: 'en', messages, pluralRules })],
      stubs: { VMenu: MenuStub, SaveViewDialog: true },
    },
  })
}
const choice = (wrapper: ReturnType<typeof ordered>, key: string) => {
  const found = entriesOf(wrapper).find((entry) => entry.key === key)
  if (found?.kind !== 'choice') throw new Error(`no choice ${key}`)
  return found
}
const labels = (wrapper: ReturnType<typeof ordered>, key: string) =>
  choice(wrapper, key).options.map((option) => option.label)

describe('the view menu’s grouping and order', () => {
  it('offers every grouping the view has, and the one in force chosen', () => {
    const wrapper = ordered({ key: 'queue', descending: false })
    expect(labels(wrapper, 'grouping')).toEqual([
      'No grouping',
      'By goal',
      'By stage',
      'By project',
    ])
    expect(choice(wrapper, 'grouping').value).toBe('stage')
    choice(wrapper, 'grouping').select('project')
    expect(wrapper.emitted('group')).toEqual([['project']])
  })

  it('offers the four orders and a direction that says what comes first', () => {
    const wrapper = ordered({ key: 'created', descending: true })
    expect(choice(wrapper, 'sort').options.map((option) => option.value)).toEqual([
      'queue',
      'updated',
      'created',
      'priority',
    ])
    expect(choice(wrapper, 'sort').value).toBe('created')
    // The end a key reads first leads: the newest filed for the filing time.
    expect(choice(wrapper, 'direction').options.map((option) => option.value)).toEqual([
      'true',
      'false',
    ])
    expect(choice(wrapper, 'direction').value).toBe('true')
  })

  it('asks for an order from the end it reads first, and keeps the key when turned over', () => {
    const wrapper = ordered({ key: 'queue', descending: false })
    choice(wrapper, 'sort').select('priority')
    choice(wrapper, 'direction').select('true')
    expect(wrapper.emitted('sort')).toEqual([
      [{ key: 'priority', descending: true }],
      [{ key: 'queue', descending: true }],
    ])
  })

  it('names a list column’s order a header chose among the four', () => {
    const wrapper = ordered({ key: 'title', descending: false })
    expect(choice(wrapper, 'sort').options.map((option) => option.value)).toContain('title')
    expect(choice(wrapper, 'sort').value).toBe('title')
  })
})
