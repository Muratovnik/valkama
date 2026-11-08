import type { UiSource } from './sources.mjs'

export declare const NATIVE_TITLES: ReadonlyMap<string, string>

export declare function scanNativeTitles(
  sources: readonly UiSource[],
  register?: ReadonlyMap<string, string>,
): string[]
