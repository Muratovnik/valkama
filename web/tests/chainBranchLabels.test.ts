/**
 * The words the branch map sets beside its lanes: each lane's label line, which
 * stands against the lane it names, and the references under work in progress,
 * which say how many they leave out.
 *
 * The expectations come from what a reader has to be able to tell: whose label
 * a line is, and whether three references are all of the work under way.
 */
import { describe, expect, it } from 'vitest'

import { drawBranches } from '@/widgets/work-item-inspector/utils/chainBranchDrawing.ts'
import type { LaneDrawing } from '@/widgets/work-item-inspector/utils/chainBranchDrawing.ts'
import { layoutBranches } from '@/widgets/work-item-inspector/utils/chainBranchLayout.ts'

import type { WorkItemChain } from '@/shared/api/planningChainApi.ts'

import { chainOf, found, mapId, mapMember } from './fixtures/chainMap.ts'

const ROOT = { id: mapId(1), reference: 'MAP-1', title: 'Root' }

const asChain = (value: unknown) => value as WorkItemChain

/** A lane's label line stands against the lane it names: beside it on its line, or just above its start. */
function expectBesideItsLane(lane: LaneDrawing, width: number) {
  const { head } = lane
  // A line that ends where its lane starts stands on that lane's line.
  if (lane.before) expect(lane.inline).toBe(true)
  if (lane.inline) {
    const height = lane.stacked ? 42 : 24
    expect((head.top ?? 0) + height / 2).toBeCloseTo(lane.y, 6)
  }
  if (head.left === undefined) {
    // Ending where the lane begins.
    const end = width - (head.right ?? 0)
    expect(end).toBeLessThanOrEqual(lane.x0)
    expect(end).toBeGreaterThanOrEqual(lane.x0 - lane.step - 8)
    return
  }
  // Starting at the lane, or just past its end.
  expect(head.left).toBeGreaterThanOrEqual(lane.x0 - lane.step - 8)
  expect(head.left).toBeLessThanOrEqual(lane.x1 + 8 + 1e-9)
}

describe('the words beside the lanes', () => {
  it('counts the current work its references leave out, so a few never read as all', () => {
    // Fifteen tasks under way in one lane: at 342px a handful of references fit.
    const own = [
      ...Array.from({ length: 10 }, (_, index) =>
        mapMember(`MAP-${100 + index}`, 'done', 'MAP-1', { closed: index }),
      ),
      ...Array.from({ length: 15 }, (_, index) =>
        mapMember(`MAP-${200 + index}`, 'active', 'MAP-1', { holder: 'codex' }),
      ),
    ]
    const layout = layoutBranches(asChain(chainOf(ROOT, own)))
    for (const width of [342, 620]) {
      const [lane] = drawBranches(layout, width).lanes
      const references = lane.labels.map((label) => label.reference)
      const named = references.filter((reference) => !reference.startsWith('+'))
      expect(named.length).toBeGreaterThan(0)
      expect(named.length).toBeLessThan(15)
      // The last label counts exactly the ones not named, and stays inside the map.
      expect(references.at(-1)).toBe(`+${15 - named.length}`)
      const last = lane.labels.at(-1)?.box
      expect((last?.left ?? 0) + (last?.width ?? 0)).toBeLessThanOrEqual(width)
      // Three references read as three: a clear gap between neighbours.
      const boxes = lane.labels.map(({ box }) => [
        box.left ?? 0,
        (box.left ?? 0) + (box.width ?? 0),
      ])
      for (const [index, [left]] of boxes.entries())
        if (index) expect(left - boxes[index - 1][1]).toBeGreaterThanOrEqual(12)
    }
    // A lane whose every current task is named says nothing more.
    const few = layoutBranches(asChain(chainOf(ROOT, own.slice(0, 11))))
    expect(drawBranches(few, 620).lanes[0].labels.map((label) => label.reference)).toEqual([
      'MAP-200',
    ])
  })

  it('stands each lane’s label beside its own lane, never a row above and away from it', () => {
    // A long root lane and short lanes forking near its end, as on a chain
    // that grew late: the short lanes bunch at the right edge.
    const own = [
      ...Array.from({ length: 60 }, (_, index) =>
        mapMember(`MAP-${100 + index}`, 'done', 'MAP-1', { closed: index }),
      ),
      ...Array.from({ length: 20 }, (_, index) =>
        mapMember(`MAP-${200 + index}`, 'backlog', 'MAP-1', { created: 300 + index }),
      ),
    ]
    const late = Array.from({ length: 3 }, (_, index) =>
      mapMember(`MAP-${400 + index}`, 'done', 'MAP-90', { created: 500 + index, closed: 600 }),
    )
    const loose = Array.from({ length: 2 }, (_, index) =>
      mapMember(`MAP-${450 + index}`, 'backlog', null, { created: 550 + index }),
    )
    const early = Array.from({ length: 2 }, (_, index) =>
      mapMember(`MAP-${470 + index}`, 'backlog', 'MAP-91', { created: 560 + index }),
    )
    const layout = layoutBranches(
      asChain(
        chainOf(ROOT, [...own, ...late, ...loose, ...early], {
          edges: [
            ...late.map((member) => found(member, own[58])),
            ...loose.map((member) => found(member, own[59])),
            ...early.map((member) => found(member, own[20])),
          ],
        }),
      ),
    )
    for (const width of [342, 620, 1100]) {
      const drawing = drawBranches(layout, width, (lane) => ({
        name: lane.reference ?? 'no epic',
        counts: `${lane.counts.done} of ${lane.members.length} done`,
      }))
      for (const lane of drawing.lanes) expectBesideItsLane(lane, width)
      // No label line runs into the next lane's row.
      for (const [index, lane] of drawing.lanes.entries()) {
        const next = drawing.lanes[index + 1]
        if (next) expect(next.top).toBeGreaterThan(lane.y)
      }
    }
  })
})
