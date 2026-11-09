import type { UiSource } from './sources.mjs'

/** The one file that asks whether a pointer can hover and keeps an action out of sight until then. */
export declare const REVEAL_OWNER: string

/** Every copy of the reveal rule outside its owner, and what the owner hides where nothing hovers. */
export declare function scanRevealCopies(sources: readonly UiSource[]): string[]
