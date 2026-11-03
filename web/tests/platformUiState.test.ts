import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
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
  const degraded = uiDegraded({ rows: [] }, '2026-08-13T12:00:00Z')
  assert.ok(degraded.status === 'degraded')
  assert.equal(degraded.stale, true)
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

test('validated payloads clone safely, bound each string and leave the size to the server', () => {
  assert.throws(() => uiReady('x'.repeat(MAX_UI_STATE_STRING_LENGTH + 1)), /string exceeds/)
  // The service stores a description this long, and the card holding it has to read.
  assert.doesNotThrow(() => uiReady({ description: 'x'.repeat(20_000) }))
  // So too a long discussion: forty comments as long as the service takes them.
  assert.doesNotThrow(() =>
    uiReady({ comments: Array.from({ length: 40 }, () => ({ body: 'x'.repeat(8000) })) }),
  )
  // The server bounds no answer's size, so neither does this: past the 1 MiB and
  // 16384 values this once held, a long card still reads.
  const large = {
    rows: Array.from({ length: 54 }, () => ({ value: 'x'.repeat(MAX_UI_STATE_STRING_LENGTH) })),
    events: Array.from({ length: 4000 }, (_, index) => ({ index, detail: 'a step' })),
  }
  assert.doesNotThrow(() => uiReady(large))
  const input = { nested: { value: 'safe' } }
  const output = uiReady(input)
  input.nested.value = 'mutated'
  assert.ok(output.status === 'ready')
  assert.deepEqual(output.payload, { nested: { value: 'safe' } })
})
