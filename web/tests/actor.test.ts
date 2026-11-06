import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  actorName,
  actorSession,
  holderName,
  sessionHolder,
  splitActor,
} from '@/shared/lib/actor.ts'

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

test('a session signed with no brackets splits the same way', () => {
  assert.deepEqual(splitActor('claude-code session 0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e'), {
    name: 'claude-code',
    session: '0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e',
  })
  assert.equal(
    holderName('claude-code session 0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e'),
    'claude-code · 0f1e2d3c-4b5a',
  )
  // A name that only ends in the word, or a word with no id after it, is a name.
  assert.equal(actorName('night-session'), 'night-session')
  assert.equal(actorName('my session'), 'my session')
  assert.equal(actorSession('my session ab'), '')
  // The word alone keeps the original string, as a bracketed one does.
  assert.equal(actorName('session 1baa03d7'), 'session 1baa03d7')
  assert.equal(actorSession('session 1baa03d7'), '1baa03d7')
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

test('a holder prints its name and the start of its session, or its name alone', () => {
  // The label the server writes for a claim whose client proved its session.
  assert.equal(
    holderName('codex (session 019a3c2e-5b7d-7c11-9e0f-2f4b6d8a1c3e)'),
    'codex · 019a3c2e-5b7d',
  )
  assert.equal(
    holderName('claude agent a7 (session 5937332f-1c2d-4e5f-8a9b-0c1d2e3f4a5b)'),
    'claude agent a7 · 5937332f-1c2d',
  )
  // Two Codex sessions started a second apart share their first group.
  assert.notEqual(
    holderName('codex (session 019a3c2e-5b7d-7c11-9e0f-2f4b6d8a1c3e)'),
    holderName('codex (session 019a3c2e-5f65-7d02-8a1b-3c5e7f9a2b4d)'),
  )
  // A holder signed by hand the old way reads the same way.
  assert.equal(holderName('claude-fable (session 1baa03d7)'), 'claude-fable · 1baa03d7')
  assert.equal(holderName('user'), 'user')
  assert.equal(holderName('codex:executor'), 'codex:executor')
  // No name before the session: the whole text, never an empty holder.
  assert.equal(holderName('(session 1baa03d7)'), '(session 1baa03d7)')
})

test('a session that holds nothing is labelled as its claim would be, and prints as its holder', () => {
  const session = '019a3c2e-5b7d-7c11-9e0f-2f4b6d8a1c3e'
  // The label the server writes for a claim of that session, which the card already prints.
  assert.equal(sessionHolder('codex', session, null), `codex (session ${session})`)
  assert.equal(holderName(sessionHolder('codex', session, null)), 'codex · 019a3c2e-5b7d')
  assert.equal(
    holderName(sessionHolder('claude', session, 'a7f3')),
    'claude agent a7f3 · 019a3c2e-5b7d',
  )
  // A client recorded under its handshake's name holds under its family's.
  assert.equal(sessionHolder('claude-code', session, null), `claude (session ${session})`)
  assert.equal(sessionHolder('Codex-MCP-Client', session, null), `codex (session ${session})`)
  assert.equal(sessionHolder('gemini', session, null), `gemini (session ${session})`)
  // With no client, the session itself, never an empty name.
  assert.equal(sessionHolder(null, session, null), session)
  assert.equal(sessionHolder('  ', session, 'a7f3'), session)
})
