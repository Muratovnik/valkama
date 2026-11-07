import type { UiSource } from './sources.mjs'

export declare function scanScopeEscapes(sources: readonly UiSource[]): string[]

export declare function hasScopeEscape(file: string, source: string): boolean

export declare const scopeEscapeOwners: ReadonlySet<string>
