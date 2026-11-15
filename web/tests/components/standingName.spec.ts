/**
 * The words for where an item stands: a state of the space's own by its name, and
 * an accepted open goal or stage, which stands in no state, by what it derives
 * from the work under it — in the interface's language.
 */
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'

import { messages, pluralRules } from '@/shared/i18n/index.ts'
import type { StandingItem } from '@/shared/lib/standing.ts'
import { useStandingName } from '@/shared/lib/useStateName.ts'

const render = () => h('div')

function named(locale: string, items: StandingItem[]) {
  let names: string[] = []
  mount(
    defineComponent({
      setup() {
        const name = useStandingName()
        names = items.map((item) => name(item))
        return render
      },
    }),
    { global: { plugins: [createI18n({ legacy: false, locale, messages, pluralRules })] } },
  ).unmount()
  return names
}

const task: StandingItem = {
  state: { name: 'Deploy', key: 'deploy', category: 'active' },
  container_state: null,
}
const derived = (container_state: StandingItem['container_state']): StandingItem => ({
  state: null,
  container_state,
})
const ITEMS = [
  task,
  derived('not_started'),
  derived('in_progress'),
  derived('awaiting_confirmation'),
]

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
})

describe('where an item stands, in words', () => {
  it('names a state by its name and a container by what it derives', () => {
    expect(named('en', ITEMS)).toEqual([
      'Deploy',
      'Not started',
      'In progress',
      'Awaiting confirmation',
    ])
    expect(named('ru', ITEMS)).toEqual(['Deploy', 'Не начато', 'В работе', 'Ждёт подтверждения'])
  })
})
