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
      'Removed saved views this version cannot read: “Former lanes”, “Old column”, “Old scope”',
    )
    const listed = entriesOf(wrapper).find((entry) => entry.key === 'views')
    expect(listed?.kind === 'choice' && listed.options.map((option) => option.label)).toEqual([
      'Lanes',
      'Tree',
    ])
    expect(stored()[PLACE]?.map((view) => view.name)).toEqual(['Lanes', 'Tree'])
    expect(stored()[OTHER]?.map((view) => view.name)).toEqual(['Former lanes'])

    // Once the menu that said so has closed, it says it no more, nor after a reload.
    wrapper.getComponent(MenuStub).vm.$emit('close')
    await wrapper.vm.$nextTick()
    expect(noteOf(wrapper)).toBeUndefined()
    wrapper.unmount()
    expect(noteOf(menu())).toBeUndefined()
  })

  it('names one view in the singular, in Russian too', () => {
    store({ [PLACE]: [{ name: 'Старые колонки', state: { cat: 'queued' } }] })
    expect(noteOf(menu('ru'))).toBe(
      'Убран сохранённый вид, которого эта версия не читает: «Старые колонки»',
    )
    expect(stored()[PLACE]).toBeUndefined()
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
