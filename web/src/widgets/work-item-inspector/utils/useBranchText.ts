import { useI18n } from 'vue-i18n'

import { LANE_GROUP_ORDER } from '@/widgets/work-item-inspector/utils/chainBranchLayout.ts'
import type { BranchLane } from '@/widgets/work-item-inspector/utils/chainBranchLayout.ts'

import type { ChainGroup } from '@/shared/api/planningChainGroups.ts'
import { holderName } from '@/shared/lib/actor.ts'

/*
 * The legend and every count name groups in the order a lane runs through
 * them, in the groups' own words — the ones the graph's legend and the member
 * list use. Queued and backlog work share the grey of what is ahead, as they
 * share the graph's neutral dot, and each keeps its own name, so no word on the
 * map stands for a set no other view names.
 */

/**
 * What the branch map says in words: a lane's name and counts, the task a
 * cursor reaches, the whole map's summary and the legend.
 *
 * Colour is never the only signal there, so every state the drawing colours is
 * also named here, and the same words reach the eye and the screen reader.
 */
export function useBranchText() {
  const { t } = useI18n()

  function laneName(lane: BranchLane): string {
    return lane.reference ?? t('workItem.chain.noEpic')
  }

  /**
   * What a lane's label line says after its name: how much of it is done, out
   * of how much. Its length already draws its volume and its colours where the
   * rest stands, so one figure is enough, and it is short enough to stand at
   * the lane's end on a narrow map.
   */
  function laneCounts(lane: BranchLane): string {
    return t('workItem.chain.map.countDone', {
      done: lane.counts.done,
      total: lane.members.length,
    })
  }

  /** Every group these lanes hold and how many, in lane order, in the groups' own words. */
  function groupParts(lanes: readonly BranchLane[]): string {
    const counts = new Map<ChainGroup, number>()
    for (const group of lanes.flatMap((lane) => lane.groups))
      counts.set(group, (counts.get(group) ?? 0) + 1)
    return LANE_GROUP_ORDER.filter((group) => counts.has(group))
      .map((group) =>
        t('workItem.chain.part', {
          group: t(`workItem.chain.group.${group}`),
          count: counts.get(group),
        }),
      )
      .join(', ')
  }

  /** A lane's accessible name: its parent and title, and every group it holds. */
  function laneLabel(lane: BranchLane): string {
    const name = lane.title ? `${laneName(lane)} ${lane.title}` : laneName(lane)
    return t('workItem.chain.map.lane', {
      name,
      total: lane.members.length,
      parts: groupParts([lane]),
    })
  }

  /** What a task is called aloud when the keyboard cursor reaches it. */
  function describe(lane: BranchLane, index: number): string {
    const member = lane.members[index]
    const line = t('workItem.chain.map.task', {
      reference: member.reference,
      title: member.title,
      state: member.state.name,
    })
    return !member.state.is_terminal && member.claim_ref
      ? `${line} · ${holderName(member.claim_ref)}`
      : line
  }

  function position(index: number, total: number): string {
    return t('workItem.chain.map.position', { position: index + 1, total })
  }

  function summary(lanes: readonly BranchLane[], total: number): string {
    return t('workItem.chain.map.summary', {
      lanes: lanes.length,
      total,
      parts: groupParts(lanes),
    })
  }

  /**
   * The groups this map draws, in the order a lane runs through them. A legend
   * names what is on the drawing, as the graph's does: a key for a state no
   * member is in reads as a claim that one is, and the blocked one would say so
   * in bold.
   */
  function legend(lanes: readonly BranchLane[]) {
    const drawn = new Set(lanes.flatMap((lane) => lane.groups))
    return LANE_GROUP_ORDER.filter((group) => drawn.has(group)).map((group) => ({
      state: group,
      label: t(`workItem.chain.group.${group}`),
    }))
  }

  return { describe, laneCounts, laneLabel, laneName, legend, position, summary, t }
}
