/**
 * The graph field scoped to a chain, and the whole-space field that draws
 * every open item in its frame: what is drawn, how closed work reads, and the
 * controls that change either. A chain grown from a goal, drawn in frames, has
 * a spec of its own.
 */
import { ref } from 'vue'

import { flushPromises } from '@vue/test-utils'
import ELK from 'elkjs/lib/elk.bundled.js'
import { describe, expect, it, vi } from 'vitest'

import GraphFrame from '@/widgets/work-item-graph/components/GraphFrame.vue'
import GraphLegend from '@/widgets/work-item-graph/components/GraphLegend.vue'
import GraphNodeCard from '@/widgets/work-item-graph/components/GraphNodeCard.vue'

import type { PlanningEdge } from '@/shared/api/planningModel.ts'

import {
  chain,
  DONE,
  drawn,
  flowLines,
  id,
  items,
  known,
  OPEN,
  openGraph,
  openTaskChain,
  taskEdges,
  taskItems,
} from '../fixtures/graphChainScope.ts'

const dimensions = ref({ width: 1200, height: 680 })
const viewport = ref({ x: 0, y: 0, zoom: 1 })

vi.mock('@vue-flow/core', async (original) => ({
  ...(await original<typeof import('@vue-flow/core')>()),
  useVueFlow: () => ({
    fitView: vi.fn().mockResolvedValue(true),
    setViewport: vi.fn().mockResolvedValue(true),
    dimensions,
    viewport,
    minZoom: ref(0.01),
    maxZoom: ref(1.45),
    vueFlowRef: ref(null),
  }),
}))

vi.mock('@/widgets/work-item-graph/utils/graphLayoutEngine.ts', () => ({
  createGraphLayoutEngine: () => {
    const elk = new ELK()
    return { layout: elk.layout.bind(elk), terminateWorker: vi.fn() }
  },
}))

describe('the whole-space graph and the items no link touches', () => {
  it('draws every open item in its frame, with no switch to leave the unlinked out', async () => {
    const graph = openGraph()
    // 3 is tied to nothing but its goal, 4 only to closed work hidden here, and
    // 7 and 8 to nothing: each still stands in its frame.
    expect(await drawn(graph)).toEqual(['MAIN-3', 'MAIN-4', 'MAIN-5', 'MAIN-6', 'MAIN-7', 'MAIN-8'])
    expect(graph.find('[role="switch"]').exists()).toBe(false)
    // The open/all filter still works.
    await graph.get('[role="radio"][aria-checked="false"]').trigger('click')
    expect(await drawn(graph)).toContain('MAIN-2')
    // The whole space has no root to mark.
    expect(graph.find('.flow-node-root').exists()).toBe(false)
  })

  it('names live work in both keys, the strip’s and the narrow bar’s, only while a drawn card shows it', async () => {
    const keys = (graph: ReturnType<typeof openGraph>) =>
      graph
        .findAllComponents(GraphLegend)
        .map((key) => ({ signs: key.props('signs'), moving: key.props('moving') }))
    const quiet = openGraph()
    await drawn(quiet)
    expect(keys(quiet)).toEqual([
      { signs: [], moving: false },
      { signs: [], moving: false },
    ])
    // Each sign a drawn card shows, once, in the key's order: an asking session apart from one
    // whose turn is over.
    const live = openGraph({
      live: {
        [id(5)]: { state: 'held' },
        [id(6)]: { state: 'working' },
        [id(7)]: { state: 'waiting', long: false, asks: true },
        [id(8)]: { state: 'waiting', long: false, asks: false },
        [id(3)]: { state: 'held' },
      },
    })
    await drawn(live)
    const named = { signs: ['working', 'asks', 'waiting', 'held'], moving: true }
    expect(keys(live)).toEqual([named, named])
    // Held work hidden with the closed items is not on the field, so the key says nothing of it.
    const hidden = openGraph({ live: { [id(2)]: { state: 'held' } } })
    await drawn(hidden)
    expect(keys(hidden).map((key) => key.signs)).toEqual([[], []])
    // Work moving under a drawn frame moves on the field, card or no card: the
    // frame counts it.
    const underFrame = openGraph({ live: { [id(2)]: { state: 'working' } } })
    await drawn(underFrame)
    expect(keys(underFrame).map((key) => key.moving)).toEqual([true, true])
  })

  it('says nothing of motion for work the chain leaves off the field', async () => {
    const chain = { members: [id(2), id(3), id(4)], reference: 'MAIN-1', total: 3 }
    const moving = (work: number) =>
      openGraph({
        scopeKind: 'chain',
        scopeRootId: id(1),
        chain,
        live: { [id(work)]: { state: 'working' } },
      })
    const outside = moving(7)
    expect(await drawn(outside)).not.toContain('MAIN-7')
    expect(outside.findAllComponents(GraphLegend).map((key) => key.props('moving'))).toEqual([
      false,
      false,
    ])
    const inside = moving(3)
    await drawn(inside)
    expect(inside.findAllComponents(GraphLegend).map((key) => key.props('moving'))).toEqual([
      true,
      true,
    ])
  })
})

