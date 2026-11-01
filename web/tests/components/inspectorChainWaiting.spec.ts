/**
 * The card's chain section names what a member waits on even when the blocker
 * is outside the chain: the chain read answers every block into a member with
 * its source's reference and state, and the section reads it through the real
 * client. A finished blocker holds nothing up, wherever it lives.
 */
import { flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import { chainResponse, largeEpicChain } from '../fixtures/chain.ts'
import { workItemFixture } from '../fixtures/workItem.ts'
import { json, mountInspector, useInspectorHarness } from '../support/inspectorHarness.ts'
import { withSecurityBootstrap } from '../support/request.ts'

vi.mock('@/shared/api/executionApi.ts', async (load) => ({
  ...(await load<typeof import('@/shared/api/executionApi.ts')>()),
  fetchExecutionHistory: vi.fn(),
}))

vi.mock('@/shared/api/planningApi.ts', async (load) => ({
  ...(await load<typeof import('@/shared/api/planningApi.ts')>()),
  fetchWorkItem: vi.fn(),
}))

const ROOT = { ...workItemFixture('Planning rethink', 1), container: true }

/** A block into `to` from an item of another space, open or finished. */
function outsideBlock(to: string, number: number, open: boolean) {
  return {
    from: `00000000-0000-4000-8000-00000000990${number}`,
    to,
    kind: 'blocks' as const,
    reference: `OTH-${number}`,
    state_name: open ? 'Review' : 'Done',
    state_category: open ? 'review' : 'completed',
    is_terminal: !open,
    state_unavailable: null,
  }
}

describe('the chain section of a card, blocked from outside the chain', () => {
  useInspectorHarness()

  it('names the open blocker a member waits on, and not a finished one', async () => {
    const chain = largeEpicChain()
    const [waiting, unblocked] = chain.members.filter((member) => member.state.key === 'todo')
    waiting.ready = false
    const edges = [
      outsideBlock(waiting.work_item_id, 7, true),
      outsideBlock(unblocked.work_item_id, 8, false),
    ]
    const answer = json(chainResponse({ ...chain, edges }))
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(withSecurityBootstrap(async () => answer.clone())),
    )
    const wrapper = mountInspector(ROOT)
    await flushPromises()

    const section = wrapper.find('section.chain')
    const marks = section.findAll('.chain-row-waiting').map((mark) => mark.text())
    expect(marks).toEqual(['Waiting on OTH-7'])
    const row = section.find(`[data-reference="${waiting.reference}"]`)
    expect(row.find('.chain-row-waiting').exists()).toBe(true)
    expect(section.find(`[data-reference="${unblocked.reference}"]`).text()).not.toContain(
      'Waiting',
    )
  })
})
