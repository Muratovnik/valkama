/**
 * The harness page for the hover card of a work item: every state the card can
 * be in, each on the tooltip's surface at the width the reference gives it, so a
 * browser can read back its ink, its ground and its size.
 *
 * The surface here stands in for the one the reference draws around the card
 * when it floats: the tooltip's ground, border, radius and the card's width.
 */
import { defineComponent, h, withDirectives } from 'vue'

import WorkItemPreview from '@/entities/work-item/components/WorkItemPreview.vue'
import type { WorkItemPreviewSubject } from '@/entities/work-item/composables/useWorkItemPreviewWords.ts'
import { useWorkItemReferencePreview } from '@/entities/work-item/composables/useWorkItemReferencePreview.ts'

import ReferencePreview from '@/shared/ui/ReferencePreview.vue'
import { vReferencePreview } from '@/shared/ui/referencePreviewAnchors.ts'

import { boardItem, boardState } from '../fixtures/board.ts'

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
    by_previous_holder: false,
  }))

/** One card per state of the plan's table, named by `data-state`. */
const PREVIEW_STATES: Readonly<Record<string, WorkItemPreviewSubject>> = {
  // An agent's claim as the server signs it: a name holding an id, and the session it proved.
  // Its title names items, each of which a line may break around but never inside.
  agent: {
    reference: 'MAIN-1401',
    item: boardItem(1401, 'dev', {
      title:
        'Свести MAIN-1201, MAIN-1202 и MAIN-1203 в одно правило переноса после MAIN-1204, MAIN-1205 и MAIN-1206',
      claim_ref: 'claude agent a1b2c3d4e5f60718a (session 7c0ffee1-3e5a-4a1b-9c2d-0123456789ab)',
      claim_state: 'live',
      checklist: steps(2, 3),
      updated_at: at(11, 18, 21, 45),
    }),
  },
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
    space: 'Длинное название соседнего пространства example-space-with-a-long-key',
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
  // A title with no space to break at, and a state a workflow named at length.
  long: {
    reference: 'MAIN-200',
    item: boardItem(200, 'todo', {
      state: {
        ...boardState('todo'),
        name: 'Ожидает согласования архитектурного решения владельцем продукта',
      },
      kind: 'goal',
      priority: 'urgent',
      title: 'Ж'.repeat(200),
      updated_at: at(10, 29, 8, 30),
      workable: false,
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

/**
 * The agent's claim and title of `agent`, after a word of `letters` letters: across a run of
 * them, a holder's session start and each reference in a title meet the end of a line at every
 * point of their width, whatever the font's measures, so one of them is where a line would cut
 * it if a line could.
 */
const shifted = (letters: number): WorkItemPreviewSubject => {
  const word = 'ш'.repeat(letters)
  return {
    reference: `MAIN-${1500 + letters}`,
    item: boardItem(1500 + letters, 'dev', {
      title: `${word} продолжение MAIN-1201, затем MAIN-1202`,
      claim_ref: `${word} claude agent a1b2c3d4e5f60718a (session 7c0ffee1-3e5a-4a1b-9c2d-0123456789ab)`,
      claim_state: 'live',
      checklist: steps(2, 3),
      updated_at: at(11, 18, 21, 45),
    }),
  }
}
/** How many words `?shift` stands before the agent's claim, one letter longer each. */
const SHIFTS = 40

/** Where the references stand: in the page's flow, down the window's right edge, or along its bottom. */
const PLACES = new Set(['flow', 'right', 'bottom'])

/**
 * The hover card as the window floats it (`ReferencePreview`), over a reference for every state
 * above, each named by `data-state`. `?place=` stands the references in the page's flow (the
 * default), down the window's right edge or along its bottom, where the card has to keep to the
 * window. `?shift` stands, instead, `SHIFTS` references to the agent's claim after a word one
 * letter longer each (`shifted`), named by `data-shift`.
 */
export const PreviewCardsSurface = defineComponent({
  setup() {
    const previewOf = useWorkItemReferencePreview()
    const asked = new URLSearchParams(location.search).get('place') ?? 'flow'
    const place = PLACES.has(asked) ? asked : 'flow'
    const shift = new URLSearchParams(location.search).has('shift')
    const subjects = shift
      ? Array.from(
          { length: SHIFTS },
          (_, index) => [String(index + 1), shifted(index + 1)] as const,
        )
      : Object.entries(PREVIEW_STATES)
    const previews = subjects.map(([name, subject]) => [name, previewOf(() => subject)] as const)
    return () =>
      h('main', { 'class': 'preview-cards-harness', 'data-place': place }, [
        h(
          'p',
          { class: 'preview-cards-row' },
          previews.map(([name, preview]) =>
            withDirectives(
              h('a', { href: '#', [shift ? 'data-shift' : 'data-state']: name }, name),
              [[vReferencePreview, preview]],
            ),
          ),
        ),
        h(ReferencePreview),
      ])
  },
})
