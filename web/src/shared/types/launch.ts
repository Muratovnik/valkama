/**
 * What the owner chooses when they start an attempt, and what comes back.
 *
 * These are request shapes and the envelopes the launch routes answer with.
 * What an attempt *is* once it exists is a validated read model in
 * `executionModel.ts`; this file is the side of the exchange the browser writes.
 *
 * Everything here used to be spelled in `card_id`, months after the domain that
 * had cards was deleted. Nothing broke, because nothing called it — which is
 * the only reason a wrong type can sit in a repository this long.
 */

import type { PlanningSpaceBrief } from '@/shared/api/planningModel.ts'

interface ScopeEntry {
  available: boolean
  detail: string
  label: string
  name: string
  path: string
  primary: boolean
}

/** Attached database files and the planning spaces each one holds. */
export interface ScopeListing {
  planning_spaces: Array<PlanningSpaceBrief & { scope: string }>
  scopes: ScopeEntry[]
}

type LaunchRole = 'executor' | 'orchestrator'
type RunEnvironment = 'workdir' | 'worktree' | 'wsl'
type ExpectedEffect = 'change_required' | 'no_change_acceptable' | 'read_only_finding'
type ReviewMode = '' | 'decision_review' | 'acceptance_review' | 'adversarial_review'

/** The packet the runner validates before anything is spawned. */
export interface LaunchPacket {
  client: string
  environment: RunEnvironment
  repo: string
  role: LaunchRole
  work_item: string
  branch?: string
  distro?: string
  effort?: string
  expected_effect?: ExpectedEffect
  force?: boolean
  interface_version?: string
  model?: string
  prompt?: string
  resume?: boolean
  review_mode?: ReviewMode
}

/** What a started launch reports back, including the attempt it was recorded as. */
export interface LaunchStarted {
  argv_shape: string[]
  client_session_id: string
  cwd: string
  execution_id: string
  launch_id: string
  packet: Omit<LaunchPacket, 'work_item'>
  reference: string
  resumed_from: string
  warnings: string[]
  worktree_preflight: Record<string, string | boolean>
}

/** A refusal, which is an answer: the packet was not startable and nothing ran. */
export interface LaunchRefused {
  error: string
  message: string
}

export interface LaunchStopped {
  reference: string
  stopped: boolean
  client_session_id?: string
  cwd?: string
  execution_id?: string
  exit_code?: number | null
  launch_id?: string
  tree?: boolean
}
