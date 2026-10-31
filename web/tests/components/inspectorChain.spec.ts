/**
 * The card's chain section, read through the real client against a stubbed
 * server: what the owner reads off a chain shaped like VAL-384, what it asks the
 * server and when, and the ways in and out of it.
 */
import { flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import { fetchWorkItem } from '@/shared/api/planningApi.ts'

import { chainResponse, emptyChain, largeEpicChain } from '../fixtures/chain.ts'
import { deferred, getButton, workItemFixture } from '../fixtures/workItem.ts'
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

/** Answer every chain read with the next response, and record what was asked. */
function serveChain(...answers: Response[]) {
  const asked: URLSearchParams[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(
      withSecurityBootstrap(async (input) => {
        const url = new URL(requestUrl(input), 'http://localhost')
        if (url.pathname !== '/api/planning/work-item/chain') throw new Error(`unexpected ${url}`)
        asked.push(url.searchParams)
        const answer = answers.length > 1 ? answers.shift() : answers[0]
        if (!answer) throw new Error('no answer left')
        return answer.clone()
      }),
    ),
  )
  return asked
}

async function open(item = ROOT, overrides: { writable?: boolean } = {}) {
  const wrapper = mountInspector(item, overrides)
  await flushPromises()
  return wrapper
}

function section(wrapper: VueWrapper) {
  return wrapper.find('section.chain')
}

describe('the chain section of a card', () => {
  useInspectorHarness()

  it('reads a VAL-384-shaped chain as totals, open work by category, trend, origins and groups', async () => {
    const asked = serveChain(json(chainResponse(largeEpicChain())))
    const wrapper = await open()
    const chain = section(wrapper)
    expect(chain.exists()).toBe(true)
    expect(asked).toHaveLength(1)
    expect(asked[0].get('id')).toBe(ROOT.work_item_id)
    expect(asked[0].get('scope')).toBe('chain')

    expect(chain.get('.chain-headline').text()).toBe('616 in all · 483 closed')
    // Open work by category, in the space's own state names, and the workable
    // count beside it rather than as a group of its own.
    expect(chain.get('.chain-breakdown').text()).toBe(
      '133 open: development 11 · code review 1 · todo 14 · backlog 107 · workable: 115',
    )
    expect(chain.get('.chain-trend').text()).toBe(
      'Last 7 days: +53 discovered, −42 closed — scope is growing',
    )
    expect(chain.get('.chain-chart').attributes('aria-label')).toContain('616 now')
    expect(chain.get('.chain-chart').attributes('aria-label')).toContain('483 closed and 133 open')

    const origins = chain.get('.chain-origins').text()
    expect(origins).toContain('Own epic VAL-384: 273 (open 0)')
    expect(origins).toContain('Discovered later: VAL-779 — 242 (open 100)')
    expect(origins).toContain('no epic — 88 (open 30)')

    const headings = chain.findAll('.chain-group-title').map((heading) => heading.text())
    expect(headings).toEqual(['Development · 11', 'Code review · 1', 'Todo · 14', 'Backlog · 107'])
    // Finished work is one folded group, closed until asked.
    expect(getButton(wrapper, 'Done · 483').attributes('aria-expanded')).toBe('false')
    expect(chain.findAll('.chain-row.is-done')).toHaveLength(0)
    // The holder, not the state, names who has the work in progress.
    expect(chain.findAll('.chain-row')[0].text()).toContain('codex')
    expect(chain.findAll('.chain-row-ready').length).toBeGreaterThan(0)
  })

  it('stops a long group after eight rows and shows the rest on request', async () => {
    serveChain(json(chainResponse(largeEpicChain())))
    const wrapper = await open()
    const backlog = () =>
      section(wrapper)
        .findAll('section.chain-group')
        .find((group) => group.attributes('aria-label') === 'Backlog')
    expect(backlog()?.findAll('.chain-row')).toHaveLength(8)
    await getButton(wrapper, 'Show all · 107').trigger('click')
    expect(backlog()?.findAll('.chain-row')).toHaveLength(107)

    await getButton(wrapper, 'Done · 483').trigger('click')
    expect(section(wrapper).findAll('.chain-row.is-done')).toHaveLength(8)
  })

  it('asks again with scope=epic when the scope toggle says Epic', async () => {
    const epic = { ...largeEpicChain(), scope: 'epic' as const }
    const asked = serveChain(json(chainResponse(largeEpicChain())), json(chainResponse(epic)))
    const wrapper = await open()
    await getButton(wrapper, 'Epic').trigger('click')
    await flushPromises()
    expect(asked.map((query) => query.get('scope'))).toEqual(['chain', 'epic'])
    expect(section(wrapper).get('.chain-trend').text()).toContain('+53 added')
  })

  it('holds the place with a loading line only for an item known to have children', async () => {
    const answer = deferred<Response>()
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(withSecurityBootstrap(() => answer.promise)),
    )
    const wrapper = await open()
    expect(section(wrapper).attributes('aria-busy')).toBe('true')
    expect(section(wrapper).get('[role="status"]').text()).toBe('Reading the chain…')
    answer.resolve(json(chainResponse(largeEpicChain())))
    await flushPromises()
    expect(section(wrapper).attributes('aria-busy')).toBeUndefined()
    expect(section(wrapper).find('[role="status"]').exists()).toBe(false)
  })

  it('holds no section for an item with no chain, and shows nothing while it loads', async () => {
    serveChain(json(chainResponse(emptyChain())))
    const leaf = workItemFixture('Leaf', 1)
    const wrapper = await open(leaf)
    expect(section(wrapper).exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Chain')
  })

  it('says a failed read failed, and a retry that succeeds shows the chain', async () => {
    const asked = serveChain(
      json({ error: { code: 'invalid_request', message: 'no work item' } }, 400),
      json(chainResponse(largeEpicChain())),
    )
    const wrapper = await open()
    expect(section(wrapper).get('[role="alert"]').text()).toContain(
      'The chain could not be loaded.',
    )
    await getButton(wrapper, 'Retry').trigger('click')
    await flushPromises()
    expect(asked).toHaveLength(2)
    expect(section(wrapper).find('[role="alert"]').exists()).toBe(false)
    expect(section(wrapper).get('.chain-headline').text()).toBe('616 in all · 483 closed')
  })

  it('refuses a payload whose counts disagree with its members', async () => {
    serveChain(json(chainResponse({ ...largeEpicChain(), total: 617, open: 134 })))
    const wrapper = await open()
    expect(section(wrapper).get('[role="alert"]').exists()).toBe(true)
    expect(section(wrapper).find('.chain-headline').exists()).toBe(false)
  })

  it('opens a member, or an origin, through the card navigation', async () => {
    serveChain(json(chainResponse(largeEpicChain())))
    const wrapper = await open()
    const row = section(wrapper).findAll('.chain-row')[0]
    const reference = row.get('.chain-row-reference').text()
    await row.trigger('click')
    await flushPromises()
    await getButton(wrapper, 'VAL-779').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('open')).toEqual([[reference], ['VAL-779']])
  })

  it('hands the chain it shows to the graph', async () => {
    serveChain(json(chainResponse(largeEpicChain())))
    const wrapper = await open()
    await getButton(wrapper, 'Show on graph').trigger('click')
    const [[shown]] = wrapper.emitted('chain') as [[{ root: { reference: string }; total: number }]]
    expect(shown.root.reference).toBe('VAL-384')
    expect(shown.total).toBe(616)
  })

  it('reads once per open and once per refresh, and never for an attached store', async () => {
    const asked = serveChain(json(chainResponse(largeEpicChain())))
    const wrapper = await open()
    expect(asked).toHaveLength(1)
    await wrapper.setProps({ refreshToken: 1 })
    await flushPromises()
    expect(asked).toHaveLength(2)
    // A refresh keeps the last answer on screen while it runs and after it.
    expect(section(wrapper).get('.chain-headline').text()).toBe('616 in all · 483 closed')

    vi.mocked(fetchWorkItem).mockResolvedValue(ROOT)
    const attached = await open(ROOT, { writable: false })
    expect(asked).toHaveLength(2)
    expect(section(attached).exists()).toBe(false)
  })
})
