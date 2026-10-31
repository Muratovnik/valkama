import { useI18n } from 'vue-i18n'

import type { BranchLane } from '@/widgets/work-item-inspector/utils/chainBranchLayout.ts'

import type { ChainGroup } from '@/shared/api/planningChainGroups.ts'
import { actorName } from '@/shared/lib/actor.ts'

/**
 * The map's five colours and the groups each one draws: queued and backlog work
 * share the grey of what is ahead, so they share one key.
 */
const LEGEND: readonly { groups: readonly ChainGroup[]; label: string; state: ChainGroup }[] = [
  { state: 'done', groups: ['done'], label: 'workItem.chain.group.done' },
  { state: 'review', groups: ['review'], label: 'workItem.chain.group.review' },
  { state: 'active', groups: ['active'], label: 'workItem.chain.group.active' },
  { state: 'blocked', groups: ['blocked'], label: 'workItem.chain.group.blocked' },
  { state: 'backlog', groups: ['queued', 'backlog'], label: 'workItem.chain.map.ahead' },
]

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

  /** A lane's counts as text, the empty ones left out. */
  function laneCounts(lane: BranchLane): string {
    const parts: string[] = []
    if (lane.counts.done) parts.push(t('workItem.chain.map.countDone', { count: lane.counts.done }))
    if (lane.counts.current)
      parts.push(t('workItem.chain.map.countCurrent', { count: lane.counts.current }))
    if (lane.counts.ahead)
      parts.push(t('workItem.chain.map.countAhead', { count: lane.counts.ahead }))
    return parts.join(' · ')
  }

  /** A lane's accessible name: its parent and title, and every count in words. */
  function laneLabel(lane: BranchLane): string {
    const name = lane.title ? `${laneName(lane)} ${lane.title}` : laneName(lane)
    return t('workItem.chain.map.lane', { name, total: lane.members.length, ...lane.counts })
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
      ? `${line} · ${actorName(member.claim_ref)}`
      : line
  }

  function position(index: number, total: number): string {
    return t('workItem.chain.map.position', { position: index + 1, total })
  }

  function summary(lanes: readonly BranchLane[], total: number): string {
    const totals = { done: 0, current: 0, ahead: 0 }
    for (const lane of lanes) {
      totals.done += lane.counts.done
      totals.current += lane.counts.current
      totals.ahead += lane.counts.ahead
    }
    return t('workItem.chain.map.summary', { lanes: lanes.length, total, ...totals })
  }

  /**
   * The readings of the colours this map draws, in the order a lane runs
   * through them. A legend names what is on the drawing, as the graph's does: a
   * key for a state no member is in reads as a claim that one is, and the
   * blocked one would say so in bold.
   */
  function legend(lanes: readonly BranchLane[]) {
    const drawn = new Set(lanes.flatMap((lane) => lane.groups))
    return LEGEND.filter((entry) => entry.groups.some((group) => drawn.has(group))).map(
      (entry) => ({ state: entry.state, label: t(entry.label) }),
    )
  }

  return { describe, laneCounts, laneLabel, laneName, legend, position, summary, t }
}
