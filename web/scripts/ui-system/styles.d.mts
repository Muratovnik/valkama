import type { UiSource } from './sources.mjs'

export declare const FILL_BUDGET: Map<string, number>

export declare function scanMeaningFills(
  sources: readonly UiSource[],
  budget?: ReadonlyMap<string, number>,
): string[]

export declare function scanUiSources(sources: readonly UiSource[]): string[]

export declare function scanTypeStyles(sources: readonly UiSource[]): string[]

export declare function scanTokenHygiene(sources: readonly UiSource[]): string[]
