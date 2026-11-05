/**
 * The card's chain section where its answer leaves nothing to choose between or tell apart:
 * every member in one lane, or in one state. Read through the real client.
 */
import { flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import { chainResponse, emptyChain, largeEpicChain } from '../fixtures/chain.ts'
import { getButton, workItemFixture } from '../fixtures/workItem.ts'
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

/** The chain reads answer with these, in turn, the last one for good. */
async function openWith(...answers: Response[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(
      withSecurityBootstrap(async (input) => {
        const { pathname } = new URL(requestUrl(input), 'http://localhost')
        if (pathname !== '/api/planning/work-item/chain') throw new Error(`unexpected ${pathname}`)
        const answer = answers.length > 1 ? answers.shift() : answers[0]
        if (!answer) throw new Error('no answer left')
        return answer.clone()
      }),
    ),
  )
  const wrapper = mountInspector(ROOT)
  await flushPromises()
  return wrapper
}

const section = (wrapper: VueWrapper) => wrapper.find('section.chain')

describe('the chain section of a card, with nothing to choose between', () => {
  useInspectorHarness()

  it('narrows nothing once a chosen lane is the only one the answer has', async () => {
    const whole = largeEpicChain()
    const epic = {
      ...whole,
      scope: 'epic' as const,
      members: whole.members.filter((member) => member.parent_reference === 'MAIN-384'),
      total: 273,
      closed: 273,
      open: 0,
      ready: 0,
      by_category: { completed: 273 },
      origins: whole.origins.slice(0, 1),
      edges: [],
    }
    const wrapper = await openWith(json(chainResponse(whole)), json(chainResponse(epic)))
    await getButton(wrapper, 'MAIN-384').trigger('click')
    expect(section(wrapper).find('.chain-lane-chip').exists()).toBe(true)
    await getButton(wrapper, 'Epic').trigger('click')
    await flushPromises()
    expect(section(wrapper).find('.chain-lane-chip').exists()).toBe(false)
  })

  it('names a state the whole chain is in once, under the map', async () => {
    const member = largeEpicChain().members.find(({ state }) => state.category === 'backlog')
    const lone = {
      ...emptyChain(),
      total: 1,
      open: 1,
      ready: 1,
      by_category: { backlog: 1 },
      origins: [{ parent_reference: null, parent_title: null, count: 1, open: 1 }],
      members: [{ ...member, parent_reference: null, ready: true }],
    }
    const wrapper = await openWith(json(chainResponse(lone as never)))
    // What the eye reads: the map's caption says it again for a screen reader, who has no key.
    const seen = section(wrapper).element.cloneNode(true) as Element
    for (const hidden of seen.querySelectorAll('.visually-hidden')) hidden.remove()
    expect(seen.textContent.match(/backlog/giu)).toHaveLength(1)
    expect(
      section(wrapper)
        .findAll('.chain-group-title')
        .map((title) => title.text()),
    ).toEqual(['Backlog · 1'])
    // The figure the note qualified is still there.
    expect(section(wrapper).get('.chain-summary-line').text()).toContain('Workable')
  })
})
