/** Agent sessions: their tone, their events and the feed they arrive in. */

import type { SpaceRootResolution } from '@/shared/types/reference.ts'

export interface AgentSession {
  /** Non-empty while this session is waiting for the owner. */
  attention: string
  attention_seen: boolean
  /** Reporter-provided name, preserved for provenance. */
  client: string
  /** Newest stream event: what the session is doing right now. */
  current_step: string
  cwd: string
  ended_at: string | null
  id: string
  label: string
  last_seen: string
  quiet_seconds: number
  started_at: string
  status: 'active' | 'ended' | 'failed'
  work_item: string | null
  /** Adapter that supplied this observation, independent from the opener. */
  adapter_id?: string
  /** Stable presentation family; never used as lifecycle state. */
  client_family?: 'codex' | 'claude' | 'other'
  /** The attempt this session carries, when a launch or a person linked it. */
  execution_id?: string
  /** Connectivity is independent from the terminal task status. */
  presence?: 'connected' | 'stale' | 'terminal'
  scope?: string
  /** Registry result and effective launch directory. */
  space_root?: SpaceRootResolution
}

export type SessionTone = 'working' | 'quiet' | 'attention' | 'stale' | 'failed' | 'ended'

/** One recorded client action. `analytics` is durable, `stream` is purgeable. */
export interface SessionEvent {
  at: string
  detail: string
  id: number
  kind: string
  klass: 'analytics' | 'stream'
  server: string
  status: string
  tool: string
}

export interface SessionsPayload {
  inbox: AgentSession[]
  sessions: AgentSession[]
}

export interface SessionFeed {
  events: SessionEvent[]
  session: string
}
