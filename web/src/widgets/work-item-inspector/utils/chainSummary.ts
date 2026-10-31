/**
 * What the card says about a chain, derived from the one answer the server sent.
 *
 * Pure on purpose: the grouping is the claim the section makes — this many in
 * progress, this many ready — and a claim is easier to check as a function of
 * its input than through a mounted component.
 */

import type { ChainMember } from '@/shared/api/planningChainApi.ts'
import { CHAIN_GROUPS, chainGroup } from '@/shared/api/planningChainGroups.ts'
import type { ChainGroup } from '@/shared/api/planningChainGroups.ts'

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

/**
 * The space's own name for a group, when every member in it is in one state:
 * a workflow that calls its active state "Development" should read that here.
 * A group spanning several states keeps the category's name.
 */
export function sharedStateName(members: readonly ChainMember[]): string | null {
  const names = new Set(members.map((member) => member.state.name))
  return names.size === 1 ? [...names][0] : null
}

/**
 * The state a row in this group has to name itself. A group whose members all
 * share one state already says it in its heading, so its rows say nothing; a
 * group that mixes states heads itself with the category, so every row names
 * its own.
 */
export function rowStateName(group: readonly ChainMember[], member: ChainMember): string | null {
  return sharedStateName(group) === null ? member.state.name : null
}

/** The day a series point names, read as a calendar date wherever the reader is. */
export function seriesDate(day: string): Date {
  return new Date(`${day}T00:00:00Z`)
}
