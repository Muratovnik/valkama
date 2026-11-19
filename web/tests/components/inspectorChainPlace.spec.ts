/**
 * Where a card's chain stands and when it offers its two scopes: a tab of its own after
 * Overview, offered only where there is a chain, and neither on Overview nor in Relations;
 * and «Goal | Chain» only where the read says the two scopes hold different work.
 */
import { flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import { fetchWorkItem } from '@/shared/api/planningApi.ts'

import { chainResponse, emptyChain, largeGoalChain } from '../fixtures/chain.ts'
import { deferred, showChain, showTab, workItemFixture } from '../fixtures/workItem.ts'
import { documentOrder } from '../support/documentOrder.ts'
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

const ROOT = { ...workItemFixture('Planning rethink', 1), kind: 'goal' as const }

function serveChain(totals: { chain: number; tree: number }) {
  const chain = largeGoalChain()
  serve(json(chainResponse({ ...chain, root: { ...chain.root, totals } })))
}

/** Answer every chain read with the next answer, the last one again once they run out. */
function serve(...answers: (Response | Promise<Response>)[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(
      withSecurityBootstrap(async (input) => {
        const { pathname } = new URL(requestUrl(input), 'http://localhost')
        if (pathname !== '/api/planning/work-item/chain') throw new Error(`unexpected ${pathname}`)
        const answer = await (answers.length > 1 ? answers.shift() : answers[0])
        if (!answer) throw new Error('no answer left')
        return answer.clone()
      }),
    ),
  )
}

const tabNames = (wrapper: VueWrapper) =>
  wrapper.findAll('.inspector-tabs [role="tab"]').map((tab) => tab.text())

describe('a card’s chain', () => {
  useInspectorHarness()

  it('has a tab of its own after Overview, and stands neither on Overview nor in Relations', async () => {
    serveChain({ chain: 616, tree: 273 })
    const wrapper = mountInspector(ROOT)
    await flushPromises()
    expect(vi.mocked(fetchWorkItem)).toHaveBeenCalled()
    // Execution is on in this harness; Agents stands only where the item has any.
    expect(tabNames(wrapper)).toEqual([
      'Overview',
      'Chain',
      'Execution',
      'Memory',
      'Relations',
      'System events',
    ])
    expect(wrapper.find('section.chain').exists()).toBe(false)

    await showChain(wrapper)
    expect(wrapper.find('section.chain .chain-summary-line').exists()).toBe(true)

    await showTab(wrapper, 'Relations')
    const relations = wrapper.get('.relations')
    expect(relations.find('section.chain').exists()).toBe(false)
    // The related work, then the evidence.
    expect(documentOrder(relations.element, ['.relation-section', '.evidence'])).toEqual([
      '.relation-section',
      '.evidence',
    ])
  })

  it('offers a leaf the tab once its read finds work, holds it through a refresh, and steps off it once a read finds none', async () => {
    const leaf = workItemFixture('Leaf', 1)
    vi.mocked(fetchWorkItem).mockResolvedValue(leaf)
    serve(json(chainResponse(emptyChain())))
    const plain = mountInspector(leaf)
    await flushPromises()
    expect(tabNames(plain)).not.toContain('Chain')
    plain.unmount()

    const refreshed = deferred<Response>()
    serve(
      json(chainResponse(largeGoalChain())),
      refreshed.promise,
      json(chainResponse(emptyChain())),
    )
    const grown = mountInspector(leaf)
    await showChain(grown)
    expect(grown.find('section.chain').exists()).toBe(true)
    // While a refresh runs the last answer stands, and so does its tab, on any tab of the card.
    await showTab(grown, 'Relations')
    await grown.setProps({ refreshToken: 1 })
    await flushPromises()
    expect(tabNames(grown)).toContain('Chain')
    refreshed.resolve(json(chainResponse(largeGoalChain())))
    await flushPromises()
    await showChain(grown)
    await grown.setProps({ refreshToken: 2 })
    await flushPromises()
    expect(tabNames(grown)).not.toContain('Chain')
    expect(grown.get('.inspector-tabs [aria-selected="true"]').text()).toBe('Overview')
  })

  it('offers Goal and Chain only where the two scopes hold different work', async () => {
    const cases = [
      { totals: { chain: 616, tree: 273 }, offered: true },
      // The work grew nothing past the children: both scopes are one list.
      { totals: { chain: 616, tree: 616 }, offered: false },
      // No children: Goal would be an empty list.
      { totals: { chain: 616, tree: 0 }, offered: false },
    ]
    for (const { totals, offered } of cases) {
      serveChain(totals)
      const wrapper = mountInspector(ROOT)
      await flushPromises()
      await showChain(wrapper)
      expect(wrapper.find('section.chain .chain-summary-line').exists()).toBe(true)
      expect(wrapper.find('section.chain .chain-scope').exists(), JSON.stringify(totals)).toBe(
        offered,
      )
      wrapper.unmount()
    }
  })
})
