import type { UiSource } from './sources.mjs'

export declare function scanSemanticStateOwnership(
  sources: readonly UiSource[],
  copied?: ReadonlyMap<string, string>,
): string[]
