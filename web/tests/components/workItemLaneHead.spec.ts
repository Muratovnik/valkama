/**
 * The head of a goal's row on the grouped board: what it prints on its one line.
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
  const goal = boardItem(1, state, { kind: 'goal', title: 'A goal' })
  return mount(WorkItemLaneHead, {
    props: {
      bodyId: 'lane-body',
      lane: {
        closed: 12,
        goal,
        head: { kind: 'container', item: goal, path: [] },
        id: 'lane',
        items: [],
        open: 1,
        stages: new Map(),
      },
      left: '',
      open: true,
      right: '',
    },
    global: { plugins: [createI18n({ legacy: false, locale: 'en', messages, pluralRules })] },
  })
}

describe('a goal’s row', () => {
  it.each(['dev', 'done'] as const)('says the state of a goal that has moved (%s)', (state) => {
    expect(head(state).get('.lane-state').classes()).not.toContain('visually-hidden')
  })

  it.each(['backlog', 'todo'] as const)(
    'keeps the state of a goal not started for a screen reader (%s)',
    (state) => {
      const row = head(state)
      expect(row.get('.lane-state').classes()).toContain('visually-hidden')
      expect(row.get('.lane-state').text()).not.toBe('')
    },
  )

  it('keeps its actions in the document, named for the goal, whatever shows them', () => {
    const names = head('backlog')
      .findAll('.lane-actions button')
      .map((button) => button.attributes('aria-label'))
    expect(names).toEqual(['Open MAIN-1', 'Show the chain of MAIN-1 on the board'])
  })
})

/** A stage’s heading by stage: its path is the goal over it. */
function stageHead() {
  const goal = boardItem(1, 'dev', { kind: 'goal', title: 'A goal' })
  const stage = boardItem(2, 'dev', {
    kind: 'stage',
    title: 'A stage',
    parent_id: goal.work_item_id,
  })
  return mount(WorkItemLaneHead, {
    props: {
      bodyId: 'lane-body',
      lane: {
        closed: 1,
        goal: stage,
        head: { kind: 'container', item: stage, path: [goal] },
        id: 'lane',
        items: [],
        open: 3,
        stages: new Map(),
      },
      left: '',
      open: true,
      right: '',
    },
    global: { plugins: [createI18n({ legacy: false, locale: 'en', messages, pluralRules })] },
  })
}

describe('a stage’s row, by stage', () => {
  it('opens each part of its path, and folds by the chevron alone', async () => {
    const row = stageHead()
    const parts = row.findAll('.lane-part')
    expect(parts.map((part) => part.attributes('aria-label'))).toEqual([
      'Open MAIN-1 · A goal',
      'Open MAIN-2 · A stage',
    ])
    expect(row.get('.lane-title').text()).toBe('A goal › A stage')
    await parts[0]?.trigger('click')
    await parts[1]?.trigger('click')
    expect(row.emitted('open')).toEqual([['MAIN-1'], ['MAIN-2']])
    expect(row.emitted('toggle')).toBeUndefined()
    const fold = row.get('.lane-fold')
    expect(fold.attributes('aria-expanded')).toBe('true')
    expect(fold.attributes('aria-label')).toBe('Fold A goal › A stage')
    await fold.trigger('click')
    expect(row.emitted('toggle')).toHaveLength(1)
  })

  it('counts its work as closed of all', () => {
    expect(stageHead().get('.lane-counts').text()).toBe('1 of 4 closed')
  })
})
