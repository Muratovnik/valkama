/**
 * The card says an item is waiting only on work that is still open.
 *
 * A link carries the other end's state. A blocker that has finished stopped
 * blocking, and a card that still named it told the reader a workable item
 * could not be taken while its own tile said it could.
 */
import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import InspectorOverview from '@/widgets/work-item-inspector/components/InspectorOverview.vue'

import type { WorkItem } from '@/shared/api/planningModel.ts'
import { messages } from '@/shared/i18n/index.ts'

import { inspectorResourceRef, workItemFixture } from '../fixtures/workItem.ts'

type Link = WorkItem['links'][number]

function blocker(reference: string, end: Partial<Link>): Link {
  return {
    kind: 'blocks',
    direction: 'incoming',
    work_item_id: `00000000-0000-4000-8000-0000000000${reference.slice(-2)}`,
    reference,
    title: `Work of ${reference}`,
    ...end,
  }
}

const OPEN = {
  state_name: 'Development',
  state_category: 'active',
  is_terminal: false,
  state_unavailable: null,
} as const
const DONE = {
  state_name: 'Done',
  state_category: 'completed',
  is_terminal: true,
  state_unavailable: null,
} as const
const UNREADABLE = {
  state_name: null,
  state_category: null,
  is_terminal: null,
  state_unavailable: 'state_missing',
} as const

function overview(links: Link[]) {
  const item = { ...workItemFixture('Waiting work', 1), links }
  return mount(InspectorOverview, {
    props: { item, writable: false, resourceRef: inspectorResourceRef },
    global: {
      plugins: [createI18n({ legacy: false, locale: 'en', messages })],
      stubs: {
        InspectorDescription: true,
        InspectorDiscussion: true,
        InspectorSummary: true,
        ItemInputRequests: true,
      },
    },
  })
}

describe('the blockers a card names', () => {
  it('names an open blocker and one whose state is unknown, never a finished one', () => {
    const wrapper = overview([
      blocker('MAIN-11', DONE),
      blocker('MAIN-12', OPEN),
      blocker('MAIN-13', UNREADABLE),
      // A server that predates the link's state says nothing about it.
      blocker('MAIN-14', {}),
      // What this item blocks is not what it waits on.
      { ...blocker('MAIN-15', OPEN), direction: 'outgoing' },
    ])
    const text = wrapper.text()
    expect(text).not.toContain('MAIN-11')
    expect(text).toContain('MAIN-12')
    expect(text).toContain('MAIN-13')
    expect(text).toContain('MAIN-14')
    expect(text).not.toContain('MAIN-15')
  })

  it('has no blocked section when every blocker has finished', () => {
    const wrapper = overview([blocker('MAIN-11', DONE), blocker('MAIN-12', DONE)])
    expect(wrapper.text()).not.toContain('MAIN-1')
    expect(wrapper.text()).not.toContain('Blocked')
  })
})
