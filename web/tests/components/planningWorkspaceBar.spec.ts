/**
 * The bar above the work: one row of controls named from the keyboard, and one
 * line of state that answers the filter. The layout itself — one row at 1440
 * and 1024, what folds on a phone — is the browser suite's, which has widths.
 */
import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import PlanningWorkspaceBar from '@/pages/planning/PlanningWorkspaceBar.vue'

import { EMPTY_WORK_FILTER } from '@/entities/work-item/utils/workFilter.ts'
import type { WorkFilter } from '@/entities/work-item/utils/workFilter.ts'

import { messages, pluralRules } from '@/shared/i18n/index.ts'

const COUNTS = { held: 1, matchedClosed: 0, matchedOpen: 2, open: 2, total: 3 }

function bar(
  props: Partial<InstanceType<typeof PlanningWorkspaceBar>['$props']> = {},
  locale = 'en',
) {
  const wrapper = mount(PlanningWorkspaceBar, {
    attachTo: document.body,
    props: {
      'busy': false,
      'categories': ['backlog', 'active'] as const,
      'chain': null,
      'counts': COUNTS,
      'exclusion': null,
      'filter': EMPTY_WORK_FILTER,
      'filtered': false,
      'grouping': 'none' as const,
      'items': [],
      'stored': true,
      'view': 'kanban' as const,
      'writable': true,
      'onUpdate:filter': (next: WorkFilter) => wrapper.setProps({ filter: next }),
      ...props,
    },
    global: { plugins: [createI18n({ legacy: false, locale, messages, pluralRules })] },
  })
  return wrapper
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('the work bar', () => {
  it('holds the view, one filter field, the grouping and the action in one row', () => {
    const wrapper = bar()
    const row = wrapper.get('.workspace-tools')
    expect(row.find('[role="group"][aria-label="View"]').exists()).toBe(true)
    expect(row.get('input[role="combobox"]').attributes('aria-label')).toBe('Filter work')
    expect(row.find('[role="switch"]').exists()).toBe(true)
    // The one primary action ends the row, not the line of state under it.
    expect(row.get('.workspace-action').text()).toBe('+New work item')
    expect(wrapper.get('.workspace-status').find('.workspace-action').exists()).toBe(false)
    // No queue of five segments beside a search: the filter is one model.
    expect(wrapper.find('[aria-label="Work queue"]').exists()).toBe(false)
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

  it.each([
    ['en', 2, 3, '2 open of 3'],
    ['ru', 1, 3, '1\u{A0}открытая из 3'],
    // The few form of the adjective agrees with the nominative count: «3 открытые».
    ['ru', 3, 30, '3\u{A0}открытые из 30'],
    ['ru', 21, 30, '21\u{A0}открытая из 30'],
  ])('says how much is open, unfiltered (%s, %i)', (locale, open, total, line) => {
    const wrapper = bar({ counts: { ...COUNTS, open, total } }, locale)
    expect(wrapper.get('.workspace-figures').text()).toBe(line)
  })

  it.each([
    ['en', 1, '1 epic as a row'],
    ['en', 2, '2 epics as rows'],
    ['ru', 1, '1\u{A0}эпик строкой'],
    ['ru', 2, '2\u{A0}эпика строками'],
    ['ru', 5, '5\u{A0}эпиков строками'],
    ['ru', 21, '21\u{A0}эпик строкой'],
  ] as const)(
    'says how many epics the grouped board draws as rows (%s, %i)',
    (locale, epics, text) => {
      const wrapper = bar(
        { grouping: 'epic', exclusion: { kind: 'lane-heads', count: epics } },
        locale,
      )
      // Unfiltered, the rows come last on the counts line: no Reset follows them.
      expect(wrapper.get('.workspace-figures').text().endsWith(`· ${text}`)).toBe(true)
    },
  )

  it('says nothing about rows where the board is flat or not on the stage', async () => {
    const wrapper = bar({ exclusion: { kind: 'lane-heads', count: 2 } })
    expect(wrapper.get('.workspace-figures').text()).not.toContain('row')
    await wrapper.setProps({ grouping: 'none' })
    expect(wrapper.get('.workspace-figures').text()).not.toContain('row')
  })

  it.each([
    ['en', [42, 319, 0], '42 of 319 open · Reset'],
    ['en', [5, 319, 2], '5 of 319 open · Reset'],
    ['ru', [42, 319, 0], '42 из 319\u{A0}открытых · Сбросить'],
    ['ru', [1, 21, 1], '1 из 21\u{A0}открытой · Сбросить'],
    // With nothing open let through, the closed ones that came with it are said.
    ['en', [0, 319, 1], '0 of 319 open · 1 closed match · Reset'],
    ['en', [0, 319, 3], '0 of 319 open · 3 closed matches · Reset'],
    ['ru', [0, 319, 1], '0 из 319\u{A0}открытых · есть 1\u{A0}закрытая · Сбросить'],
    ['ru', [0, 319, 2], '0 из 319\u{A0}открытых · есть 2\u{A0}закрытые · Сбросить'],
    ['ru', [0, 319, 5], '0 из 319\u{A0}открытых · есть 5\u{A0}закрытых · Сбросить'],
    ['ru', [0, 319, 21], '0 из 319\u{A0}открытых · есть 21\u{A0}закрытая · Сбросить'],
    // Nothing let through is a number too, not the open count it is out of.
    ['en', [0, 319, 0], '0 of 319 open · Reset'],
    ['ru', [0, 319, 0], '0 из 319\u{A0}открытых · Сбросить'],
    // The word agrees with the open count it follows, not with what matched.
    ['ru', [2, 21, 0], '2 из 21\u{A0}открытой · Сбросить'],
  ] as const)(
    'answers the filter (%s, %j: let through, open, closed let through)',
    (locale, [matchedOpen, open, matchedClosed], line) => {
      const wrapper = bar(
        {
          counts: { ...COUNTS, matchedClosed, matchedOpen, open },
          filter: { text: 'x' },
          filtered: true,
        },
        locale,
      )
      expect(wrapper.get('.workspace-figures').text()).toBe(line)
    },
  )

  it('takes the filter back to nothing from the line of state', async () => {
    const wrapper = bar({ filter: { text: 'x', labels: ['ui'] }, filtered: true })
    await wrapper.get('.workspace-figures button').trigger('click')
    expect(wrapper.emitted<[WorkFilter]>('update:filter')?.at(-1)?.[0]).toEqual(EMPTY_WORK_FILTER)
    // The button went with the filter; the caret is in the field, not on the page.
    expect(document.activeElement).toBe(wrapper.get('input').element)
  })

  it('shows each picked facet as a chip that takes itself out', async () => {
    const wrapper = bar({
      filter: { text: '', labels: ['ui'], priority: ['high'] },
      filtered: true,
    })
    const chips = wrapper.findAll('.workspace-chips .filter-chip')
    expect(chips.map((chip) => chip.text())).toEqual(['Priority: High', 'Label: ui'])
    expect(chips[1]?.attributes('aria-label')).toBe('Remove from filter: Label: ui')
    await chips[1]?.trigger('click')
    expect(wrapper.emitted<[WorkFilter]>('update:filter')?.at(-1)?.[0]).toEqual({
      text: '',
      priority: ['high'],
    })
  })

  it('leaves the grouped board’s epics to the lanes, and says what the graph leaves out', async () => {
    const wrapper = bar({ grouping: 'epic' })
    expect(wrapper.find('.workspace-left-out').exists()).toBe(false)
    await wrapper.setProps({
      grouping: null,
      view: 'graph',
      exclusion: { kind: 'graph-parents', count: 2, open: 1 },
    })
    expect(wrapper.get('.workspace-left-out').text()).toBe(
      '2 parent tasks are drawn as groups, not nodes (1 open)',
    )
  })

  it('says when the address cannot keep the whole filter', () => {
    const wrapper = bar({ stored: false, filtered: true, filter: { text: 'x' } })
    expect(wrapper.text()).toContain('a reload keeps only part of it')
  })

  it('names the chain with the number the counts give, and leaves it on request', async () => {
    const wrapper = bar({ chain: 'MAIN-1' })
    const chip = wrapper.get('.workspace-chip')
    expect(chip.text()).toBe('Chain MAIN-1 · 3')
    expect(wrapper.get('.workspace-figures').text()).toBe('2 open of 3')
    await chip.trigger('click')
    expect(wrapper.emitted('exit-chain')).toHaveLength(1)
  })
})
