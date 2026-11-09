/**
 * A card reopened by Back, read through the real client against a stubbed
 * chain: it comes back to the reading it was left in — the scope, the open
 * groups — and puts focus on the row of the card that was opened from it.
 */
import { flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import type { InspectorReturn } from '@/widgets/work-item-inspector/utils/inspectorReturn.ts'

import { chainResponse, largeEpicChain } from '../fixtures/chain.ts'
import { getButton, showRelations, workItemFixture } from '../fixtures/workItem.ts'
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

/** Answer every chain read with the same chain, and record the scope each asked for. */
function serveChain() {
  const scopes: (string | null)[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(
      withSecurityBootstrap(async (input) => {
        const url = new URL(requestUrl(input), 'http://localhost')
        if (url.pathname !== '/api/planning/work-item/chain') throw new Error(`unexpected ${url}`)
        scopes.push(url.searchParams.get('scope'))
        return json(chainResponse(largeEpicChain()))
      }),
    ),
  )
  return scopes
}

async function open(returnTo?: InspectorReturn) {
  const wrapper = mountInspector(ROOT, { returnTo })
  await flushPromises()
  await flushPromises()
  return wrapper
}

const rows = (wrapper: VueWrapper, label: string) =>
  wrapper
    .findAll('section.chain-group')
    .find((group) => group.attributes('aria-label') === label)
    ?.findAll('.chain-row') ?? []

const shown = (wrapper: VueWrapper) => wrapper.get('[role="tab"][aria-selected="true"]').text()

const focusedReference = () => (document.activeElement as HTMLElement | null)?.dataset.reference

describe('a card reopened by Back', () => {
  useInspectorHarness()

  it('comes back to the reading it was left in, focus on the row that was opened', async () => {
    const scopes = serveChain()
    // Read the 21st backlog row off the card as the reader would have reached it.
    const first = await open()
    await showRelations(first)
    await getButton(first, 'Show all · 107').trigger('click')
    const reference = rows(first, 'Backlog')[20].get('.chain-row-reference').text()
    first.unmount()

    const wrapper = await open({
      chain: { details: true, doneOpen: true, expanded: ['backlog'], lane: null, scope: 'epic' },
      opened: reference,
      reference: ROOT.reference,
      scroll: 900,
      section: 'relations',
    })
    // The scope it was read in is the one asked for, and the groups open as they were.
    expect(scopes.at(-1)).toBe('epic')
    expect(rows(wrapper, 'Backlog')).toHaveLength(107)
    expect(wrapper.findAll('.chain-row.is-done')).toHaveLength(8)
    // So is the chart it was reading, which starts folded on a card opened afresh.
    expect(wrapper.find('.chain-chart').exists()).toBe(true)
    // Focus is on the row of the card Back came from, not at the top of the card.
    expect(focusedReference()).toBe(reference)
  })

  it('reveals the row it comes back to, though the list it sits in was folded', async () => {
    serveChain()
    const done = largeEpicChain().members.find((member) => member.state.is_terminal)
    await open({
      chain: { details: false, doneOpen: false, expanded: [], lane: null, scope: 'chain' },
      opened: done?.reference ?? '',
      reference: ROOT.reference,
      scroll: 0,
      section: 'relations',
    })
    expect(focusedReference()).toBe(done?.reference)
  })

  it('comes back to Execution while the card offers it, and to Overview once it does not', async () => {
    serveChain()
    const point = {
      chain: null,
      opened: 'MAIN-1',
      reference: ROOT.reference,
      scroll: 0,
      section: 'execution',
    }
    const on = await open(point)
    expect(shown(on)).toBe('Execution')
    expect(on.find('inspector-execution-stub').exists()).toBe(true)
    on.unmount()

    localStorage.clear()
    const off = await open(point)
    expect(shown(off)).toBe('Overview')
    expect(off.find('inspector-execution-stub').exists()).toBe(false)
  })

  it('takes no return point meant for another card', async () => {
    const scopes = serveChain()
    await open({
      chain: { details: true, doneOpen: true, expanded: ['backlog'], lane: null, scope: 'epic' },
      opened: 'MAIN-1',
      reference: 'MAIN-2',
      scroll: 0,
      section: 'relations',
    })
    expect(scopes).toEqual(['chain'])
    expect(focusedReference()).toBeUndefined()
  })
})
