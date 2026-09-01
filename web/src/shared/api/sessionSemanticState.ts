/** One session state vocabulary consumed by both the ledger and inspector. */

import type { AgentSession } from '@/shared/types/session.ts'

export type SessionSemanticState = 'attention' | 'failed' | 'working' | 'waiting' | 'ended'

export function sessionSemanticState(session: AgentSession): SessionSemanticState {
  if (session.status === 'failed') return 'failed'
  if (session.status === 'ended') return 'ended'
  if (session.attention && !session.attention_seen) return 'attention'
  if (
    session.presence === 'stale' ||
    session.quiet_seconds >= 300 ||
    session.current_step.length === 0
  )
    return 'waiting'
  return 'working'
}
