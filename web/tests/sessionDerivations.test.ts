import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  attentionWeight,
  displayName,
  feedLines,
  filteredSessionGroups,
  groupSessions,
  lastActivityLabel,
  monitorTotals,
  QUIET_AFTER_SECONDS,
  scopeName,
  sessionAt,
  sessionGroup,
  sessionIdentity,
  sessionTone,
  sortSessions,
  STALE_AFTER_SECONDS,
  stepSummary,
} from '@/entities/session/sessionDerivations.ts'

import type { AgentSession, SessionEvent } from '@/shared/types/session.ts'

function session(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: 'session-1',
    client: 'claude',
    cwd: 'C:/Users/operator/Desktop/projects/example-project',
    label: 'fix the parser',
    card_id: null,
    status: 'active',
    attention: '',
    attention_seen: false,
    started_at: '2026-08-06T10:00:00Z',
    last_seen: '2026-08-06T10:05:00Z',
    ended_at: null,
    quiet_seconds: 3,
    current_step: 'Bash',
    presence: 'connected',
    ...overrides,
  }
}

test('tone answers what the row must communicate, with attention winning', () => {
  assert.equal(sessionTone(session()), 'working')
  assert.equal(sessionTone(session({ quiet_seconds: QUIET_AFTER_SECONDS })), 'quiet')
  assert.equal(sessionTone(session({ quiet_seconds: STALE_AFTER_SECONDS })), 'stale')
  assert.equal(sessionTone(session({ status: 'ended' })), 'ended')
  assert.equal(
    sessionTone(session({ attention: 'waiting' })),
    'attention',
    'a busy-looking row still surfaces when it is waiting',
  )
  assert.equal(sessionTone(session({ attention: 'waiting', attention_seen: true })), 'working')
  assert.equal(sessionTone(session({ status: 'failed', attention: 'failed' })), 'failed')
})

test('session identity is independent from lifecycle tone and opener destination', () => {
  const identity = sessionIdentity(
    session({
      client: 'Codex Desktop',
      client_family: 'codex',
      adapter_id: 'codex-sessions',
      attention: 'waiting',
    }),
  )
  assert.deepEqual(identity, {
    reporter: 'Codex Desktop',
    family: 'codex',
    adapterId: 'codex-sessions',
  })
  assert.equal(sessionTone(session({ attention: 'waiting' })), 'attention')
})

test('a selected zero-count filter remains visible and produces a filtered-empty group', () => {
  const groups = groupSessions([session({ status: 'ended' })])
  assert.deepEqual(filteredSessionGroups(groups, 'attention'), [{ key: 'attention', sessions: [] }])
  assert.deepEqual(
    filteredSessionGroups(groups, 'all').map((group) => group.key),
    ['recent'],
  )
})

test('quiet time advances locally and never moves backwards', () => {
  const lastSeen = '2026-08-06T10:00:00Z'
  assert.equal(
    sessionAt(
      session({ last_seen: lastSeen, quiet_seconds: 3 }),
      Date.parse('2026-08-06T10:30:00Z'),
    ).quiet_seconds,
    1800,
  )
  assert.equal(
    sessionAt(
      session({ last_seen: lastSeen, quiet_seconds: 2000 }),
      Date.parse('2026-08-06T10:05:00Z'),
    ).quiet_seconds,
    2000,
  )
})

test('order puts failures and waiting sessions above working ones, then newest first', () => {
  const rows = [
    session({ id: 'working-old', last_seen: '2026-08-06T10:01:00Z' }),
    session({ id: 'ended', status: 'ended', attention: 'ended', attention_seen: true }),
    session({ id: 'waiting', attention: 'waiting' }),
    session({ id: 'working-new', last_seen: '2026-08-06T10:09:00Z' }),
    session({ id: 'failed', status: 'failed', attention: 'failed' }),
  ]
  assert.deepEqual(
    sortSessions(rows).map((item) => item.id),
    ['failed', 'waiting', 'working-new', 'working-old', 'ended'],
  )
})

test('sorting is stable and does not mutate its input', () => {
  const rows = [session({ id: 'b' }), session({ id: 'a' })]
  const sorted = sortSessions(rows)
  assert.deepEqual(
    sorted.map((item) => item.id),
    ['a', 'b'],
  )
  assert.deepEqual(
    rows.map((item) => item.id),
    ['b', 'a'],
  )
})

test('last activity picks a human unit without the opaque quiet label', () => {
  assert.deepEqual(lastActivityLabel(0), { key: 'monitor.lastActivitySeconds', count: 0 })
  assert.deepEqual(lastActivityLabel(59), { key: 'monitor.lastActivitySeconds', count: 59 })
  assert.deepEqual(lastActivityLabel(60), { key: 'monitor.lastActivityMinutes', count: 1 })
  assert.deepEqual(lastActivityLabel(3599), { key: 'monitor.lastActivityMinutes', count: 59 })
  assert.deepEqual(lastActivityLabel(7200), { key: 'monitor.lastActivityHours', count: 2 })
  assert.deepEqual(lastActivityLabel(86_399), { key: 'monitor.lastActivityHours', count: 23 })
  // 68 hours is a number a reader has to divide before it means anything.
  assert.deepEqual(lastActivityLabel(244_800), { key: 'monitor.lastActivityDays', count: 2 })
  assert.deepEqual(lastActivityLabel(-5), { key: 'monitor.lastActivitySeconds', count: 0 })
})

