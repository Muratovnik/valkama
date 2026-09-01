import assert from 'node:assert/strict'

import { test } from 'vitest'

import { actorName, actorSession, splitActor } from '@/shared/lib/actor.ts'

test('a session baked into an actor name is split into name and session', () => {
  assert.deepEqual(splitActor('claude-fable (session 1baa03d7)'), {
    name: 'claude-fable',
    session: '1baa03d7',
  })
  assert.deepEqual(splitActor('codex [session f89d66c7-f023-4169-8d1a-2e69d4b1af68]'), {
    name: 'codex',
    session: 'f89d66c7-f023-4169-8d1a-2e69d4b1af68',
  })
  assert.deepEqual(splitActor('агент (сессия 77aa88bb)'), {
    name: 'агент',
    session: '77aa88bb',
  })
})

test('plain names and odd shapes pass through untouched', () => {
  assert.deepEqual(splitActor('user'), { name: 'user', session: '' })
  assert.deepEqual(splitActor(''), { name: '', session: '' })
  // A parenthesis that is not a session marker is part of the name.
  assert.equal(actorName('review-bot (night shift)'), 'review-bot (night shift)')
  // Too short to be an id prefix; leaving it alone beats a false split.
  assert.equal(actorSession('agent (session ab)'), '')
  // A session with no name keeps the original string: the executor column
  // must never end up empty while somebody holds the work.
  assert.equal(actorName('(session 1baa03d7)'), '(session 1baa03d7)')
  assert.equal(actorSession('(session 1baa03d7)'), '1baa03d7')
})
