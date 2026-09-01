import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  availableOpenerCapabilities,
  browserOpenerCapabilities,
  DEFAULT_SETTINGS,
  mergeSettings,
  NOTIFY_EVENTS,
  openerClientOf,
  openerFor,
  openerKindsFor,
  reconcileOpener,
  validateCustomCommand,
} from '@/shared/lib/settings.ts'

test('defaults notify about finished work but keep the per-turn waiting quiet', () => {
  assert.equal(DEFAULT_SETTINGS.notifyEnabled, true)
  assert.equal(DEFAULT_SETTINGS.notify.itemCompleted, true)
  assert.equal(DEFAULT_SETTINGS.notify.sessionEnded, true)
  assert.equal(DEFAULT_SETTINGS.notify.sessionFailed, true)
  assert.equal(DEFAULT_SETTINGS.notify.agentWaiting, false)
  assert.equal(DEFAULT_SETTINGS.openers.claude.kind, 'vscode')
  assert.equal(DEFAULT_SETTINGS.openers.codex.kind, 'terminal')
  assert.ok(browserOpenerCapabilities().some((item) => item.kind === 'codex-app'))
})

test('merge completes any stored fragment into a valid structure', () => {
  const merged = mergeSettings({
    notifyEnabled: false,
    notify: { itemCompleted: false, nonsense: true },
    openers: { claude: { kind: 'custom', command: 'wt -d {cwd}' }, codex: 7 },
  })
  assert.equal(merged.notifyEnabled, false)
  assert.equal(merged.notify.itemCompleted, false)
  for (const event of NOTIFY_EVENTS) assert.equal(typeof merged.notify[event], 'boolean')
  assert.deepEqual(merged.openers.claude, { kind: 'custom', command: 'wt -d {cwd}' })
  assert.deepEqual(merged.openers.codex, DEFAULT_SETTINGS.openers.codex)
  assert.deepEqual(mergeSettings(null), DEFAULT_SETTINGS)
  assert.deepEqual(mergeSettings('garbage'), DEFAULT_SETTINGS)
})

test('an opener association is picked by client family, not exact string', () => {
  assert.equal(openerClientOf('claude'), 'claude')
  assert.equal(openerClientOf('Claude Code'), 'claude')
  assert.equal(openerClientOf('codex'), 'codex')
  assert.equal(openerClientOf('gemini'), 'other')
  const settings = mergeSettings({ openers: { other: { kind: 'custom', command: 'x {session}' } } })
  assert.equal(openerFor('gemini', settings).kind, 'custom')
  assert.equal(openerFor('codex', settings).kind, 'terminal')
})

test('browser-only opener discovery exposes only actions the browser can perform', () => {
  const settings = mergeSettings({ openers: { codex: { kind: 'cursor', command: '' } } })
  assert.equal(settings.openers.codex.kind, 'cursor')
  assert.deepEqual(
    availableOpenerCapabilities('codex', browserOpenerCapabilities()).map(({ kind }) => kind),
    ['vscode', 'custom'],
  )
  assert.equal(
    reconcileOpener('codex', settings.openers.codex, browserOpenerCapabilities()).kind,
    'vscode',
  )
})

test('the desktop Codex app is distinct and obsolete opener ids are not aliases', () => {
  const selected = mergeSettings({ openers: { codex: { kind: 'codex-app', command: '' } } })
  assert.equal(selected.openers.codex.kind, 'codex-app')
  const obsolete = mergeSettings({ openers: { claude: { kind: 'codex', command: '' } } })
  assert.equal(obsolete.openers.claude.kind, 'vscode')
})

test('client opener menus are the exact compatibility and availability intersection', () => {
  const catalog = [
    { kind: 'vscode' as const, availability: 'available' as const },
    { kind: 'codex-app' as const, availability: 'available' as const },
    { kind: 'terminal' as const, availability: 'unavailable' as const },
    { kind: 'cursor' as const, availability: 'unavailable' as const },
    { kind: 'custom' as const, availability: 'available' as const },
  ]
  assert.ok(openerKindsFor('codex').includes('codex-app'))
  assert.equal(openerKindsFor('claude').includes('codex-app'), false)
  assert.equal(openerKindsFor('other').includes('codex-app'), false)
  assert.equal(openerKindsFor('other').includes('terminal'), false)
  assert.deepEqual(
    availableOpenerCapabilities('claude', catalog).map(({ kind }) => kind),
    ['vscode', 'custom'],
  )
  assert.deepEqual(
    availableOpenerCapabilities('codex', catalog).map(({ kind }) => kind),
    ['vscode', 'codex-app', 'custom'],
  )
  assert.equal(
    mergeSettings({ openers: { claude: { kind: 'codex-app', command: '' } } }).openers.claude.kind,
    'vscode',
  )
})

test('custom commands use one bounded inline validation contract', () => {
  assert.equal(validateCustomCommand(''), 'required')
  assert.equal(validateCustomCommand('   '), 'required')
  assert.equal(validateCustomCommand('x'.repeat(401)), 'too-long')
  assert.equal(validateCustomCommand('codex resume {session}'), null)
})
