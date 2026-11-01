/**
 * The chain read's edges on the wire. A block into a member may come from
 * outside the chain — another space, or this space outside the chain — and
 * every edge names its source the way a space view's link does: its reference
 * and state, or null with the reason beside it when the store cannot resolve
 * that state. The contract stays strict: a state neither known nor said to be
 * unavailable, or a field nobody declared, is refused.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchWorkItemChain } from '@/shared/api/planningChainApi.ts'

import { emptyChain } from './fixtures/chain.ts'
import { withSecurityBootstrap } from './support/request.ts'

afterEach(() => vi.unstubAllGlobals())

const ROOT = '00000000-0000-4000-8000-000000000320'
const OUTSIDE = '00000000-0000-4000-8000-000000009999'

function serve(edges: unknown[]) {
  const chain = { ...emptyChain('QA-320', ROOT), edges }
  const payload = { interface_version: 'valkama-planning-api', chain }
  vi.stubGlobal(
    'fetch',
    vi
      .fn<typeof fetch>()
      .mockImplementation(withSecurityBootstrap(async () => new Response(JSON.stringify(payload)))),
  )
}

const block = (extra: Record<string, unknown>) => ({
  from: OUTSIDE,
  to: ROOT,
  kind: 'blocks',
  reference: 'OTH-7',
  ...extra,
})

describe('a chain edge names its source', () => {
  it('reads a block from outside the chain with its source’s reference and state', async () => {
    serve([
      block({
        state_name: 'Review',
        state_category: 'review',
        is_terminal: false,
        state_unavailable: null,
      }),
      block({
        from: '00000000-0000-4000-8000-000000009998',
        reference: 'OTH-8',
        state_name: 'Done',
        state_category: 'completed',
        is_terminal: true,
        state_unavailable: null,
      }),
    ])
    const { edges } = await fetchWorkItemChain(ROOT, 'chain')
    expect(edges.map((edge) => [edge.reference, edge.is_terminal])).toEqual([
      ['OTH-7', false],
      ['OTH-8', true],
    ])
  })

  it('reads a source whose state the store could not resolve as unknown', async () => {
    serve([
      block({
        state_name: null,
        state_category: null,
        is_terminal: null,
        state_unavailable: 'state_missing',
      }),
    ])
    const chain = await fetchWorkItemChain(ROOT, 'chain')
    const [edge] = chain.edges
    expect([edge.is_terminal, edge.state_unavailable]).toEqual([null, 'state_missing'])
  })

  it('still reads a bare edge, as a server that predates the source fields sends it', async () => {
    serve([{ from: OUTSIDE, to: ROOT, kind: 'discovered-from' }])
    const chain = await fetchWorkItemChain(ROOT, 'chain')
    expect(chain.edges).toHaveLength(1)
  })

  it('refuses a state neither known nor said to be unavailable, and an undeclared field', async () => {
    serve([block({ state_name: null, state_category: null, is_terminal: null })])
    await expect(fetchWorkItemChain(ROOT, 'chain')).rejects.toThrow()
    serve([
      block({
        state_name: 'Review',
        state_category: 'review',
        is_terminal: false,
        state_unavailable: null,
        title: 'not part of an edge',
      }),
    ])
    await expect(fetchWorkItemChain(ROOT, 'chain')).rejects.toThrow()
  })
})
