/**
 * The owner's names for accounts: what a stored value or the server's answer may be, and how a
 * name is said, by the rule the server holds a write to as well.
 */
import assert from 'node:assert/strict'

import { describe, test } from 'vitest'

import {
  aliasOf,
  cleanAlias,
  MAX_ACCOUNT_ALIAS_LENGTH,
  readAccountAliases,
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

describe('saying a name', () => {
  test('is one line with its spaces collapsed, and nothing but spaces is no name', () => {
    assert.equal(cleanAlias('  Main\n\t account '), 'Main account')
    assert.equal(cleanAlias('   '), '')
  })

  test('cuts at the bound by characters, as the server counts them, never inside one', () => {
    // Each of these is one character and two UTF-16 units.
    const said = cleanAlias('\u{1F600}'.repeat(MAX_ACCOUNT_ALIAS_LENGTH + 1))
    assert.equal(Array.from(said).length, MAX_ACCOUNT_ALIAS_LENGTH)
    assert.equal(said, '\u{1F600}'.repeat(MAX_ACCOUNT_ALIAS_LENGTH))
  })
})
