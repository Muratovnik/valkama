import { describe, expect, it } from 'vitest'

import { sessionSemanticState } from '@/shared/api/sessionSemanticState.ts'
import type { AgentSession } from '@/shared/types/session.ts'

function session(status: AgentSession['status']): AgentSession {
  return {
    attention: 'unseen attention',
    attention_seen: false,
    client: 'Codex',
    current_step: 'Finished',
    cwd: 'C:/workspace',
    ended_at: status === 'active' ? null : '2026-08-27T12:05:00Z',
    id: `session-${status}`,
    label: status,
    last_seen: '2026-08-27T12:05:00Z',
    quiet_seconds: 0,
    started_at: '2026-08-27T11:00:00Z',
    status,
    work_item: null,
  }
}

describe('session semantic state precedence', () => {
  it('keeps failure strongest and classifies ended before unseen attention', () => {
    expect(sessionSemanticState(session('failed'))).toBe('failed')
    expect(sessionSemanticState(session('ended'))).toBe('ended')
    expect(sessionSemanticState(session('active'))).toBe('attention')
  })
})
