import assert from 'node:assert/strict'

import { test } from 'vitest'

import { uiReady } from '@/shared/api/platformUiState.ts'
import {
  beginResource,
  createResource,
  rejectResource,
  resolveResource,
} from '@/shared/api/resourceState.ts'
import { resourceUiState } from '@/shared/api/resourceUiState.ts'
import type { Observed } from '@/shared/api/resourceUiState.ts'

const observed = (rows: string[]): Observed<string[]> => ({
  at: '2026-08-27T12:00:00Z',
  state: uiReady(rows),
})
const empty = (rows: string[]) => rows.length === 0

test('resource projection covers loading, empty, ready, refresh, degraded, and cold failures', () => {
  const initial = createResource<Observed<string[]>>()
  assert.equal(resourceUiState(initial, { empty }).status, 'loading')

  const zero = resolveResource(
    beginResource(initial, 'sessions:global'),
    1,
    'sessions:global',
    observed([]),
  )
  assert.equal(resourceUiState(zero, { empty }).status, 'empty')

  const ready = resolveResource(
    beginResource(zero, 'sessions:global'),
    2,
    'sessions:global',
    observed(['s1']),
  )
  assert.equal(resourceUiState(ready, { empty }).status, 'ready')

  const refreshing = beginResource(ready, 'sessions:global')
  const during = resourceUiState(refreshing, { empty })
  assert.equal(during.status, 'degraded')
  assert.deepEqual(during.status === 'degraded' ? during.payload : null, ['s1'])
  assert.equal(during.status === 'degraded' ? during.reason : 'unexpected', undefined)

  const failed = rejectResource(refreshing, 3, 'sessions:global', {
    code: 'stream_disconnected',
    status: null,
    retryable: true,
  })
  const degraded = resourceUiState(failed, { empty })
  assert.equal(degraded.status, 'degraded')
  assert.deepEqual(degraded.status === 'degraded' ? degraded.payload : null, ['s1'])
  assert.equal(
    degraded.status === 'degraded' ? degraded.reason : '',
    'platform.failures.streamDisconnected',
  )

  const cold = beginResource(createResource<Observed<string[]>>(), 'sessions:global')
  assert.equal(
    resourceUiState(
      rejectResource(cold, 1, 'sessions:global', {
        code: 'request_failed',
        status: 500,
        retryable: true,
      }),
    ).status,
    'error',
  )
})

test('only genuine nonretryable dependency and permission failures get distinct cold states', () => {
  const unavailable = beginResource(createResource<Observed<string[]>>(), 'sessions:global')
  assert.equal(
    resourceUiState(
      rejectResource(unavailable, 1, 'sessions:global', {
        code: 'dependency_unavailable',
        status: 503,
        retryable: false,
      }),
    ).status,
    'unavailable',
  )

  const denied = beginResource(createResource<Observed<string[]>>(), 'sessions:global')
  assert.equal(
    resourceUiState(
      rejectResource(denied, 1, 'sessions:global', {
        code: 'permission_denied',
        status: 403,
        retryable: false,
      }),
    ).status,
    'permission-denied',
  )
})
