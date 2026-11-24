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

/** A space the directory lists with no numbers, and why. */
const absent = (key: string, reason: 'old_store' | 'unreadable') => ({
  space_ref: { data_scope_id: STORE, space_key: key },
  title: key,
  work_item_count: reason === 'unreadable' ? null : 5,
  numbers: null,
  numbers_absent: reason,
  default_project: null,
  projects: [],
})

function portfolio(locale: 'en' | 'ru' = 'en', shown = spaces) {
  return mount(PlanningPortfolio, {
    props: { spaces: shown },
    global: {
      plugins: [createI18n({ legacy: false, locale, messages })],
      // The line of projects in no space reads the registry; the space window's browser spec
      // drives it against its double, and the cards here need no registry.
      stubs: { UnplacedProjects: true },
    },
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

  it('shows the four numbers of each space, named as the categories and the questions', () => {
    const numbers = portfolio()
      .findAll('.portfolio-space')
      .map((card) =>
        card
          .findAll('[data-number]')
          .map((number) => [
            number.attributes('data-number'),
            number.get('[data-part="label"]').text(),
            number.get('[data-part="figure"]').text(),
          ]),
      )
    expect(numbers).toEqual([
      [
        ['triage', 'Triage', '4'],
        ['ready', 'Ready', '3'],
        ['active', 'In progress', '2'],
        ['waiting_owner', 'Waiting for me', '1'],
      ],
      [
        ['triage', 'Triage', '0'],
        ['ready', 'Ready', '0'],
        ['active', 'In progress', '0'],
        ['waiting_owner', 'Waiting for me', '0'],
      ],
    ])
    expect(portfolio().find('[data-part="absent"]').exists()).toBe(false)
  })

  it('names the four numbers in Russian', () => {
    const [card] = portfolio('ru').findAll('.portfolio-space')
    expect(card?.findAll('[data-part="label"]').map((label) => label.text())).toEqual([
      'Не разобрано',
      'Готово к работе',
      'В работе',
      'Ждут меня',
    ])
  })

  it('shows «—» for each number a space has none for, and says why', () => {
    const cards = portfolio('en', [
      absent('OLD', 'old_store'),
      absent('FAR', 'unreadable'),
    ]).findAll('.portfolio-space')
    expect(cards).toHaveLength(2)
    expect(
      cards.map((card) => card.findAll('[data-part="figure"]').map((figure) => figure.text())),
    ).toEqual([
      ['—', '—', '—', '—'],
      ['—', '—', '—', '—'],
    ])
    expect(cards.map((card) => card.get('[data-part="absent"]').text())).toEqual([
      'No data: an earlier build wrote this space’s store.',
      'The space could not be read.',
    ])
    expect(cards[0]?.get('.space-count').text()).toBe('5 work items')
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
