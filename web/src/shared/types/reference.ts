/** What a ref points at, how firmly, and what a search across them answers. */

import type { EntityRef } from '@/shared/api/platformEntityRef.ts'

export type RefKind = 'session' | 'commit' | 'memory' | 'url'

type SpaceRootStatus = 'mapped' | 'missing' | 'ambiguous' | 'malformed' | 'unavailable'

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
interface SpaceRootResolution {
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
  /** The folder a click opens this session in, which `cwd` need not be: see `session_folders`. */
  session_folder?: string
  space_root?: SpaceRootResolution
  /** A session's state: `active`, `ended`, `failed`; `missing` or `ambiguous` when unresolved. */
  status?: string
  work_item?: string | null
}
