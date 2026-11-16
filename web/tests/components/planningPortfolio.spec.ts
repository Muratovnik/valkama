import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import PlanningPortfolio from '@/pages/planning/PlanningPortfolio.vue'

import type { PlatformPlanningReady } from '@/shared/api/platformPlanningTypes.ts'
import { messages } from '@/shared/i18n/index.ts'

const STORE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const spaces: PlatformPlanningReady['spaces'] = [
  {
    space_ref: { data_scope_id: STORE, space_key: 'MAIN' },
    title: 'Main work',
    work_item_count: 12,
    default_project: 'alpha',
    projects: [
      { project_id: 'alpha', display_name: 'Alpha' },
      { project_id: 'beta', display_name: 'Beta' },
    ],
  },
  {
    space_ref: { data_scope_id: STORE, space_key: 'NEW' },
    title: 'New space',
    work_item_count: 0,
    default_project: null,
    projects: [],
  },
]

function portfolio(locale: 'en' | 'ru' = 'en') {
  return mount(PlanningPortfolio, {
    props: { spaces },
    global: { plugins: [createI18n({ legacy: false, locale, messages })] },
  })
}

describe('«All spaces»', () => {
  it('shows every space by its name and key, with its work and its projects', () => {
    const cards = portfolio().findAll('.portfolio-space')
    expect(
      cards.map((card) => [
        card.get('.space-title').text(),
        card.get('.space-key').text(),
        card.get('.space-count').text(),
        card.get('.projects-names').text(),
      ]),
    ).toEqual([
      ['Main work', 'MAIN', '12 work items', 'Alpha · Beta'],
      ['New space', 'NEW', '0 work items', 'No projects'],
    ])
  })

  it('says the same in Russian', () => {
    const card = portfolio('ru').findAll('.portfolio-space')[1]
    expect(card?.get('.space-count').text()).toBe('Задач: 0')
    expect(card?.get('.projects-names').text()).toBe('Проектов нет')
    expect(card?.get('button.open-space').text()).toBe('Открыть пространство')
  })

  it('opens the whole space a card stands for, an empty one as well', async () => {
    const wrapper = portfolio()
    const cards = wrapper.findAll('.portfolio-space')
    await cards[1]?.get('button.open-space').trigger('click')
    await cards[0]?.get('button.open-space').trigger('click')
    expect(wrapper.emitted('open-space')).toEqual([
      [{ data_scope_id: STORE, space_key: 'NEW' }],
      [{ data_scope_id: STORE, space_key: 'MAIN' }],
    ])
  })
})
