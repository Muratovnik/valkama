/**
 * What the panels of the Analytics page share about the one answer each shows: the figures its
 * tiles state, an hour of agent time's among them, and the part of the panel a press to narrow the view came from, where a refusal of
 * that press is said.
 */
import { figureOf, spentOf, unplacedBefore } from '@/pages/analytics/utils/usageFigures.ts'
import type { Spent } from '@/pages/analytics/utils/usageFigures.ts'

import type { Usage } from '@/shared/api/analyticsApi.ts'

/** Where in a panel a press asked to narrow the view. */
export type ReportPart = 'bars' | 'days' | 'table'

/** A press that did not narrow the view: the part it was pressed in, and why, in words. */
export interface Refusal {
  part: ReportPart
  words: string
}

/**
 * The period's total, and what the period before spent and when, with what a read narrowed to
 * accounts left out of it on no account (`unplacedBefore`); null when that was not read.
 */
export function tileFigures(usage: Usage): {
  before: { from: string; spent: Spent; to: string; unplaced?: Spent } | null
  total: Spent
} {
  const { comparison } = usage
  const unplaced = unplacedBefore(usage)
  return {
    total: spentOf(usage.total),
    before: comparison
      ? {
          ...comparison.period,
          spent: spentOf(comparison.total),
          ...(unplaced ? { unplaced } : {}),
        }
      : null,
  }
}

/** A figure per hour of agent time: the period's, and the period before's where it has one. */
export interface PerHour {
  now: number
  was: number | null
}

const HOUR = 3600

/**
 * The tokens or the cost of an hour of agent time: the measure's figure over the hours of agent
 * time it took, in the period and in the period before. None where the period worked no time or
 * has no figure in the measure — no price, no token counted — since there is nothing to divide;
 * the period before gives none where it was not read, worked no time or has no figure there.
 */
export function perHour(
  measure: 'cost' | 'tokens',
  total: Spent,
  before: Spent | null,
): PerHour | null {
  const rate = (spent: Spent) => {
    const figure = figureOf(measure, spent)
    return spent.seconds > 0 && figure !== null ? figure / (spent.seconds / HOUR) : null
  }
  const now = rate(total)
  return now === null ? null : { now, was: before ? rate(before) : null }
}

/** The words of a refusal, in the part of the panel it came from; nothing in any other. */
export const refusedIn = (refused: Refusal | null, part: ReportPart) =>
  refused?.part === part ? refused.words : ''
