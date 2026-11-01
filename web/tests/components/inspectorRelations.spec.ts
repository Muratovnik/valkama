/**
 * The card's relations name each other end's state, so a finished blocker reads
 * as finished and an open one as open. A link whose state the server could not
 * say prints no state rather than a guess.
 */
import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import InspectorRelations from '@/widgets/work-item-inspector/components/InspectorRelations.vue'

import type { WorkItem } from '@/shared/api/planningModel.ts'
import { planningSpaceEntity } from '@/shared/api/platformPlanningRefs.ts'
import { messages } from '@/shared/i18n/index.ts'

import { workItemFixture } from '../fixtures/workItem.ts'

type Link = WorkItem['links'][number]

function link(reference: string, end: Partial<Link>): Link {
  return {
    kind: 'blocks',
    direction: 'incoming',
    work_item_id: `00000000-0000-4000-8000-0000000000${reference.slice(-2)}`,
    reference,
    title: `Work of ${reference}`,
    state_name: 'Backlog',
    state_category: 'backlog',
    is_terminal: false,
    state_unavailable: null,
    ...end,
  }
}

function mountRelations(links: Link[]) {
  const item = { ...workItemFixture('Relations', 1), links }
  return mount(InspectorRelations, {
    props: {
      item,
      resourceRef: planningSpaceEntity({
        data_scope_id: '00000000-0000-4000-8000-000000000700',
        space_key: 'MAIN',
      }),
      writable: false,
    },
    global: {
      plugins: [createI18n({ legacy: false, locale: 'en', messages })],
      stubs: { RelatedWorkPicker: true },
    },
  })
}

function row(wrapper: ReturnType<typeof mountRelations>, reference: string) {
  const found = wrapper
    .findAll('.link-row')
    .find((candidate) => candidate.text().includes(reference))
  if (!found) throw new Error(`no relation row for ${reference}`)
  return found
}

describe('relation rows', () => {
  it('shows a finished blocker as finished, by the other end’s state', () => {
    const wrapper = mountRelations([
      link('MAIN-12', { state_name: 'Done', state_category: 'completed', is_terminal: true }),
    ])
    const state = row(wrapper, 'MAIN-12').find('.semantic-state')
    expect(state.exists()).toBe(true)
    expect(state.attributes('data-state')).toBe('completed')
    expect(state.text()).toBe('Done')
  })

  it('names an open end by its own state, not as finished', () => {
    const wrapper = mountRelations([
      link('MAIN-13', { state_name: 'Dev', state_category: 'active', is_terminal: false }),
    ])
    const state = row(wrapper, 'MAIN-13').find('.semantic-state')
    expect(state.attributes('data-state')).toBe('active')
    expect(state.text()).toBe('Dev')
  })

  it('prints no state for an end whose state the server could not say', () => {
    const wrapper = mountRelations([
      link('MAIN-14', {
        state_name: null,
        state_category: null,
        is_terminal: null,
        state_unavailable: 'state_missing',
      }),
    ])
    expect(row(wrapper, 'MAIN-14').find('.semantic-state').exists()).toBe(false)
    expect(row(wrapper, 'MAIN-14').text()).toContain('Work of MAIN-14')
  })
})
