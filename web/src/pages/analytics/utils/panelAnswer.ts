/**
 * What the panels of the Analytics page share about the one answer each shows: the figures its
 * tiles state, and the part of the panel a press to narrow the view came from, where a refusal of
 * that press is said.
 */
import { spentOf } from '@/pages/analytics/utils/usageFigures.ts'
import type { Spent } from '@/pages/analytics/utils/usageFigures.ts'

import type { Usage } from '@/shared/api/analyticsApi.ts'

/** Where in a panel a press asked to narrow the view. */
export type ReportPart = 'bars' | 'days' | 'table'

/** A press that did not narrow the view: the part it was pressed in, and why, in words. */
export interface Refusal {
  part: ReportPart
  words: string
}

/** The period's total, and what the period before spent and when; null when that was not read. */
export function tileFigures(usage: Usage): {
  before: { from: string; spent: Spent; to: string } | null
  total: Spent
} {
  const { comparison } = usage
  return {
    total: spentOf(usage.total),
    before: comparison ? { ...comparison.period, spent: spentOf(comparison.total) } : null,
  }
}

/** The words of a refusal, in the part of the panel it came from; nothing in any other. */
export const refusedIn = (refused: Refusal | null, part: ReportPart) =>
  refused?.part === part ? refused.words : ''
