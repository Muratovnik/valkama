import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  alwaysChoicesFor,
  DEFAULT_SETTINGS,
  mergeSettings,
  placesFor,
  sessionFamilyOf,
  validateCustomCommand,
} from '@/shared/lib/settings.ts'

const rule = { always: '', command: '' }

/** What a build before this one stored, read now. */
function stored(claude: unknown, codex: unknown, other?: unknown) {
  return mergeSettings({ openers: { claude, codex, other } }).sessions
}

test('by default a session opens where it was last open, else in VS Code, and files in VS Code', () => {
  assert.deepEqual(DEFAULT_SETTINGS.sessions.claude, { fallback: 'vscode', ...rule })
  assert.deepEqual(DEFAULT_SETTINGS.sessions.codex, { fallback: 'vscode', ...rule })
  assert.equal(DEFAULT_SETTINGS.editor, 'vscode')
})

test('each opener a build before this one stored becomes the place it named', () => {
  // Two of them opened the session's folder; the folder's editor is now the fallback.
  assert.deepEqual(stored({ kind: 'vscode', command: '' }, null).claude, {
    fallback: 'vscode',
    ...rule,
  })
  assert.deepEqual(stored({ kind: 'cursor', command: '' }, null).claude, {
    fallback: 'cursor',
    ...rule,
  })
  assert.deepEqual(stored({ kind: 'terminal', command: '' }, null).claude, {
    fallback: 'terminal',
    ...rule,
  })
  assert.deepEqual(stored(null, { kind: 'codex-app', command: '' }).codex, {
    fallback: 'codex-app',
    ...rule,
  })
  // The owner's command is an explicit replacement, for every session of the family.
  assert.deepEqual(stored(null, null, { kind: 'custom', command: 'wt -d {cwd}' }).other, {
    fallback: 'vscode',
    always: 'custom',
    command: 'wt -d {cwd}',
  })
  // A command typed and then left for another opener is not lost either.
  assert.equal(
    stored({ kind: 'terminal', command: 'x {session}' }, null).claude.command,
    'x {session}',
  )
})

test("Codex's old default is not read as a choice, and a command saved with it stays", () => {
  // Every earlier build saved `terminal` for Codex whether or not anyone chose it.
  assert.deepEqual(stored(null, { kind: 'terminal', command: '' }).codex, {
    fallback: 'vscode',
    ...rule,
  })
  assert.equal(
    stored(null, { kind: 'terminal', command: 'x {session}' }).codex.command,
    'x {session}',
  )
})

test('an old opener another client cannot hold, or no build ever had, falls back to VS Code', () => {
  const sessions = mergeSettings({
    openers: { claude: { kind: 'codex-app', command: '' }, codex: { kind: 'codex', command: '' } },
  }).sessions
  assert.equal(sessions.claude.fallback, 'vscode')
  assert.equal(sessions.codex.fallback, 'vscode')
})

test('the current shape wins over the old one and is kept as written', () => {
  const merged = mergeSettings({
    editor: 'windsurf',
    sessions: { claude: { fallback: 'claude-desktop', always: 'terminal', command: '' } },
    openers: { claude: { kind: 'cursor', command: '' } },
  })
  assert.deepEqual(merged.sessions.claude, {
    fallback: 'claude-desktop',
    always: 'terminal',
    command: '',
  })
  assert.equal(merged.editor, 'windsurf')
})

test('settings stored with the notify fields of older builds read cleanly and lose them', () => {
  const merged = mergeSettings({
    notifyEnabled: false,
    notify: { itemCompleted: false, agentWaiting: true },
    openers: { claude: { kind: 'terminal', command: '' } },
  })
  assert.deepEqual(Object.keys(merged).toSorted(), [
    'editor',
    'executionTab',
    'kindColors',
    'sessions',
  ])
  assert.equal(merged.sessions.claude.fallback, 'terminal')
})

test('anything else stored becomes the defaults rather than a broken structure', () => {
  assert.deepEqual(mergeSettings(null), DEFAULT_SETTINGS)
  assert.deepEqual(mergeSettings('garbage'), DEFAULT_SETTINGS)
  assert.deepEqual(mergeSettings({ openers: 7, editor: 'notepad' }), DEFAULT_SETTINGS)
  const odd = mergeSettings({
    sessions: { claude: { fallback: 'codex-app', always: 'claude', command: 3 } },
  })
  assert.deepEqual(odd.sessions.claude, { fallback: 'vscode', ...rule })
})

test('a family is offered only the places that can hold its sessions', () => {
  assert.ok(placesFor('claude').includes('claude-desktop'))
  assert.equal(placesFor('claude').includes('codex-app'), false)
  assert.ok(placesFor('codex').includes('codex-app'))
  assert.equal(placesFor('codex').includes('claude-desktop'), false)
  assert.deepEqual(alwaysChoicesFor('other'), ['', 'custom'])
})

test('a session family is picked by prefix, not exact string', () => {
  assert.equal(sessionFamilyOf('Claude Code'), 'claude')
  assert.equal(sessionFamilyOf('codex'), 'codex')
  assert.equal(sessionFamilyOf('gemini'), 'other')
})

test('custom commands use one bounded inline validation contract', () => {
  assert.equal(validateCustomCommand(''), 'required')
  assert.equal(validateCustomCommand('   '), 'required')
  assert.equal(validateCustomCommand('x'.repeat(401)), 'too-long')
  assert.equal(validateCustomCommand('codex resume {session}'), null)
})

test('the card offers Execution only once the owner turned it on', () => {
  assert.equal(DEFAULT_SETTINGS.executionTab, false)
  // What every build before this setting stored, in either of its shapes.
  assert.equal(mergeSettings({ editor: 'cursor', sessions: {} }).executionTab, false)
  assert.equal(mergeSettings({ openers: { claude: { kind: 'cursor' } } }).executionTab, false)
  assert.equal(mergeSettings({ editor: 'cursor', executionTab: true }).executionTab, true)
  // Only a stored `true` turns it on: a value this build did not write says nothing.
  for (const odd of ['true', 1, {}, null]) {
    assert.equal(mergeSettings({ executionTab: odd }).executionTab, false)
  }
})
