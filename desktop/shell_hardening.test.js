'use strict'

/**
 * The window and the packaged binary are hardened by configuration, and
 * configuration is what silently reverts. Neither of these is reachable from a
 * unit test of behavior: a wrong `webPreferences` value still opens a window,
 * and a missing fuse still ships an installer. So they are asserted as text.
 *
 * `@electron/fuses read --app <path>` is the check for a built artifact and
 * belongs to whoever runs the release; this file guards the source of truth
 * that build reads.
 */

const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const manifest = JSON.parse(readFileSync(path.join(__dirname, 'package.json'), 'utf8'))
const main = readFileSync(path.join(__dirname, 'main.js'), 'utf8')

test('the renderer stays isolated, unprivileged and sandboxed', () => {
  // The three that decide whether a compromised page can reach Node at all.
  for (const [option, value] of [
    ['contextIsolation', 'true'],
    ['nodeIntegration', 'false'],
    ['sandbox', 'true'],
  ]) {
    assert.match(
      main,
      new RegExp(`${option}:\\s*${value}\\b`),
      `webPreferences.${option} must stay ${value}`,
    )
  }
})

test('every packaged fuse keeps its hardened value', () => {
  // Electron 43 supports all of these on Windows, including embedded ASAR
  // integrity, which needs Electron 30 or newer there.
  const expected = {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    loadBrowserProcessSpecificV8Snapshot: false,
    grantFileProtocolExtraPrivileges: false,
  }
  assert.deepEqual(manifest.build.electronFuses, expected)
})

test('a fuse cannot be dropped from the build without failing here', () => {
  // deepEqual above already rejects an extra or missing key; this states the
  // count so a reviewer sees what the set is supposed to be.
  assert.equal(Object.keys(manifest.build.electronFuses).length, 8)
})
