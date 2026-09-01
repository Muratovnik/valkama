import type { AgentSession, SessionEvent, SessionTone } from '@/shared/types/session.ts'

/** An active session silent this long is shown as quiet rather than working. */
export const QUIET_AFTER_SECONDS = 300
/** Silence beyond this point is no longer presented as live progress. */
export const STALE_AFTER_SECONDS = 1800

/** Advance quiet time locally between server events without inventing activity. */
export function sessionAt(session: AgentSession, nowMs: number): AgentSession {
  const lastSeen = Date.parse(session.last_seen)
  if (!Number.isFinite(lastSeen) || !Number.isFinite(nowMs)) return session
  const elapsed = Math.max(0, Math.floor((nowMs - lastSeen) / 1000))
  return { ...session, quiet_seconds: Math.max(session.quiet_seconds, elapsed) }
}

/**
 * What the row must communicate at a glance. A completed session is history;
 * among non-completed sessions, actionable attention wins over activity.
 */
export function sessionTone(session: AgentSession): SessionTone {
  if (session.status === 'ended') return 'ended'
  if (session.attention && !session.attention_seen) {
    return session.status === 'failed' ? 'failed' : 'attention'
  }
  if (session.status === 'failed') return 'failed'
  if (session.presence === 'stale' || session.quiet_seconds >= STALE_AFTER_SECONDS) {
    return 'stale'
  }
  return session.quiet_seconds >= QUIET_AFTER_SECONDS ? 'quiet' : 'working'
}

/**
 * Mutually exclusive inbox buckets. A terminal failure that still needs an
 * acknowledgement belongs to attention; a completed session is always history.
 * Active sessions without an actionable attention reason remain non-terminal
 * and are split into working or waiting rather than being counted twice.
 */
export type SessionGroup = 'attention' | 'working' | 'waiting' | 'recent'

export interface SessionGroups {
  attention: AgentSession[]
  recent: AgentSession[]
  waiting: AgentSession[]
  working: AgentSession[]
}

export type SessionFilter = 'all' | SessionGroup

export interface SessionGroupRows {
  key: SessionGroup
  sessions: AgentSession[]
}

export function sessionGroup(session: AgentSession): SessionGroup {
  if (session.status === 'ended') return 'recent'
  if (session.attention && !session.attention_seen) return 'attention'
  if (session.status === 'failed') return 'recent'
  if (
    session.status === 'active' &&
    ['attention', 'blocked', 'queued', 'waiting'].includes(session.attention)
  )
    return 'waiting'
  if (session.status === 'active' && sessionTone(session) === 'working') return 'working'
  // Quiet and stale active sessions are still non-terminal. They are waiting
  // for another event (or for the connection to recover), not recent history.
  return session.status === 'active' ? 'waiting' : 'recent'
}

/** Partition rows once so a session can never appear in two summary groups. */
export function groupSessions(sessions: AgentSession[]): SessionGroups {
  const groups: SessionGroups = { attention: [], working: [], waiting: [], recent: [] }
  for (const session of sessions) groups[sessionGroup(session)].push(session)
  for (const group of Object.values(groups) as AgentSession[][]) {
    group.sort((left, right) => {
      const byRecency = right.last_seen.localeCompare(left.last_seen)
      return byRecency === 0 ? left.id.localeCompare(right.id) : byRecency
    })
  }
  return groups
}

/** Keep a selected empty group present so filtering can never blank the ledger silently. */
export function filteredSessionGroups(
  groups: SessionGroups,
  filter: SessionFilter,
): SessionGroupRows[] {
  const entries = (Object.keys(groups) as SessionGroup[]).map((key) => ({
    key,
    sessions: groups[key],
  }))
  if (filter === 'all') return entries.filter((group) => group.sessions.length > 0)
  return entries.filter((group) => group.key === filter)
}

/** Which family a client string names, longest-standing prefix first. */
const CLIENT_FAMILY_PREFIXES = [
  { prefix: 'claude', family: 'claude' },
  { prefix: 'codex', family: 'codex' },
] as const

export function sessionIdentity(session: AgentSession): {
  adapterId: string
  family: 'codex' | 'claude' | 'other'
  reporter: string
} {
  const normalized = session.client.trim().toLocaleLowerCase()
  const fallback =
    CLIENT_FAMILY_PREFIXES.find((entry) => normalized.startsWith(entry.prefix))?.family ?? 'other'
  return {
    reporter: session.client,
    family: session.client_family ?? fallback,
    adapterId: session.adapter_id ?? 'unknown',
  }
}

