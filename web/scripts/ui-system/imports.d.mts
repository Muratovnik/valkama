import type { UiSource } from './sources.mjs'

export declare function scanImportDirection(sources: readonly UiSource[]): string[]

export declare function scanImportCycles(sources: readonly UiSource[]): string[]
