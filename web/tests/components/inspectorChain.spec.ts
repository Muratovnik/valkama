/**
 * The card's chain section, read through the real client against a stubbed
 * server: what the owner reads off a chain shaped like MAIN-384, what it asks the
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

/** The group of members headed by this label. */
function group(wrapper: VueWrapper, label: string) {
  return section(wrapper)
    .findAll('section.chain-group')
    .find((found) => found.attributes('aria-label') === label)
}

/** What each shown row of a group says at its end, or null where it says nothing. */
function details(wrapper: VueWrapper, label: string) {
  return group(wrapper, label)
    ?.findAll('.chain-row')
    .map((row) => row.find('.chain-row-detail'))
    .map((detail) => (detail.exists() ? detail.text() : null))
}

const eight = <T>(value: T) => Array.from({ length: 8 }, () => value)

describe('the chain section of a card', () => {
  useInspectorHarness()

  it('reads a MAIN-384-shaped chain as a map first, then one line, the trend and the groups', async () => {
    const asked = serveChain(json(chainResponse(largeEpicChain())))
    const wrapper = await open()
    const chain = section(wrapper)
    expect(chain.exists()).toBe(true)
    expect(asked).toHaveLength(1)
    expect(asked[0].get('id')).toBe(ROOT.work_item_id)
    expect(asked[0].get('scope')).toBe('chain')

    // The section leads with its map; the totals follow it in one line.
    const parts = chain.element.querySelectorAll(
      '.branch-map, .chain-summary, .chain-chart, .chain-members',
    )
    expect([...parts].map((part) => part.classList[0])).toEqual([
      'branch-map',
      'chain-summary',
      'chain-chart',
      'chain-members',
    ])
    expect(chain.findAll('.chain-summary p')).toHaveLength(2)
    // Done and open, the open work by group in the board's own state names —
    // never lowercased keys — and the workable count beside it rather than as a
    // group of its own. It counts the backlog too, so it outnumbers the 14 to
    // do, and it says so. A name keeps its count, and a separator the part
    // before it, when the line wraps. The total says what it counts: the work
    // under the root, the root itself not included, which the board's chain
    // chip does include.
    expect(chain.get('.chain-summary-line').text()).toBe(
      'Under the root: 616 · Done\u{A0}483 · 133 open: Development\u{A0}11\u{A0}· Code\u{A0}review\u{A0}1\u{A0}· Todo\u{A0}14\u{A0}· Backlog\u{A0}107; workable 115 (backlog included)',
    )
    // 53 added against 42 done: the open part grows unless more than
    // 53 ÷ 7 ≈ 7.57 close a day, said to a tenth and rounded up.
    expect(chain.get('.chain-forecast').text().replaceAll('\u{A0}', ' ')).toBe(
      'Last 7 days: +53 added, −42 done. New work arrives faster than it closes: to converge, more than 7.6 a day must close',
    )
    expect(chain.get('.chain-chart').attributes('aria-label')).toContain('616 now')
    expect(chain.get('.chain-chart').attributes('aria-label')).toContain('483 done and 133 open')

    // Each origin is a lane of the map, its counts at its end; the textual
    // origins line the map replaced is gone.
    expect(chain.find('.chain-origins').exists()).toBe(false)
    expect(chain.findAll('.branch-map-label').map((label) => label.text())).toEqual([
      'MAIN-384',
      'MAIN-779',
      'no epic',
      'MAIN-900',
    ])
    expect(chain.findAll('.branch-map-count').map((count) => count.text())).toEqual([
      '273 of 273 done',
      '142 of 242 done',
      '58 of 88 done',
      '10 of 13 done',
    ])

    const headings = chain.findAll('.chain-group-title').map((heading) => heading.text())
    expect(headings).toEqual(['Development · 11', 'Code review · 1', 'Todo · 14', 'Backlog · 107'])
    // Finished work is one folded group, closed until asked.
    expect(getButton(wrapper, 'Done · 483').attributes('aria-expanded')).toBe('false')
    expect(chain.findAll('.chain-row.is-done')).toHaveLength(0)
    // The holder, not the state, names who has the work in progress.
    expect(chain.findAll('.chain-row')[0].text()).toContain('codex')
    expect(chain.findAll('.chain-row-ready').length).toBeGreaterThan(0)
  })

  it('calls each group one thing in the legend, the totals line and the headings', async () => {
    const mixed = largeEpicChain()
    // The open items under MAIN-900 wait in a second backlog state, so the
    // backlog spans two states and is named by the group's own word everywhere.
    for (const member of mixed.members.filter(
      (item) => item.parent_reference === 'MAIN-900' && !item.state.is_terminal,
    ))
      Object.assign(member.state, { key: 'icebox', name: 'Icebox' })
    serveChain(json(chainResponse(mixed)))
    const wrapper = await open()
    const chain = section(wrapper)
    const legend = chain.findAll('.branch-map-legend .state-label').map((label) => label.text())
    const headings = chain
      .findAll('.chain-group-title, .chain-done-toggle')
      .map((heading) => heading.text().replace(/ · \d+$/u, ''))
    const line = chain.get('.chain-summary-line').text().replaceAll('\u{A0}', ' ')
    expect(legend).toEqual(['Done', 'Code review', 'Development', 'Todo', 'Backlog'])
    expect(new Set(headings)).toEqual(new Set(legend))
    for (const word of legend) expect(line).toContain(`${word} `)
    // Narrowing the list to a lane in one backlog state keeps the chain's word.
    await getButton(wrapper, 'MAIN-779').trigger('click')
    expect(group(wrapper, 'Backlog')?.get('.chain-group-title').text()).toBe('Backlog · 74')
    expect(new Set(details(wrapper, 'Backlog'))).toEqual(new Set(['Backlog']))
  })

  it('names a row state only where its group heading does not', async () => {
    const mixed = largeEpicChain()
    // The three open items under MAIN-900 wait in a second backlog state, and
    // the first two closed ones were cancelled rather than done.
    for (const member of mixed.members.filter(
      (item) => item.parent_reference === 'MAIN-900' && !item.state.is_terminal,
    ))
      Object.assign(member.state, { key: 'icebox', name: 'Icebox' })
    for (const member of mixed.members.slice(0, 2))
      Object.assign(member.state, { key: 'cancelled', name: 'Cancelled', category: 'cancelled' })
    Object.assign(mixed.by_category, { completed: 481, cancelled: 2 })
    serveChain(json(chainResponse(largeEpicChain())), json(chainResponse(mixed)))
    // One state per group: the heading names it, and the rows do not repeat it.
    const single = await open()
    expect(details(single, 'Todo')).toEqual(eight(null))
    await getButton(single, 'Done · 483').trigger('click')
    expect(details(single, 'Done')).toEqual(eight(null))
    single.unmount()

    // A group that mixes states is headed by its category, and each row names its own.
    const several = await open()
    expect(group(several, 'Backlog')?.get('.chain-group-title').text()).toBe('Backlog · 107')
    await getButton(several, 'Show all · 107').trigger('click')
    const backlog = details(several, 'Backlog') ?? []
    expect(new Set(backlog)).toEqual(new Set(['Backlog', 'Icebox']))
    expect(backlog.filter((name) => name === 'Icebox')).toHaveLength(3)
    await getButton(several, 'Done · 483').trigger('click')
    expect(new Set(details(several, 'Done'))).toEqual(new Set(['Done', 'Cancelled']))
    // A holder still stands where the state would, with the start of its session.
    expect(details(several, 'Development')).toEqual(eight('codex · 1baa03d7'))
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
    expect(section(wrapper).get('.chain-forecast').text()).toContain('+53 added, −42 done')
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
    expect(section(wrapper).get('.chain-summary-line').text()).toBe(
      'Under the root: 616 · Done\u{A0}483 · 133 open: Development\u{A0}11\u{A0}· Code\u{A0}review\u{A0}1\u{A0}· Todo\u{A0}14\u{A0}· Backlog\u{A0}107; workable 115 (backlog included)',
    )
  })

  it('refuses a payload whose counts disagree with its members', async () => {
    serveChain(json(chainResponse({ ...largeEpicChain(), total: 617, open: 134 })))
    const wrapper = await open()
    expect(section(wrapper).get('[role="alert"]').exists()).toBe(true)
    expect(section(wrapper).find('.chain-summary-line').exists()).toBe(false)
  })

  it('opens a member, or a lane’s epic, through the card navigation', async () => {
    serveChain(json(chainResponse(largeEpicChain())))
    const wrapper = await open()
    const row = section(wrapper).findAll('.chain-row')[0]
    const reference = row.get('.chain-row-reference').text()
    await row.trigger('click')
    await flushPromises()
    await getButton(wrapper, 'MAIN-779').trigger('click')
    await getButton(wrapper, 'Open MAIN-779').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('open')).toEqual([[reference], ['MAIN-779']])
  })

  it('narrows the member list to the lane chosen on the map, and widens it back', async () => {
    serveChain(json(chainResponse(largeEpicChain())))
    const wrapper = await open()
    const headings = () =>
      section(wrapper)
        .findAll('.chain-group-title')
        .map((heading) => heading.text())
    const chip = () => section(wrapper).find('.chain-lane-chip')
    expect(chip().exists()).toBe(false)

    await getButton(wrapper, 'MAIN-779').trigger('click')
    expect(chip().text()).toBe('Lane MAIN-779')
    expect(chip().attributes('aria-label')).toBe('Lane MAIN-779: show every lane')
    expect(headings()).toEqual(['Development · 11', 'Code review · 1', 'Todo · 14', 'Backlog · 74'])
    expect(getButton(wrapper, 'Done · 142').exists()).toBe(true)
    // The narrowed list follows the map and its line directly; the whole
    // chain's history moves below it, so the rows the choice narrowed are not
    // a chart's height away from the label that narrowed them.
    const order = () =>
      [
        ...section(wrapper).element.querySelectorAll(
          '.branch-map, .chain-summary, .chain-lane-filter, .chain-members, .chain-chart',
        ),
      ].map((part) => part.classList[0])
    expect(order()).toEqual([
      'branch-map',
      'chain-summary',
      'chain-lane-filter',
      'chain-members',
      'chain-chart',
    ])

    // Another lane takes its place; the lane of no epic has no epic to open.
    await getButton(wrapper, 'no epic').trigger('click')
    expect(chip().text()).toBe('Lane no epic')
    expect(headings()).toEqual(['Backlog · 30'])
    expect(wrapper.findAll('button').some((button) => button.text().startsWith('Open '))).toBe(
      false,
    )

    // The chip widens the list back, and so does the same label again.
    await chip().trigger('click')
    expect(chip().exists()).toBe(false)
    expect(headings()).toEqual([
      'Development · 11',
      'Code review · 1',
      'Todo · 14',
      'Backlog · 107',
    ])
    await getButton(wrapper, 'MAIN-900').trigger('click')
    await getButton(wrapper, 'MAIN-900').trigger('click')
    expect(chip().exists()).toBe(false)
  })

  it('forgets a chosen lane the next answer does not have', async () => {
    // The epic scope is the root's own children: one lane, and no MAIN-900 in it.
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
    serveChain(json(chainResponse(whole)), json(chainResponse(epic)))
    const wrapper = await open()
    await getButton(wrapper, 'MAIN-900').trigger('click')
    expect(section(wrapper).find('.chain-lane-chip').exists()).toBe(true)
    await getButton(wrapper, 'Epic').trigger('click')
    await flushPromises()
    expect(
      section(wrapper)
        .findAll('.branch-map-label')
        .map((label) => label.text()),
    ).toEqual(['MAIN-384'])
    expect(section(wrapper).find('.chain-lane-chip').exists()).toBe(false)
  })

  it('hands the chain it shows to the graph', async () => {
    serveChain(json(chainResponse(largeEpicChain())))
    const wrapper = await open()
    await getButton(wrapper, 'Show on graph').trigger('click')
    const [[shown]] = wrapper.emitted('chain') as [[{ root: { reference: string }; total: number }]]
    expect(shown.root.reference).toBe('MAIN-384')
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
    expect(section(wrapper).get('.chain-summary-line').text()).toBe(
      'Under the root: 616 · Done\u{A0}483 · 133 open: Development\u{A0}11\u{A0}· Code\u{A0}review\u{A0}1\u{A0}· Todo\u{A0}14\u{A0}· Backlog\u{A0}107; workable 115 (backlog included)',
    )

    vi.mocked(fetchWorkItem).mockResolvedValue(ROOT)
    const attached = await open(ROOT, { writable: false })
    expect(asked).toHaveLength(2)
    // The section stays, and says where a chain can be read instead.
    expect(section(attached).get('.chain-quiet').text()).toBe(
      'The chain is available only for work items of the primary store.',
    )
    expect(section(attached).find('.chain-summary-line').exists()).toBe(false)
    expect(section(attached).find('[role="alert"]').exists()).toBe(false)
  })

  it('says the same for an attached item with no children of its own', async () => {
    const asked = serveChain(json(chainResponse(emptyChain())))
    const leaf = workItemFixture('Leaf', 1)
    vi.mocked(fetchWorkItem).mockResolvedValue(leaf)
    const wrapper = await open(leaf, { writable: false })
    expect(asked).toHaveLength(0)
    expect(section(wrapper).get('.chain-quiet').text()).toContain('primary store')
  })
})
