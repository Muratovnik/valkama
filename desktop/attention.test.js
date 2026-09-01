'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { newAttention, MAX_TOASTS_PER_PUSH } = require('./attention')

function item(overrides = {}) {
  return {
    id: 'session-1',
    client: 'claude',
    label: 'fix the parser',
    cwd: 'C:/projects/example-workspace',
    attention: 'blocked',
    attention_seen: false,
    ...overrides,
  }
}

test('a new reason raises one toast naming the client and the work', () => {
  const { toasts, keys } = newAttention(new Set(), [item()])
  assert.equal(toasts.length, 1)
  assert.equal(toasts[0].title, 'claude · blocked')
  assert.equal(toasts[0].body, 'fix the parser')
  assert.deepEqual([...keys], ['session-1 blocked'])
})

test('the same standing reason does not notify twice', () => {
  const first = newAttention(new Set(), [item()])
  const second = newAttention(first.keys, [item()])
  assert.deepEqual(second.toasts, [])
  assert.deepEqual([...second.keys], ['session-1 blocked'])
})

test('a different reason on the same session notifies again', () => {
  const first = newAttention(new Set(), [item()])
  const second = newAttention(first.keys, [item({ attention: 'failed' })])
  assert.equal(second.toasts.length, 1)
  assert.equal(second.toasts[0].title, 'claude · failed')
})

test('a session that left the inbox and rings again is not silenced forever', () => {
  const first = newAttention(new Set(), [item()])
  const cleared = newAttention(first.keys, [])
  assert.deepEqual([...cleared.keys], [], 'keys track only the current inbox')
  const again = newAttention(cleared.keys, [item()])
  assert.equal(again.toasts.length, 1)
})

test('acknowledged and malformed items are ignored', () => {
  const { toasts } = newAttention(new Set(), [
    item({ attention_seen: true }),
    item({ id: '', attention: 'blocked' }),
    item({ id: 'x', attention: '   ' }),
    null,
  ])
  assert.deepEqual(toasts, [])
})

test('a burst is capped and the remainder summarized', () => {
  const burst = Array.from({ length: MAX_TOASTS_PER_PUSH + 4 }, (_unused, index) =>
    item({ id: `session-${index}`, attention: 'ended' }),
  )
  const { toasts } = newAttention(new Set(), burst)
  assert.equal(toasts.length, MAX_TOASTS_PER_PUSH + 1)
  assert.equal(toasts[toasts.length - 1].key, 'summary')
  assert.match(toasts[toasts.length - 1].body, /^4 more session/)
})

test('a label falls back to the directory and then the session id', () => {
  const [byCwd] = newAttention(new Set(), [item({ label: '' })]).toasts
  assert.equal(byCwd.body, 'C:/projects/example-workspace')
  const [byId] = newAttention(new Set(), [item({ label: '', cwd: '' })]).toasts
  assert.equal(byId.body, 'session-1')
})

test('control characters cannot deform a toast', () => {
  const [toast] = newAttention(new Set(), [
    item({ label: 'line\u0000one\nline two' }),
  ]).toasts
  assert.equal(toast.body, 'line one line two')
})
