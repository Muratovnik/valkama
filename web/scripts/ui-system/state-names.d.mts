import type { UiSource } from './sources.mjs'

export declare const STATE_NAME_READS: ReadonlyMap<string, string>

export declare function scanStateNames(
  sources: readonly UiSource[],
  register?: ReadonlyMap<string, string>,
): string[]
