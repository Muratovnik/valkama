/**
 * The harness page for marks and control states: what the browser has to
 * paint for a colour rule to hold, rendered with the product stylesheet.
 */
import { h } from 'vue'

import FacetMarks from '@/entities/work-item/components/FacetMarks.vue'
import type { FacetSurface } from '@/entities/work-item/utils/facets.ts'

import ToggleSwitch from '@/shared/ui/ToggleSwitch.vue'

import { boardItem } from '../fixtures/board.ts'

/** A switch thrown each way, so a test can compare the two tracks. */
function switches() {
  return h('section', { 'class': 'marks-harness-row', 'data-harness': 'switches' }, [
    h(ToggleSwitch, {
      'label': 'On',
      'modelValue': true,
      'onLabel': 'On',
      'offLabel': 'Off',
      'data-switch': 'on',
    }),
    h(ToggleSwitch, {
      'label': 'Off',
      'modelValue': false,
      'onLabel': 'On',
      'offLabel': 'Off',
      'data-switch': 'off',
    }),
  ])
}

const steps = [true, true, false].map((done, index) => ({
  id: `00000000-0000-4000-8000-00000000040${index}`,
  text: `Step ${index}`,
  done,
  claimed_by: '',
  done_by: '',
}))

/** Items that between them carry every facet value a surface marks. */
const ITEMS = [
  boardItem(1008, 'todo', {
    kind: 'improvement',
    priority: 'urgent',
    ready: false,
    labels: ['agent-packets', 'coordinator', 'decision-review', 'ui'],
    claim_ref: 'claude (session 5937aa01-1234-4c00)',
    claim_state: 'stale',
    parent_id: '00000000-0000-4000-8000-000000000994',
    checklist: steps,
  }),
  boardItem(1012, 'dev', { kind: 'bug', priority: 'high', ready: false, claim_ref: 'codex' }),
  boardItem(263, 'backlog', { kind: 'epic', priority: 'low', labels: ['valkama'] }),
  boardItem(264, 'backlog'),
]

const WAITING = { waitingOn: 'MAIN-1012', parentReference: 'MAIN-994', width: 1200 }

/** Every item's marks on one surface, one row per item. */
function surface(name: FacetSurface) {
  return h(
    'section',
    { 'class': 'marks-harness-row marks-harness-surface', 'data-harness': name },
    [
      h('strong', { class: 'marks-harness-name' }, name),
      ...ITEMS.map((item) =>
        h('div', { 'class': 'marks-harness-item', 'data-item': item.reference }, [
          h('span', { class: 'marks-harness-reference' }, item.reference),
          h(FacetMarks, {
            item,
            surface: name,
            context: item.number === 1008 ? WAITING : { width: 1200 },
            filterable: true,
            filter: { text: '', labels: ['coordinator'] },
          }),
        ]),
      ),
    ],
  )
}

const SURFACES: readonly FacetSurface[] = ['tile', 'list', 'graph', 'card', 'finder']

export function marksSurface() {
  return h('main', { class: 'marks-harness' }, [
    switches(),
    ...SURFACES.map((name) => surface(name)),
  ])
}