describe('a chain grown from a task, drawn flat', () => {
  it('draws the root and the open members, and the closed ones only when the switch is thrown', async () => {
    const graph = openTaskChain()
    expect(await drawn(graph)).toEqual(['MAIN-1', 'MAIN-3', 'MAIN-4'])
    expect(graph.findAllComponents(GraphFrame)).toHaveLength(0)
    // One switch, and it is the closed one: a chain has no unlinked toggle and
    // no open/all filter.
    const toggle = graph.get('[role="switch"]')
    expect(graph.findAll('[role="switch"]')).toHaveLength(1)
    expect(toggle.text()).toBe('Closed · 1')
    expect(toggle.attributes('aria-label')).toBe('Draw the closed members of the chain')
    expect(toggle.attributes('aria-checked')).toBe('false')
    expect(graph.find('.graph-filter').exists()).toBe(false)
    // The chip still counts the whole chain.
    expect(graph.get('.graph-chip').text()).toBe('Chain MAIN-1 · 3')

    await toggle.trigger('click')
    expect(await drawn(graph)).toEqual(['MAIN-1', 'MAIN-2', 'MAIN-3', 'MAIN-4'])
    expect(graph.get('[role="switch"]').attributes('aria-checked')).toBe('true')
    const cards = graph.findAllComponents(GraphNodeCard)
    const card = (reference: string) =>
      cards.find((entry) => entry.props('node').reference === reference)
    expect(card('MAIN-2')?.props('recessed')).toBe(true)
    expect(card('MAIN-3')?.props('recessed')).toBe(false)
    expect(card('MAIN-2')?.props('chainGroup')).toBe('done')
    expect(card('MAIN-3')?.props('chainGroup')).toBe('ready')
  })

  it('takes the closed switch from its host, and hands a change back rather than keeping it', async () => {
    const graph = openTaskChain({ showClosed: true })
    // An address that says closed draws the closed members from the start.
    expect(await drawn(graph)).toEqual(['MAIN-1', 'MAIN-2', 'MAIN-3', 'MAIN-4'])
    await graph.get('[role="switch"]').trigger('click')
    expect(graph.emitted('update:showClosed')).toEqual([[false]])
    await graph.setProps({ showClosed: false })
    expect(await drawn(graph)).toEqual(['MAIN-1', 'MAIN-3', 'MAIN-4'])
  })

  it('marks the root with a word and in its accessible name, closed or not', async () => {
    const closedRoot = taskItems.map((entry) =>
      entry.reference === 'MAIN-1' ? { ...entry, open: false, state: DONE } : entry,
    )
    const graph = openTaskChain({ items: closedRoot })
    expect(await drawn(graph)).toEqual(['MAIN-1', 'MAIN-3', 'MAIN-4'])
    const cards = graph.findAllComponents(GraphNodeCard)
    const root = cards.find((entry) => entry.props('node').reference === 'MAIN-1')
    expect(root?.props('root')).toBe(true)
    // Closed, it still stands above the closed work rather than with it.
    expect(root?.props('recessed')).toBe(false)
    expect(root?.get('.flow-node-root').text()).toBe('root')
    expect(root?.get('button').attributes('aria-label')).toBe('MAIN-1 item 1 · Done · chain root')
    // Every other card drawn, read one by one: none says root.
    const others = cards.filter((entry) => entry.props('node').reference !== 'MAIN-1')
    expect(others.map((entry) => entry.find('.flow-node-root').exists())).toEqual([false, false])
  })

  it('says what a member waits on outside the chain, and draws no link to work it does not draw', async () => {
    // 3 is blocked by 5, of this space but not of the chain; 4 by an item of
    // another space; the root by a finished item of another space.
    const edges: PlanningEdge[] = [
      ...taskEdges,
      { from: id(5), to: id(3), kind: 'blocks', reference: 'MAIN-5', ...known(true) },
      { from: id(9001), to: id(4), kind: 'blocks', reference: 'OTH-7', ...known(true) },
      { from: id(9002), to: id(1), kind: 'blocks', reference: 'OTH-8', ...known(false) },
    ]
    const graph = openTaskChain({ edges, showClosed: true })
    expect(await drawn(graph)).toEqual(['MAIN-1', 'MAIN-2', 'MAIN-3', 'MAIN-4'])
    const cards = graph.findAllComponents(GraphNodeCard)
    const waiting = (reference: string) =>
      cards.find((entry) => entry.props('node').reference === reference)?.props('waitingOn')
    expect([waiting('MAIN-3'), waiting('MAIN-4'), waiting('MAIN-1')]).toEqual([
      'MAIN-5',
      'OTH-7',
      null,
    ])
    // Only the links between two drawn nodes are drawn: each from the work the
    // other was found on.
    expect(flowLines(graph)).toEqual([
      [id(1), id(2)],
      [id(1), id(3)],
      [id(2), id(4)],
    ])
  })

  it('names in its legend the groups it draws, and keeps the place of the one the switch adds', async () => {
    const graph = openTaskChain()
    await drawn(graph)
    const key = '.graph-canvas .graph-legend-state'
    const named = () => graph.findAll(`${key}:not(.held)`).map((entry) => entry.text())
    const places = () => graph.findAll(key).map((entry) => entry.text())
    // Every open member is in the one queued state, so the key says its name,
    // as the board's column and the card's chain section do.
    expect(named()).toEqual(['Ready'])
    // «Done» is not drawn, so it is not named; its place is kept, marked held, so
    // throwing the switch moves no word of the key. The held mark is what this
    // reads: that it leaves the place unseen is the stylesheet's, which this DOM
    // does not apply.
    expect(places()).toEqual(['Done', 'Ready'])
    expect(graph.get(`${key}.held`).text()).toBe('Done')
    await graph.get('[role="switch"]').trigger('click')
    await drawn(graph)
    expect(named()).toEqual(['Done', 'Ready'])
    expect(places()).toEqual(['Done', 'Ready'])
    // The key lies on the field. The bar's options hold the same key for a
    // narrow workspace only, where the field's corner gives way to the count;
    // which one shows is the container's call (the browser spec at 390).
    expect(graph.find('.graph-canvas .graph-legend').exists()).toBe(true)
    expect(graph.get('.graph-bar .graph-options .graph-legend').text()).toBe(
      graph.get('.graph-canvas .graph-legend').text(),
    )
  })

  it('keeps the group’s own word in its legend where the members span several states', async () => {
    const waiting = { ...OPEN, state_id: 'waiting', key: 'waiting', name: 'Waiting' }
    const queued = { ...OPEN, state_id: 'queued', key: 'queued', name: 'Queued' }
    const legendOf = async (states: Record<string, typeof OPEN>) => {
      const staged = taskItems.map((entry) =>
        states[entry.work_item_id] ? { ...entry, state: states[entry.work_item_id] } : entry,
      )
      const graph = openTaskChain({ items: staged })
      await drawn(graph)
      return graph
        .findAll('.graph-canvas .graph-legend-state:not(.held)')
        .map((entry) => entry.text())
    }
    // Two ready states among the members: neither names the group.
    expect(await legendOf({ [id(3)]: waiting, [id(4)]: queued })).toEqual(['Ready'])
    // One state they share names it.
    expect(await legendOf({ [id(3)]: queued, [id(4)]: queued })).toEqual(['Queued'])
  })

  it('orders its legend as the card’s map runs a lane: finished, under way with review first, then ahead', async () => {
    const dev = { ...OPEN, state_id: 'dev', key: 'dev', name: 'Dev', category: 'active' }
    const review = {
      ...OPEN,
      state_id: 'review',
      key: 'review',
      name: 'Review',
      category: 'review',
    }
    const staged = taskItems.map((entry) => {
      if (entry.work_item_id === id(3)) return { ...entry, state: dev }
      return entry.work_item_id === id(4) ? { ...entry, state: review } : entry
    })
    const graph = openTaskChain({ items: staged })
    await drawn(graph)
    const named = graph.findAll('.graph-canvas .graph-legend-state:not(.held)')
    // The root's card is the ready one.
    expect(named.map((entry) => entry.text())).toEqual(['Review', 'In progress', 'Ready'])
  })
})

