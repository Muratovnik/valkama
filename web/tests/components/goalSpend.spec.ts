/**
 * What a goal spent, where the Work list and a goal's card say it. The oracle is the Volumes
 * contract (DESIGN.md «Volumes» and «Work»; the connection contract's `goal-volumes`): a goal's
 * row of the list and its card show both numbers of the goal's row, without the cancelled and with
 * them, and they read as the Volumes page reads the same goal; the list asks for the rows of the
 * goals it draws in one read, never one per row and never for a task.
 */
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import GoalSpendLine from '@/widgets/work-item-inspector/components/GoalSpendLine.vue'
import WorkItemList from '@/widgets/work-item-views/components/WorkItemList.vue'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import { messages, pluralRules } from '@/shared/i18n/index.ts'

import { boardItem } from '../fixtures/board.ts'
import { noUsage } from '../fixtures/usage.ts'
import {
  goalRow,
  goalVolumesDouble,
  serveGoalVolumes,
  spentOf,
  volumesAnswer,
  volumesDouble,
} from '../support/volumesDouble.ts'
import { mountSummary } from './usageSummaryHost.ts'
import { figure, forgetShell, json, mountPage } from './volumesPageHost.ts'

afterEach(() => {
  forgetShell()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
  localStorage.clear()
})

/** A goal that spent two hours and 30K tokens, four with what was cancelled under it. */
const goal = goalRow({
  reference: 'MAIN-1',
  total: 3,
  closed: 1,
  spent: spentOf(7200, 30_000),
  spentWithCancelled: spentOf(14_400, 50_000),
})
/** A stage under it, whose tasks began before usage was counted to a card. */
const stage = goalRow({
  reference: 'MAIN-2',
  kind: 'stage',
  parent: 'MAIN-1',
  total: 2,
  spent: spentOf(0, null, 2),
  spentWithCancelled: spentOf(0, null, 2),
})
const ROWS = [goal, stage]

/** The server's `goal-volumes` beside the Volumes page's read, answering each id with its row. */
const served = goalVolumesDouble(ROWS)
const goalVolumes = (url: URL) => {
  const answer = served.answer(url)
  return answer && json(answer)
}

/** The list's items: the goal, its stage and two tasks, each named by its row's id. */
const items: WorkItemBrief[] = [
  boardItem(1, 'backlog', { kind: 'goal', work_item_id: goal.work_item_id as string }),
  boardItem(2, 'backlog', {
    kind: 'goal',
    work_item_id: stage.work_item_id as string,
    parent_id: goal.work_item_id as string,
  }),
  boardItem(3, 'backlog', { kind: 'task', parent_id: goal.work_item_id as string }),
  boardItem(4, 'backlog', { kind: 'bug' }),
]

async function list(locale: 'en' | 'ru' = 'en', goalVolumesRead = true) {
  const i18n = createI18n({ legacy: false, locale, fallbackLocale: 'en', messages, pluralRules })
  const wrapper = mount(WorkItemList, {
    attachTo: document.body,
    global: { plugins: [i18n] },
    props: {
      items,
      links: [],
      goalVolumes: goalVolumesRead,
      sort: { key: 'reference', descending: false },
      // Grouped by goal, where a goal's row stands over the work under it.
      tree: { filtered: false, scope: items, space: 'main' },
    },
  })
  await flushPromises()
  return wrapper
}

/** What each row of the list says it spent, by its reference. */
const spendOfRows = () =>
  Object.fromEntries(
    [...document.querySelectorAll<HTMLElement>('tbody tr[data-reference]')].map((row) => [
      row.dataset.reference,
      [...row.querySelectorAll<HTMLElement>('[data-spend]')].map((part) => [
        part.dataset.spend,
        part.textContent.trim(),
      ]),
    ]),
  )

describe('a goal’s row of the Work list', () => {
  it('says both numbers of the goal, as the Volumes page says the same goal', async () => {
    const page = mountPage(
      volumesDouble(() => volumesAnswer({ goals: [{ ...goal, children: [stage] }] })),
      undefined,
      { other: goalVolumes },
    )
    await flushPromises()
    const onPage = {
      spent: figure(page, 'MAIN-1', 'spent').text(),
      all: figure(page, 'MAIN-1', 'spent-all').text(),
    }
    expect(onPage).toEqual({ spent: '2\u{A0}h · 30K', all: '4\u{A0}h · 50K' })

    await list()
    expect(spendOfRows()).toEqual({
      'MAIN-1': [
        ['spent', `Spent ${onPage.spent}`],
        ['spent-all', `With cancelled ${onPage.all}`],
      ],
      'MAIN-2': [
        ['spent', 'Spent —'],
        ['spent-all', 'With cancelled —'],
      ],
      'MAIN-3': [],
      'MAIN-4': [],
    })
    // «—», never 0, with the hint that says why.
    const unknown = document.querySelector('tr[data-reference="MAIN-2"] [data-spend="spent"]')
    expect(unknown?.getAttribute('aria-description')).toBe(
      'Not counted: its tasks began before usage was counted.',
    )
  })

  it('asks for the rows of the goals it draws in one read, and for no task', async () => {
    const asked = serveGoalVolumes(ROWS)
    await list()
    // One read naming both, the goal's id before the stage's as the double numbers them.
    expect(asked).toEqual([[goal.work_item_id, stage.work_item_id]])
  })

  it('asks nothing where its work is not in the store the read answers for', async () => {
    const asked = serveGoalVolumes(ROWS)
    await list('en', false)
    expect(asked).toEqual([])
    expect(document.querySelectorAll('[data-spend]')).toHaveLength(0)
    expect(document.querySelectorAll('tbody tr[data-reference]')).toHaveLength(4)
  })

  it('names both numbers in Russian', async () => {
    serveGoalVolumes(ROWS)
    await list('ru')
    expect(spendOfRows()['MAIN-1']).toEqual([
      ['spent', 'Потрачено 2\u{A0}ч · 30\u{A0}тыс.'],
      ['spent-all', 'С отменёнными 4\u{A0}ч · 50\u{A0}тыс.'],
    ])
  })
})

/** What a card's line says it spent, number by number. */
const figures = () =>
  [...document.querySelectorAll<HTMLElement>('[data-spend]')].map((part) => [
    part.dataset.spend,
    part.textContent.trim(),
  ])

describe('a goal’s card', () => {
  it('says both numbers of the goal, read by its reference', async () => {
    const asked = serveGoalVolumes(ROWS)
    mountSummary(noUsage({ reference: 'MAIN-1', scope: 'tree' }), {
      container: true,
      part: GoalSpendLine,
    })
    await flushPromises()
    expect(asked).toEqual([['MAIN-1']])
    expect(figures()).toEqual([
      ['spent', 'Spent 2\u{A0}h · 30K'],
      ['spent-all', 'With cancelled 4\u{A0}h · 50K'],
    ])
  })

  it('asks nothing and says nothing on a task’s card', async () => {
    const asked = serveGoalVolumes(ROWS)
    mountSummary(noUsage({ reference: 'MAIN-3' }), { part: GoalSpendLine })
    await flushPromises()
    expect(asked).toEqual([])
    expect(figures()).toEqual([])
  })
})
