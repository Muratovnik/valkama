import { useI18n } from 'vue-i18n'

import type { BranchLane } from '@/widgets/work-item-inspector/utils/chainBranchLayout.ts'

import { CHAIN_PROGRESS_ORDER } from '@/shared/api/planningChainGroups.ts'
import type { ChainGroup } from '@/shared/api/planningChainGroups.ts'
import { holderName } from '@/shared/lib/actor.ts'

/*
 * The legend and every count name groups in the order a lane runs through
 * them, by the word the card's section gives each one: the state the whole
 * group is in, as the board's column names it, or the group's own word where it
 * spans several. The totals line and the member headings read the same word, so
 * the map never calls a group something the list under it does not. Queued and
 * backlog work share the grey of what is ahead, as they share the graph's
 * neutral dot, and each keeps its own name.
 */

/**
 * What the branch map says in words: a lane's name and counts, the task a
 * cursor reaches, the whole map's summary and the legend.
 *
 * Colour is never the only signal there, so every state the drawing colours is
 * also named here, and the same words reach the eye and the screen reader.
 */
export function useBranchText(groupName: (group: ChainGroup) => string) {
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

  /** Every group these lanes hold and how many, in lane order, by the section's word for each. */
  function groupParts(lanes: readonly BranchLane[]): string {
    const counts = new Map<ChainGroup, number>()
    for (const group of lanes.flatMap((lane) => lane.groups))
      counts.set(group, (counts.get(group) ?? 0) + 1)
    return CHAIN_PROGRESS_ORDER.filter((group) => counts.has(group))
      .map((group) =>
        t('workItem.chain.part', {
          group: groupName(group),
          count: counts.get(group),
        }),
      )
      .join(', ')
  }

  /** The two texts a lane's label line carries, as the drawing lays them out. */
  function laneTexts(lane: BranchLane) {
    return { name: laneName(lane), counts: laneCounts(lane) }
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
    return CHAIN_PROGRESS_ORDER.filter((group) => drawn.has(group)).map((group) => ({
      state: group,
      label: groupName(group),
    }))
  }

  return { describe, laneCounts, laneLabel, laneName, laneTexts, legend, position, summary, t }
}
