/**
 * Where a card's chain stands and when it offers its two scopes: under Relations after
 * the item's links and references, not on Overview; and «Epic | Chain» only where the
 * read says the two scopes hold different work.
 */
import { flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import { fetchWorkItem } from '@/shared/api/planningApi.ts'

import { chainResponse, largeEpicChain } from '../fixtures/chain.ts'
import { showRelations, workItemFixture } from '../fixtures/workItem.ts'
import { json, mountInspector, useInspectorHarness } from '../support/inspectorHarness.ts'
import { requestUrl, withSecurityBootstrap } from '../support/request.ts'

vi.mock('@/shared/api/executionApi.ts', async (load) => ({
  ...(await load<typeof import('@/shared/api/executionApi.ts')>()),
  fetchExecutionHistory: vi.fn(),
}))

vi.mock('@/shared/api/planningApi.ts', async (load) => ({
  ...(await load<typeof import('@/shared/api/planningApi.ts')>()),
  fetchWorkItem: vi.fn(),
}))

const ROOT = { ...workItemFixture('Planning rethink', 1), container: true }

function serveChain(totals: { chain: number; epic: number }) {
  const chain = largeEpicChain()
  const answer = json(chainResponse({ ...chain, root: { ...chain.root, totals } }))
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(
      withSecurityBootstrap(async (input) => {
        const { pathname } = new URL(requestUrl(input), 'http://localhost')
        if (pathname !== '/api/planning/work-item/chain') throw new Error(`unexpected ${pathname}`)
        return answer.clone()
      }),
    ),
  )
}

describe('a card’s chain', () => {
  useInspectorHarness()

  it('stands under Relations, after the links and references, and not on Overview', async () => {
    serveChain({ chain: 616, epic: 273 })
    const wrapper = mountInspector(ROOT)
    await flushPromises()
    expect(vi.mocked(fetchWorkItem)).toHaveBeenCalled()
    expect(wrapper.find('section.chain').exists()).toBe(false)

    await showRelations(wrapper)
    const relations = wrapper.get('.relations')
    const sections = relations.element.children
    expect(sections[sections.length - 1].matches('section.chain')).toBe(true)
    expect(relations.findAll('section.relation-section')).toHaveLength(2)
  })

  it('offers Epic and Chain only where the two scopes hold different work', async () => {
    const cases = [
      { totals: { chain: 616, epic: 273 }, offered: true },
      // The work grew nothing past the children: both scopes are one list.
      { totals: { chain: 616, epic: 616 }, offered: false },
      // No children: Epic would be an empty list.
      { totals: { chain: 616, epic: 0 }, offered: false },
    ]
    for (const { totals, offered } of cases) {
      serveChain(totals)
      const wrapper = mountInspector(ROOT)
      await flushPromises()
      await showRelations(wrapper)
      expect(wrapper.find('section.chain .chain-summary-line').exists()).toBe(true)
      expect(wrapper.find('section.chain .chain-scope').exists(), JSON.stringify(totals)).toBe(
        offered,
      )
      wrapper.unmount()
    }
  })
})