test('the working copy is named by its last path segment, on either separator', () => {
  assert.equal(scopeName('C:/a/b/example-project'), 'example-project')
  assert.equal(scopeName('C:\\a\\b\\alpha'), 'alpha')
  assert.equal(scopeName('C:/a/b/beta/'), 'beta')
  assert.equal(scopeName(''), '')
})

test('a session is named for a human: label, then directory, then a short id', () => {
  assert.equal(displayName(session()), 'fix the parser')
  assert.equal(displayName(session({ label: '' })), 'example-project')
  assert.equal(
    displayName(session({ label: '', cwd: '', id: 'f89d66c7-f023-4169-8d1a' })),
    'f89d66c7',
    'a UUID identifies but does not name; only its head survives on the row',
  )
})

test('only blocked and failed sessions may shout; ended and waiting stay quiet', () => {
  assert.equal(attentionWeight(session({ attention: 'blocked' })), 'loud')
  assert.equal(attentionWeight(session({ status: 'failed', attention: 'failed' })), 'loud')
  assert.equal(attentionWeight(session({ status: 'ended', attention: 'ended' })), 'soft')
  assert.equal(attentionWeight(session({ attention: 'waiting' })), 'soft')
})

test('a finished session reports no current step', () => {
  assert.equal(stepSummary(session()), 'Bash')
  assert.equal(stepSummary(session({ quiet_seconds: QUIET_AFTER_SECONDS })), '')
  assert.equal(stepSummary(session({ quiet_seconds: STALE_AFTER_SECONDS })), '')
  assert.equal(stepSummary(session({ attention: 'blocked' })), '')
  assert.equal(stepSummary(session({ status: 'ended', current_step: 'Bash' })), '')
})

test('feed lines name the MCP server, decode detail, and mark failures', () => {
  const events: SessionEvent[] = [
    {
      id: 3,
      klass: 'analytics',
      kind: 'tool_end',
      tool: 'claim_card',
      server: 'kanban',
      status: 'ok',
      detail: '',
      at: '2026-08-06T10:05:00Z',
    },
    {
      id: 2,
      klass: 'stream',
      kind: 'tool_start',
      tool: 'Bash',
      server: '',
      status: '',
      detail: '{"summary":"List files"}',
      at: '2026-08-06T10:04:00Z',
    },
    {
      id: 1,
      klass: 'analytics',
      kind: 'tool_end',
      tool: 'Bash',
      server: '',
      status: 'error',
      detail: 'not json at all',
      at: '2026-08-06T10:03:00Z',
    },
  ]
  const lines = feedLines(events)
  assert.equal(lines[0].title, 'kanban · claim_card')
  assert.equal(lines[0].failed, false)
  assert.equal(lines[1].title, 'Bash')
  assert.equal(lines[1].note, 'List files')
  assert.equal(lines[2].failed, true)
  assert.equal(lines[2].note, '', 'undecodable terminal output is not echoed into the UI')
})

test('a nameless event falls back to its kind', () => {
  const [line] = feedLines([
    {
      id: 1,
      klass: 'analytics',
      kind: 'session_start',
      tool: '',
      server: '',
      status: '',
      detail: '{"source":"startup"}',
      at: '2026-08-06T10:00:00Z',
    },
  ])
  assert.equal(line.title, 'session_start')
  assert.equal(line.note, 'startup')
})

test('header totals count live work and only unacknowledged attention', () => {
  const totals = monitorTotals([
    session({ id: '1' }),
    session({ id: '2', quiet_seconds: 900 }),
    session({ id: '3', attention: 'waiting' }),
    session({ id: '4', status: 'failed', attention: 'failed' }),
    session({ id: '5', status: 'ended', attention: 'ended', attention_seen: true }),
  ])
  assert.equal(totals.live, 3, 'ended and failed sessions are not live')
  assert.equal(totals.working, 1)
  assert.equal(totals.attention, 2)
})

test('session groups are mutually exclusive and keep terminal failures out of live work', () => {
  const groups = groupSessions([
    session({ id: 'working' }),
    session({ id: 'waiting', quiet_seconds: QUIET_AFTER_SECONDS }),
    session({ id: 'failed', status: 'failed', attention: 'failed' }),
    session({
      id: 'failed-2',
      status: 'failed',
      attention: 'failed',
      last_seen: '2026-08-06T10:06:00Z',
    }),
    session({ id: 'ended', status: 'ended', attention: 'ended', attention_seen: true }),
  ])
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(groups).map(([key, rows]) => [key, rows.map((row) => row.id)]),
    ),
    {
      attention: ['failed-2', 'failed'],
      working: ['working'],
      waiting: ['waiting'],
      recent: ['ended'],
    },
  )
  assert.equal(
    new Set(
      Object.values(groups)
        .flat()
        .map((row) => row.id),
    ).size,
    5,
  )
})

test('an ended session can never remain in an unactionable attention bucket', () => {
  const ended = session({
    id: 'ended-unseen',
    status: 'ended',
    attention: 'ended',
    attention_seen: false,
  })
  assert.equal(sessionTone(ended), 'ended')
  assert.equal(sessionGroup(ended), 'recent')
  const totals = monitorTotals([ended])
  assert.equal(totals.attention, 0)
  assert.equal(totals.recent, 1)
})
