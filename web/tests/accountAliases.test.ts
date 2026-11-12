/**
 * The owner's names for accounts, as the settings keep them: what a stored value may be, how a
 * name is written and taken away, and that a name never changes another account's.
 */
import assert from 'node:assert/strict'

import { describe, test } from 'vitest'

import {
  aliasOf,
  MAX_ACCOUNT_ALIAS_LENGTH,
  readAccountAliases,
  withAlias,
} from '@/shared/lib/accountAliases.ts'
import { DEFAULT_SETTINGS, mergeSettings } from '@/shared/lib/settings.ts'

describe('the stored names', () => {
  test('a build before this one stored none, and none is the default', () => {
    assert.deepEqual(DEFAULT_SETTINGS.accountAliases, {})
    assert.deepEqual(mergeSettings({ editor: 'cursor' }).accountAliases, {})
  })

  test('mergeSettings keeps a name on an id and drops what is no name or no id', () => {
    const merged = mergeSettings({
      accountAliases: {
        'f0f0f0f0': '  Main\n account ',
        'org-2': '',
        'org-3': '   ',
        'org-4': 7,
        '': 'No id',
        'a\u0000b': 'Nul in the id',
      },
    })
    assert.deepEqual(merged.accountAliases, { f0f0f0f0: 'Main account' })
    for (const raw of [null, 'text', ['Main'], 3])
      assert.deepEqual(readAccountAliases(raw), {}, String(raw))
  })

  test('a name is held to its bound', () => {
    const merged = readAccountAliases({ f0f0f0f0: 'x'.repeat(MAX_ACCOUNT_ALIAS_LENGTH + 20) })
    assert.equal(merged.f0f0f0f0?.length, MAX_ACCOUNT_ALIAS_LENGTH)
  })

  test('a key that names the prototype is an id like any other, not a way to change it', () => {
    const merged = readAccountAliases(JSON.parse('{"__proto__": "Odd", "org-1": "One"}'))
    assert.equal(Object.getPrototypeOf(merged), Object.prototype)
    assert.equal(aliasOf(merged, 'org-1'), 'One')
    assert.equal(aliasOf(merged, 'toString'), null)
  })
})

describe('naming an account', () => {
  test('sets its name, changes no other, and an empty name takes it away', () => {
    const named = withAlias({ 'org-1': 'One' }, 'f0f0f0f0', ' Main ')
    assert.deepEqual(named, { 'org-1': 'One', 'f0f0f0f0': 'Main' })
    assert.equal(aliasOf(named, 'f0f0f0f0'), 'Main')
    const renamed = withAlias(named, 'f0f0f0f0', 'Work')
    assert.deepEqual(renamed, { 'org-1': 'One', 'f0f0f0f0': 'Work' })
    const cleared = withAlias(renamed, 'f0f0f0f0', '  ')
    assert.deepEqual(cleared, { 'org-1': 'One' })
    assert.equal(aliasOf(cleared, 'f0f0f0f0'), null)
  })
})
