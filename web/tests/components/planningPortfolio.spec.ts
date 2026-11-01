import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import PlanningPortfolio from '@/pages/planning/PlanningPortfolio.vue'

import { messages } from '@/shared/i18n/index.ts'

const bindingStates = ['mapped', 'unbound', 'unavailable'] as const

const projects = bindingStates.map((bindingState) => ({
  binding_state: bindingState,
  planning_spaces:
    bindingState === 'mapped'
      ? [
          {
            space_ref: {
              data_scope_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              space_key: 'MAIN',
            },
            title: 'Main',
            work_item_count: 2,
          },
        ]
      : [],
  project_id: `${bindingState}-project`,
  title: `${bindingState} Project`,
}))

function portfolio(locale: 'en' | 'ru' = 'en') {
  return mount(PlanningPortfolio, {
    props: { projects },
    global: {
      plugins: [createI18n({ legacy: false, locale, messages })],
    },
  })
}

describe('PlanningPortfolio', () => {
  it('keeps every registered project visible with its human name before its identifier', () => {
    const rows = portfolio().findAll('.portfolio-project')
    expect(rows).toHaveLength(bindingStates.length)
    expect(rows[1]?.find('.project-head > div').text()).toBe('unbound Projectunbound-project')
    const binding = rows[1]?.get('[data-dimension="project-binding"]')
    expect(binding?.attributes('data-state')).toBe('unbound')
    expect(binding?.text()).toBe('Unbound')
    expect(rows[1]?.text()).toContain('No bound planning spaces yet.')
    expect(rows[1]?.find('.binding-reason').exists()).toBe(false)
  })

  // «Mapped» on every card, beside the «Open project» that says the same, told
  // the reader nothing; only a project that cannot be opened names its state.
  it.each([
    ['en', ['Unbound', 'Unavailable']],
    ['ru', ['Не связан', 'Недоступен']],
  ] as const)(
    'renders every binding state but mapped through the shared semantic owner in %s',
    (locale, labels) => {
      const wrapper = portfolio(locale)
      const states = wrapper.findAll('[data-dimension="project-binding"]')

      expect(states.map((state) => state.attributes('data-state'))).toEqual([
        'unbound',
        'unavailable',
      ])
      expect(states.map((state) => state.text())).toEqual(labels)
      const mapped = wrapper.findAll('.portfolio-project')[0]
      expect(mapped?.find('[data-dimension="project-binding"]').exists()).toBe(false)
      expect(mapped?.find('button.open-project').exists()).toBe(true)
    },
  )

  it('opens a mapped project and routes an unbound project to actionable recovery', async () => {
    const wrapper = portfolio()
    const rows = wrapper.findAll('.portfolio-project')

    await rows[0]?.get('button.open-project').trigger('click')
    expect(wrapper.emitted('open-project')).toEqual([['mapped-project']])

    const unbound = rows[1]
    expect(unbound?.find('button').exists()).toBe(false)
    expect(unbound?.get('a.binding-recovery').attributes('href')).toBe(
      '/modules/settings/project/unbound-project',
    )
    expect(unbound?.get('a.binding-recovery').text()).toContain('Review project setup')
  })
})