describe('the graph scoped to one chain', () => {
  const chainEdges: PlanningEdge[] = [{ from: id(4), to: id(2), kind: 'discovered-from' }]

  it('leaves out the origin chip that would only repeat the root, and keeps any other', async () => {
    // 3 is filed under the root itself; 4 under a goal outside the chain.
    const filed = items.map((entry) =>
      entry.reference === 'MAIN-4' ? { ...entry, parent_id: id(5) } : entry,
    )
    const graph = openGraph({
      scopeKind: 'chain',
      scopeRootId: id(1),
      chain,
      edges: chainEdges,
      items: filed,
    })
    await drawn(graph)
    const cards = graph.findAllComponents(GraphNodeCard)
    const card = (reference: string) =>
      cards.find((entry) => entry.props('node').reference === reference)
    expect(card('MAIN-3')?.props('parentReference')).toBeUndefined()
    expect(card('MAIN-3')?.find('.flow-node-goal').exists()).toBe(false)
    expect(card('MAIN-4')?.get('.flow-node-goal').text()).toBe('MAIN-5')
  })

  it('names the chain in a chip that leads back to the whole space', async () => {
    const graph = openGraph({ scopeKind: 'chain', scopeRootId: id(1), chain, edges: chainEdges })
    await drawn(graph)
    const chip = graph.get('.graph-chip')
    expect(chip.text()).toBe('Chain MAIN-1 · 3')
    expect(chip.attributes('aria-label')).toBe('Leave chain MAIN-1 and show the whole space')
    await chip.trigger('click')
    expect(graph.emitted('exit-chain')).toHaveLength(1)
  })

  it('draws each node as its colour and reference once the field is zoomed out past reading', async () => {
    const graph = openGraph({ scopeKind: 'chain', scopeRootId: id(1), chain, edges: chainEdges })
    await drawn(graph)
    expect(graph.find('.flow-node-overview').exists()).toBe(false)
    viewport.value = { x: 0, y: 0, zoom: 0.3 }
    await flushPromises()
    const cards = graph.findAllComponents(GraphNodeCard)
    expect(cards).toHaveLength(2)
    expect(cards.every((card) => card.props('overview'))).toBe(true)
    const card = cards.find((entry) => entry.props('node').reference === 'MAIN-3')
    expect(card?.get('.flow-node-overview').text()).toBe('MAIN-3')
    expect(card?.find('.flow-node-title').exists()).toBe(false)
    // Its accessible name still says everything the card does.
    expect(card?.get('button').attributes('aria-label')).toBe('MAIN-3 item 3 · Ready')
    viewport.value = { x: 0, y: 0, zoom: 1 }
    await flushPromises()
    expect(graph.find('.flow-node-overview').exists()).toBe(false)
  })
})