const TONE_RANK: Record<SessionTone, number> = {
  failed: 0,
  attention: 1,
  working: 2,
  quiet: 3,
  stale: 4,
  ended: 5,
}

/**
 * Order rows by what needs the owner, then by recency. The server already
 * returns active-first; this adds the attention lift the monitor promises and
 * keeps the order stable when two rows share a tone.
 */
export function sortSessions(sessions: AgentSession[]): AgentSession[] {
  return [...sessions].sort((left, right) => {
    const byTone = TONE_RANK[sessionTone(left)] - TONE_RANK[sessionTone(right)]
    if (byTone !== 0) return byTone
    const byRecency = right.last_seen.localeCompare(left.last_seen)
    return byRecency === 0 ? left.id.localeCompare(right.id) : byRecency
  })
}

/** How long ago activity was observed, as an i18n key plus its count. */
export function lastActivityLabel(quietSeconds: number): { count: number; key: string } {
  if (quietSeconds < 60)
    return { key: 'monitor.lastActivitySeconds', count: Math.max(0, quietSeconds) }
  if (quietSeconds < 3600)
    return { key: 'monitor.lastActivityMinutes', count: Math.floor(quietSeconds / 60) }
  // Past a day, hours stop being a duration a person reads: "68h ago" has to be
  // divided before it means anything, and what it means is "three days".
  if (quietSeconds < 86_400)
    return { key: 'monitor.lastActivityHours', count: Math.floor(quietSeconds / 3600) }
  return { key: 'monitor.lastActivityDays', count: Math.floor(quietSeconds / 86_400) }
}

/** The last path segment is what identifies a working copy on sight. */
export function scopeName(cwd: string): string {
  const parts = cwd.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts.at(-1) ?? ''
}

/**
 * What a human calls this session. A UUID identifies, but it does not name:
 * the label wins, then the working copy, and only a nameless session without
 * a directory falls back to the head of its id. The full id stays available
 * in the expanded detail.
 */
export function displayName(session: AgentSession): string {
  return session.label || scopeName(session.cwd) || session.id.slice(0, 8)
}

/**
 * Not every reason may shout. A blocked or failed session needs the owner
 * now — its chip is filled. A finished or waiting one merely informs, and
 * waiting even clears itself on the next tool call — those chips stay quiet.
 */
export function attentionWeight(session: AgentSession): 'loud' | 'soft' {
  if (session.status === 'failed') return 'loud'
  return session.attention === 'blocked' ? 'loud' : 'soft'
}

/** One short line per session: what it is doing, or why it stopped. */
export function stepSummary(session: AgentSession): string {
  if (sessionTone(session) !== 'working') return ''
  return session.current_step
}

/** Feed rows the panel renders; analytics and stream share one chronology. */
export function feedLines(events: SessionEvent[]): Array<{
  at: string
  failed: boolean
  id: number
  klass: SessionEvent['klass']
  note: string
  title: string
}> {
  return events.map((event) => {
    const target = event.server ? `${event.server} · ${event.tool}` : event.tool
    let note = ''
    if (event.detail) {
      try {
        const parsed = JSON.parse(event.detail) as Record<string, unknown>
        const first = ['summary', 'reason', 'message', 'step', 'source'].find(
          (key) => typeof parsed[key] === 'string' && parsed[key],
        )
        note = first ? String(parsed[first]) : ''
      } catch {
        // Undecodable adapter payloads can contain terminal output. The
        // operational feed exposes only the structured, privacy-bounded
        // summaries from the event contract.
        note = ''
      }
    }
    return {
      id: event.id,
      klass: event.klass,
      title: target || event.kind,
      note,
      failed: event.status === 'error' || event.status === 'failed',
      at: event.at,
    }
  })
}

/** Counts the header shows: what is live, and what is waiting on the owner. */
export function monitorTotals(sessions: AgentSession[]): {
  attention: number
  live: number
  recent: number
  waiting: number
  working: number
} {
  const groups = groupSessions(sessions)
  let live = 0
  for (const session of sessions) {
    if (session.status === 'active') live += 1
  }
  return {
    live,
    working: groups.working.length,
    attention: groups.attention.length,
    waiting: groups.waiting.length,
    recent: groups.recent.length,
  }
}
