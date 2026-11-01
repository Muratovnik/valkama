/**
 * The bar above the work: one control per choice, reachable and named from the
 * keyboard, however compact the row it sits in. The layout itself — one row,
 * the queue folded into a menu — is the browser suite's, which has widths.
 */
import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import PlanningWorkspaceBar from '@/pages/planning/PlanningWorkspaceBar.vue'

import { messages, pluralRules } from '@/shared/i18n/index.ts'

function bar(props: Partial<InstanceType<typeof PlanningWorkspaceBar>['$props']> = {}) {
  return mount(PlanningWorkspaceBar, {
    attachTo: document.body,
    props: {
      busy: false,
      chain: null,
      counts: { held: 1, open: 2, total: 3 },
      exclusion: null,
      grouping: 'none',
      matches: null,
      view: 'kanban',
      writable: true,
      queue: 'all',
      query: '',
      ...props,
    },
    global: { plugins: [createI18n({ legacy: false, locale: 'en', messages })] },
  })
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('the work bar', () => {
  it('keeps the search named for assistive technology with its label out of sight', () => {
    const wrapper = bar()
    const field = wrapper.get('input[aria-label="Find work"]')
    expect(field.attributes('placeholder')).toBe('Reference or title')
    expect(wrapper.get('.field-label').classes()).toContain('visually-hidden')
  })

  it('hands the caret back to the search when the clear button goes away', async () => {
    const wrapper = bar({
      'query': 'MAIN',
      'onUpdate:query': (value: string) => wrapper.setProps({ query: value }),
    })
    const clear = wrapper.get('button[aria-label="Clear search"]')
    ;(clear.element as HTMLButtonElement).focus()
    await clear.trigger('click')
    expect(wrapper.emitted('update:query')).toEqual([['']])
    expect(wrapper.find('button[aria-label="Clear search"]').exists()).toBe(false)
    expect(document.activeElement).toBe(wrapper.get('input').element)
  })

  it('offers the queue as segments and as a menu over one choice', async () => {
    const wrapper = bar({ queue: 'ready' })
    const segments = wrapper.get('[role="group"][aria-label="Work queue"]')
    expect(segments.get('[aria-pressed="true"]').text()).toBe('Ready')
    expect(wrapper.get('.workspace-queue-menu .choice-title').text()).toBe('Ready')
    await wrapper.setProps({ queue: 'all' })
    // On the trigger «All» alone would not say all of what.
    expect(wrapper.get('.workspace-queue-menu .choice-title').text()).toBe('All work')
    expect(segments.get('[aria-pressed="true"]').text()).toBe('All')
  })

  it('offers the grouping only while the board is on the stage, as one switch', async () => {
    const wrapper = bar({ grouping: 'epic' })
    const grouping = wrapper.get('[role="switch"]')
    expect(grouping.attributes('aria-label')).toBe('Group the board by epic')
    expect(grouping.attributes('aria-checked')).toBe('true')
    await grouping.trigger('click')
    expect(wrapper.emitted('group')).toEqual([['none']])
    await wrapper.setProps({ grouping: null })
    expect(wrapper.find('[role="switch"]').exists()).toBe(false)
  })

  // The notes were lowercase fragments («эпики рядов не в колонках: 26»); each is
  // a sentence now, in the form Russian gives each number.
  it.each([
    [1, '1\u{A0}эпик — заголовок ряда, а не карточка в колонке'],
    [3, '3\u{A0}эпика — заголовки рядов, а не карточки в колонках'],
    [26, '26\u{A0}эпиков — заголовки рядов, а не карточки в колонках'],
  ])('says what the grouped board leaves out in Russian for %i', (count, sentence) => {
    const wrapper = mount(PlanningWorkspaceBar, {
      props: {
        busy: false,
        chain: null,
        counts: { held: 0, open: 1, total: 30 },
        exclusion: { kind: 'lane-heads', count },
        grouping: 'epic',
        matches: null,
        view: 'kanban',
        writable: true,
        queue: 'all',
        query: '',
      },
      global: { plugins: [createI18n({ legacy: false, locale: 'ru', messages, pluralRules })] },
    })
    expect(wrapper.get('.workspace-left-out').text()).toBe(sentence)
  })

  it('names the chain with the number the counts line gives, and leaves it on request', async () => {
    const wrapper = bar({ chain: 'MAIN-1' })
    const chip = wrapper.get('.workspace-chip')
    expect(chip.text()).toBe('Chain MAIN-1 · 3')
    expect(wrapper.get('.workspace-counts').text()).toBe('2 open of 3 · 1 open claimed')
    await chip.trigger('click')
    expect(wrapper.emitted('exit-chain')).toHaveLength(1)
  })
})
