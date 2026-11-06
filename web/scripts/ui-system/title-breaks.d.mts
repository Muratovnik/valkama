import type { UiSource } from './sources.mjs'

export declare const UNBROKEN_TITLES: ReadonlyMap<string, string>

export declare function scanTitleBreaks(
  sources: readonly UiSource[],
  register?: ReadonlyMap<string, string>,
): string[]
