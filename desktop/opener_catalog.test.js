'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { discoverSupportedOpeners, resolveSupportedOpener } = require('./opener_catalog')

test('desktop discovery returns only allowlisted sanitized capabilities', () => {
  const found = new Map([
    ['wt.exe', 'C:\\WindowsApps\\wt.exe'],
    ['cursor.exe', 'C:\\Apps\\Cursor\\cursor.exe'],
  ])
  const capabilities = discoverSupportedOpeners({
    protocolAvailability: () => 'available',
    findExecutable: (name) => found.get(name) || '',
  })
  assert.deepEqual(capabilities, [
    { kind: 'vscode', availability: 'available' },
    { kind: 'codex-app', availability: 'available' },
    { kind: 'terminal', availability: 'available' },
    { kind: 'cursor', availability: 'available' },
    { kind: 'custom', availability: 'available' },
  ])
  assert.ok(capabilities.every((item) => !Object.hasOwn(item, 'path')))
})

test('launch-time resolution keeps executable paths inside the main process', () => {
  const findExecutable = (name) => name === 'wt.exe' ? 'C:\\WindowsApps\\wt.exe' : ''
  assert.deepEqual(resolveSupportedOpener('terminal', { findExecutable }), {
    availability: 'available',
    executable: 'C:\\WindowsApps\\wt.exe',
  })
  assert.deepEqual(resolveSupportedOpener('cursor', { findExecutable }), {
    availability: 'unavailable',
    executable: '',
  })
  assert.deepEqual(resolveSupportedOpener('codex-app', { protocolAvailability: () => 'available' }), {
    availability: 'available',
    executable: '',
  })
})
