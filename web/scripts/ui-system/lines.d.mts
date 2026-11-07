import type { UiSource } from './sources.mjs'

/** A ledger: how many of the counted things each file is allowed, keyed by its source path. */
type Budget = ReadonlyMap<string, number>

export declare const LINE_BUDGET: Map<string, number>

export declare const CONTROL_SIZE_BUDGET: Map<string, number>

export declare function staleEntries(
  sources: readonly UiSource[],
  budget: Budget,
  ledger: string,
): string[]

export declare function scanBorderBudget(sources: readonly UiSource[], budget?: Budget): string[]

export declare function scanHiddenRules(sources: readonly UiSource[]): string[]

export declare function scanControlSizes(sources: readonly UiSource[], budget?: Budget): string[]
