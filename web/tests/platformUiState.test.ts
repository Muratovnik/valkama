import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  MAX_UI_STATE_PAYLOAD_BYTES,
  MAX_UI_STATE_STRING_LENGTH,
  uiDegraded,
  uiEmpty,
  uiError,
  uiLoading,
  uiPermissionDenied,
  uiReady,
  validatePlatformUiState,
} from '@/shared/api/platformUiState.ts'

test('common UI state grammar validates all supported states', () => {
  assert.equal(uiLoading().status, 'loading')
  assert.equal(uiReady({ rows: [] }).status, 'ready')
  assert.equal(uiEmpty('No rows').status, 'empty')
  assert.equal(uiPermissionDenied('Grant required').status, 'permission-denied')
  assert.equal(uiDegraded({ rows: [] }, '2026-08-13T12:00:00Z').stale, true)
})
test('degraded is only valid with explicit stale payload and timestamp', () => {
  assert.throws(
    () =>
      validatePlatformUiState({
        interface_version: 'valkama-ui-state',
        status: 'degraded',
        payload: [],
      }),
    /unknown field|stale/,
  )
  assert.throws(
    () =>
      validatePlatformUiState({
        interface_version: 'valkama-ui-state',
        status: 'degraded',
        stale: false,
        payload: [],
        observed_at: '2026-08-13T12:00:00Z',
      }),
    /stale=true/,
  )
  assert.throws(
    () =>
      validatePlatformUiState({
        interface_version: 'valkama-ui-state',
        status: 'degraded',
        stale: true,
        payload: [],
        observed_at: 'not-a-date',
      }),
    /ISO timestamp/,
  )
})

test('states reject additive fields, provider HTML/JS, and non-JSON payload values', () => {
  assert.throws(
    () =>
      validatePlatformUiState({
        interface_version: 'valkama-ui-state',
        status: 'loading',
        extra: true,
      }),
    /unknown field/,
  )
  assert.throws(() => uiReady({ html: '<div></div>' }), /HTML|JS|path|payload/)
  assert.throws(() => uiReady({ callback: () => true }), /JSON values/)
})

test('reasons reject executable/path text while bounded domain payload text stays inert', () => {
  for (const unsafe of [
    '<div>unsafe</div>',
    'javascript:alert(1)',
    'data:text/plain,secret',

    // An attack string the validator must reject, not a path this code opens.
    // eslint-disable-next-line sonarjs/publicly-writable-directories -- see above
    '/tmp/provider-body',
    'C:\\secret\\memory.txt',
  ]) {
    assert.throws(() => uiError(unsafe), /HTML|JS|path/)
  }
  assert.throws(() => uiEmpty('x'.repeat(241)), /bounded reason/)
  assert.doesNotThrow(() => uiError('Run /context all before acceptance'))
  assert.doesNotThrow(() => uiReady({ title: 'Run /context all before acceptance' }))
  assert.doesNotThrow(() =>
    uiReady({ title: 'Treat <literal> and /api/platform as inert core text' }),
  )
})

test('validated payloads clone safely and enforce deterministic UTF-8 bounds', () => {
  assert.equal(MAX_UI_STATE_PAYLOAD_BYTES, 256 * 1024)
  assert.throws(() => uiReady('x'.repeat(MAX_UI_STATE_STRING_LENGTH + 1)), /string exceeds/)
  const oversized = {
    rows: Array.from({ length: 33 }, () => ({ value: 'x'.repeat(MAX_UI_STATE_STRING_LENGTH) })),
  }
  assert.throws(() => uiReady(oversized), /deterministic UTF-8|bytes/)
  const input = { nested: { value: 'safe' } }
  const output = uiReady(input)
  input.nested.value = 'mutated'
  assert.deepEqual(output.payload, { nested: { value: 'safe' } })
})
