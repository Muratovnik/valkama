/**
 * The head of an epic's row on the grouped board: what it prints on its one line.
 * That its actions come up under a pointer and a key is the browser suite's, which
 * has both.
 */
import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import WorkItemLaneHead from '@/widgets/work-item-views/components/WorkItemLaneHead.vue'

import { messages, pluralRules } from '@/shared/i18n/index.ts'

import { boardItem } from '../fixtures/board.ts'

function head(state: 'backlog' | 'todo' | 'dev' | 'done') {
  return mount(WorkItemLaneHead, {
    props: {
      bodyId: 'lane-body',
      lane: {
        closed: 12,
        epic: boardItem(1, state, { kind: 'epic', title: 'An epic' }),
        id: 'lane',
        items: [],
        open: 1,
      },
      left: '',
      open: true,
      right: '',
    },
    global: { plugins: [createI18n({ legacy: false, locale: 'en', messages, pluralRules })] },
  })
}

describe('an epic’s row', () => {
  it.each(['dev', 'done'] as const)('says the state of an epic that has moved (%s)', (state) => {
    expect(head(state).get('.lane-state').classes()).not.toContain('visually-hidden')
  })

  it.each(['backlog', 'todo'] as const)(
    'keeps the state of an epic not started for a screen reader (%s)',
    (state) => {
      const row = head(state)
      expect(row.get('.lane-state').classes()).toContain('visually-hidden')
      expect(row.get('.lane-state').text()).not.toBe('')
    },
  )

  it('keeps its actions in the document, named for the epic, whatever shows them', () => {
    const names = head('backlog')
      .findAll('.lane-actions button')
      .map((button) => button.attributes('aria-label'))
    expect(names).toEqual(['Open MAIN-1', 'Show the chain of MAIN-1 on the board'])
  })
})
