/**
 * What the card says about a chain, derived from the one answer the server sent.
 *
 * Pure on purpose: the grouping is the claim the section makes — this many in
 * progress, this many ready — and a claim is easier to check as a function of
 * its input than through a mounted component.
 */

import type { ChainMember } from '@/shared/api/planningChainApi.ts'
import { CHAIN_GROUPS, chainGroup, groupStateNames } from '@/shared/api/planningChainGroups.ts'
import type { ChainGroup } from '@/shared/api/planningChainGroups.ts'
import type { NamedState } from '@/shared/lib/stateNames.ts'

/** How a state is named on screen: `useStateName`, or a plain stand-in where no screen is. */
type StateName = (state: NamedState) => string

export type ChainGroups = Record<ChainGroup, ChainMember[]>

function referenceNumber(reference: string): number {
  return Number(reference.slice(reference.lastIndexOf('-') + 1))
}

function byReference(left: ChainMember, right: ChainMember): number {
  return referenceNumber(left.reference) - referenceNumber(right.reference)
}

/**
 * Open work in the order of work, so the item that will be taken next leads
 * its group; finished work most recently closed first, because that is the part
 * of the past a reader asks about.
 */
function byRank(left: ChainMember, right: ChainMember): number {
  return left.rank - right.rank || byReference(left, right)
}

function byClosing(left: ChainMember, right: ChainMember): number {
  return (right.closed_at ?? '').localeCompare(left.closed_at ?? '') || byReference(left, right)
}

function memberOrder(group: ChainGroup) {
  return group === 'done' ? byClosing : byRank
}

export function groupMembers(members: readonly ChainMember[]): ChainGroups {
  const groups = Object.fromEntries(
    CHAIN_GROUPS.map((group) => [group, []]),
  ) as unknown as ChainGroups
  for (const member of members) groups[chainGroup(member)].push(member)
  for (const group of CHAIN_GROUPS) groups[group].sort(memberOrder(group))
  return groups
}

/** What one group is called across a chain section, and whether that word is a state. */
export interface GroupLabel {
  /** The text is the one state every member of the group is in. */
  state: boolean
  text: string
}

export type GroupLabels = Record<ChainGroup, GroupLabel>

/**
 * The word for each group, decided once for the whole chain: the state every
 * member shares, as the board's column names it, or the group's own word where
 * the members span several states. The map's legend, the totals line and the
 * member headings all read it, so one section never calls one group two
 * things — the legend said «В работе» while the heading under it said «Dev».
 * It is read off the whole chain rather than a narrowed list, so choosing a
 * lane does not rename a group either.
 */
export function groupLabels(
  groups: ChainGroups,
  word: (group: ChainGroup) => string,
  stateName: StateName,
): GroupLabels {
  const names = groupStateNames(groups, stateName)
  return Object.fromEntries(
    CHAIN_GROUPS.map((group) => {
      const name = names[group]
      return [group, { text: name ?? word(group), state: name !== null }]
    }),
  ) as GroupLabels
}

/**
 * The state a row has to name itself. A heading that names the one state its
 * group is in already says it, so the row says nothing; a heading that names
 * the group's own word leaves every row to name its own.
 */
export function rowStateName(
  label: GroupLabel,
  member: ChainMember,
  stateName: StateName,
): string | null {
  return label.state ? null : stateName(member.state)
}

/** The day a series point names, read as a calendar date wherever the reader is. */
export function seriesDate(day: string): Date {
  return new Date(`${day}T00:00:00Z`)
}

/** A chain's days as the card writes them — «9 нояб.», "Nov 9" — on the UTC calendar they are in. */
export function dayFormat(locale: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' })
}
