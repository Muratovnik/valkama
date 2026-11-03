/**
 * The harness page for the hover card of a work item: every state the card can
 * be in, each on the tooltip's surface at the width the reference gives it, so a
 * browser can read back its ink, its ground and its size.
 *
 * The surface here stands in for the one the reference draws around the card
 * when it floats: the tooltip's ground, border, radius and the card's width.
 */
import { h } from 'vue'

import WorkItemPreview from '@/entities/work-item/components/WorkItemPreview.vue'
import type { WorkItemPreviewSubject } from '@/entities/work-item/composables/useWorkItemPreviewWords.ts'

import { boardItem } from '../fixtures/board.ts'

const thisYear = new Date().getFullYear()
const at = (month: number, day: number, hour: number, minute: number) =>
  new Date(thisYear, month - 1, day, hour, minute).toISOString()

const steps = (done: number, total: number) =>
  Array.from({ length: total }, (_, index) => ({
    id: `00000000-0000-4000-8000-00000000050${index}`,
    text: `Step ${index + 1}`,
    done: index < done,
    claimed_by: '',
    done_by: '',
  }))

/** One card per state of the plan's table, named by `data-state`. */
const PREVIEW_STATES: Readonly<Record<string, WorkItemPreviewSubject>> = {
  claimed: {
    reference: 'MAIN-1394',
    item: boardItem(1394, 'dev', {
      kind: 'bug',
      title: 'Показывать краткую карточку задачи по наведению на её номер в тексте',
      claim_ref: 'claude (session f5f838f4-74fc-4a1b-9c2d-0123456789ab)',
      claim_state: 'live',
      checklist: steps(1, 5),
      updated_at: at(11, 3, 22, 40),
    }),
  },
  closed: {
    reference: 'MAIN-12',
    item: boardItem(12, 'done', {
      title: 'Планировщик теряет фокус при закрытии',
      last_claim_ref: 'claude',
      closed_at: at(11, 2, 18, 5),
      checklist: steps(3, 3),
    }),
  },
  foreign: {
    reference: 'MAIN-40',
    item: boardItem(40, 'backlog', {
      title: 'Перенести настройки',
      updated_at: at(11, 1, 9, 12),
    }),
    project: 'example-project',
  },
  stale: {
    reference: 'MAIN-55',
    item: boardItem(55, 'dev', {
      title: 'Починить хук',
      claim_ref: 'codex (session 019e2b7c-5d1a-7c3e-9a10-0123456789ab)',
      claim_state: 'stale',
      updated_at: at(10, 30, 11, 0),
    }),
  },
  long: {
    reference: 'MAIN-200',
    item: boardItem(200, 'todo', {
      kind: 'epic',
      priority: 'urgent',
      title: 'Ж'.repeat(200),
      updated_at: at(10, 29, 8, 30),
      ready: false,
    }),
    waitingOn: 'MAIN-12',
  },
  loading: { reference: 'MAIN-77', item: null },
  failed: { reference: 'MAIN-77', item: null, failure: 'failed' },
  missing: { reference: 'MAIN-77', item: null, failure: 'missing' },
  unavailable: { reference: 'MAIN-77', item: null, failure: 'unavailable' },
}

export function previewSurface() {
  return h(
    'main',
    { class: 'preview-harness' },
    Object.entries(PREVIEW_STATES).map(([state, subject]) =>
      h('div', { 'class': 'preview-harness-surface', 'data-state': state }, [
        h(WorkItemPreview, subject),
      ]),
    ),
  )
}
