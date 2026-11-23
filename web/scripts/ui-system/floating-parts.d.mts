import type { UiSource } from './sources.mjs'

/** The Reka parts whose tag class lands inside their wrapper, with the attribute some need for it. */
export declare const FLOATING_PARTS: ReadonlyMap<string, { readonly position?: string }>

/** Every scoped rule that styles a class written on a floating part, which it never reaches. */
export declare function scanFloatingPartScopes(sources: readonly UiSource[]): string[]
