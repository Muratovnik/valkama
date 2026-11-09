/**
 * A chain's member rows print readiness only as the exception.
 *
 * Workable is the norm of an open group, so a row that is ready says nothing
 * about it; a member that waits on an open blocker names what it waits on. The
 * rule is the registry's: this test reads the rows the component draws.
 */
import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ChainMembers from '@/widgets/work-item-inspector/components/ChainMembers.vue'
import { groupLabels, groupMembers } from '@/widgets/work-item-inspector/utils/chainSummary.ts'

import type { ChainMember } from '@/shared/api/planningChainApi.ts'
import { messages } from '@/shared/i18n/index.ts'

function member(
  number: number,
  state: 'backlog' | 'done',
  overrides: Partial<ChainMember> = {},
): ChainMember {
  const terminal = state === 'done'
  return {
    work_item_id: `00000000-0000-4000-8000-0000000000${String(number).padStart(2, '0')}`,
    reference: `MAIN-${number}`,
    title: `Chain item ${number}`,
    state: {
      key: state,
      name: terminal ? 'Done' : 'Backlog',
      category: terminal ? 'completed' : 'backlog',
      is_terminal: terminal,
    },
    claim_ref: '',
    claim_state: null,
    parent_reference: 'MAIN-1',
    created_at: '2026-10-20T10:00:00Z',
    closed_at: terminal ? '2026-10-29T10:00:00Z' : null,
    ready: false,
    rank: number,
    ...overrides,
  }
}

function mountMembers(members: ChainMember[], waiting: Map<string, string>) {
  const groups = groupMembers(members)
  return mount(ChainMembers, {
    props: {
      groups,
      labels: groupLabels(
        groups,
        (group) => group,
        (state) => state.name,
      ),
      waiting,
    },
    global: {
      plugins: [createI18n({ legacy: false, locale: 'en', messages })],
    },
  })
}

describe('chain member rows', () => {
  const workable = member(2, 'backlog', { ready: true })
  const waiting = member(3, 'backlog', { ready: false })
  const finished = member(4, 'done')
  const members = [workable, waiting, finished]

  it('prints nothing for a workable member, the norm of its group', () => {
    const wrapper = mountMembers(members, new Map([[waiting.work_item_id, 'MAIN-2']]))
    const row = wrapper.find(`[data-reference="${workable.reference}"]`)
    expect(row.exists()).toBe(true)
    expect(row.text()).not.toContain('Workable')
    expect(row.findAll('.chain-row-waiting')).toHaveLength(0)
  })

  it('names the open blocker a member waits on, and nothing else about readiness', () => {
    const wrapper = mountMembers(members, new Map([[waiting.work_item_id, 'MAIN-2']]))
    const marks = wrapper.findAll('.chain-row-waiting')
    expect(marks.map((mark) => mark.text())).toEqual(['Waiting on MAIN-2'])
    expect(
      wrapper.find(`[data-reference="${waiting.reference}"]`).find('.chain-row-waiting').exists(),
    ).toBe(true)
  })

  it('prints no readiness word anywhere when no member waits on an open blocker', () => {
    const wrapper = mountMembers(members, new Map())
    expect(wrapper.text()).not.toContain('Workable')
    expect(wrapper.text()).not.toContain('Waiting on')
    expect(wrapper.findAll('.chain-row-waiting')).toHaveLength(0)
  })
})
