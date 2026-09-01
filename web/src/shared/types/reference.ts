/** What a ref points at, how firmly, and what a search across them answers. */

import type { EntityRef } from '@/shared/api/platformEntityRef.ts'

export type RefKind = 'session' | 'commit' | 'memory' | 'url'

export type SpaceRootStatus = 'mapped' | 'missing' | 'ambiguous' | 'malformed' | 'unavailable'

export type PlanningSpaceEntityRef = Extract<EntityRef, { resource_id: string }> & {
  kind: 'planning-space'
}

/**
 * Where a planning space's work actually lives on disk, and how that was known.
 *
 * Every failure keeps its own reason: a missing mapping, two competing ones and
 * an unreadable registry are three different problems, and collapsing them into
 * "not found" is what made this impossible to diagnose from the page.
 */
export interface SpaceRootResolution {
  canonical_root: string | null
  reason: string
  resource_ref: PlanningSpaceEntityRef | null
  status: SpaceRootStatus
  effective_cwd?: string
  fallback?: boolean
  session_cwd?: string
  source?: string
  validated?: boolean
}

/** Where a surface asks the shell to navigate: one item, in one space. */
export interface WorkItemNavigationTarget {
  planning_space: string
  reference: string
  scope?: string
}

/** A session may navigate only through the exact Planning identity it carries. */
export interface SessionWorkItemNavigationTarget {
  reference: string
  resource_ref: PlanningSpaceEntityRef
  scope?: string
}

interface DocumentHit {
  line: number
  path: string
  root: string
  text: string
}

export interface SearchPayload {
  documents: DocumentHit[]
  query: string
  work_items: Array<{
    labels: string[]
    reference: string
    title: string
    comment_hit?: string
    scope?: string
    summary_hit?: boolean
  }>
}

export interface ResolvedRef {
  detail: string
  kind: RefKind
  resolved: boolean
  value: string
  at?: string
  client?: string
  client_family?: 'codex' | 'claude' | 'other'
  cwd?: string
  repository?: string
  /** Present when a session ref matched an observed session. */
  session?: string
  session_cwd?: string
  space_root?: SpaceRootResolution
  work_item?: string | null
}
