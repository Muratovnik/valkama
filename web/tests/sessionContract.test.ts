import assert from 'node:assert/strict'

import { test } from 'vitest'

import { planningSpaceEntity } from '@/shared/api/platformPlanningRefs.ts'
import { uiReady } from '@/shared/api/platformUiState.ts'
import { validateSessionFeed, validateSessionsPayload } from '@/shared/api/sessionContract.ts'

const resourceRef = planningSpaceEntity({
  data_scope_id: '22222222-2222-4222-8222-222222222222',
  space_key: 'QA',
})

function session() {
  return {
    adapter_id: 'codex-sessions',
    attention: '',
    attention_seen: false,
    client: 'Codex',
    client_family: 'codex',
    current_step: 'Running tests',
    cwd: 'C:/workspace',
    ended_at: null,
    execution_id: '',
    id: 'session-1',
    label: 'Valkama',
    last_seen: '2026-08-24T12:05:00Z',
    presence: 'connected',
    quiet_seconds: 3,
    space_root: {
      canonical_root: 'C:/workspace',
      reason: '',
      resource_ref: resourceRef,
      status: 'mapped',
    },
    started_at: '2026-08-24T12:00:00Z',
    status: 'active',
    work_item: 'QA-308',
  }
}

test('sessions accept the canonical presence field without a duplicate stale flag', () => {
  const payload = { inbox: [], sessions: [session()] }
  const validated = validateSessionsPayload(payload)
  assert.deepEqual(validated, payload)
  assert.doesNotThrow(() => uiReady(validated))
  assert.throws(
    () => validateSessionsPayload({ inbox: [], sessions: [{ ...session(), stale: false }] }),
    /sessions\.sessions\[0\]\.stale: unknown field/,
  )
})

test('session presentation rejects registry filesystem metadata', () => {
  assert.throws(
    () =>
      validateSessionsPayload({
        inbox: [],
        sessions: [
          {
            ...session(),
            space_root: {
              ...session().space_root,
              registry_path: 'C:/Users/operator/AppData/Local/Valkama/projects.json',
            },
          },
        ],
      }),
    /sessions\.sessions\[0\]\.space_root\.registry_path: unknown field/,
  )
})

test('session roots require the canonical Planning resource identity', () => {
  assert.throws(
    () =>
      validateSessionsPayload({
        inbox: [],
        sessions: [{ ...session(), planning_space: 'QA' }],
      }),
    /planning_space: unknown field/,
  )
  assert.throws(
    () =>
      validateSessionsPayload({
        inbox: [],
        sessions: [
          {
            ...session(),
            space_root: { ...session().space_root, resource_ref: null, space: 'QA' },
          },
        ],
      }),
    /sessions\.sessions\[0\]\.space_root\.space: unknown field/,
  )
  assert.throws(
    () =>
      validateSessionsPayload({
        inbox: [],
        sessions: [
          {
            ...session(),
            space_root: {
              ...session().space_root,
              resource_ref: { kind: 'planning-space', resource_id: 'opaque' },
            },
          },
        ],
      }),
    /expected canonical Planning resource id/,
  )
  assert.throws(
    () =>
      validateSessionsPayload({
        inbox: [],
        sessions: [
          {
            ...session(),
            space_root: { ...session().space_root, resource_ref: null },
          },
        ],
      }),
    /mapped root requires canonical planning-space resource_ref/,
  )
})

test('session snapshots and feeds reject malformed rows before state commits', () => {
  assert.throws(
    () => validateSessionsPayload({ inbox: [], sessions: [{ ...session(), status: 'busy' }] }),
    /sessions\.sessions\[0\]\.status: Invalid option/,
  )
  assert.throws(
    () =>
      validateSessionFeed({
        session: 'session-1',
        events: [
          {
            at: 'not-a-date',
            detail: '',
            id: 1,
            kind: 'tool',
            klass: 'stream',
            server: '',
            status: 'ok',
            tool: 'test',
          },
        ],
      }),
    /session_feed\.events\[0\]\.at: expected timestamp/,
  )
})
