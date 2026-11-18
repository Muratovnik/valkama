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
    numbers: { triage: 4, ready: 3, active: 2, waiting_owner: 1 },
    numbers_absent: null,
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
    numbers: { triage: 0, ready: 0, active: 0, waiting_owner: 0 },
    numbers_absent: null,
    default_project: null,
    projects: [],
  },
]

function portfolio(locale: 'en' | 'ru' = 'en', shown = spaces) {
  return mount(PlanningPortfolio, {
    props: { spaces: shown },
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

  it('shows no count for a space whose store could not be read', () => {
    const unread = {
      space_ref: { data_scope_id: STORE, space_key: 'FAR' },
      title: 'FAR',
      work_item_count: null,
      numbers: null,
      numbers_absent: 'unreadable' as const,
      default_project: null,
      projects: [],
    }
    const [card] = portfolio('en', [unread]).findAll('.portfolio-space')
    expect(card?.get('.space-title').text()).toBe('FAR')
    expect(card?.find('.space-count').exists()).toBe(false)
    expect(card?.text()).not.toContain('null')
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
