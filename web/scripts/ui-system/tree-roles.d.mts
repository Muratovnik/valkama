import type { UiSource } from './sources.mjs'

/** The one file that writes a tree's role and the attributes that place its rows. */
export declare const TREE_ROLES_OWNER: string

/** Every tree role or row placement written outside its owner. */
export declare function scanTreeRoles(sources: readonly UiSource[]): string[]
