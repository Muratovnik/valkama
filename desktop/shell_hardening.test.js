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
  // Electron 45 supports all of these on Windows, including embedded ASAR
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

test('every module the packaged app loads is packaged', () => {
  // electron-builder ships only `build.files`. A module required but not
  // listed works from source and fails in the installed app, which is the
  // one place nobody runs the tests.
  const packed = new Set(manifest.build.files)
  for (const file of manifest.build.files.filter((name) => name.endsWith('.js'))) {
    const source = readFileSync(path.join(__dirname, file), 'utf8')
    for (const [, local] of source.matchAll(/require\('\.\/([\w-]+)'\)/g)) {
      assert.ok(packed.has(`${local}.js`), `${file} requires ./${local}, which is not packaged`)
    }
  }
  for (const [, file] of main.matchAll(/path\.join\(__dirname, '([^'.][^']*)'\)/g)) {
    assert.ok(packed.has(file), `main.js reads ${file}, which is not packaged`)
  }
})

test('nothing outside the package is read when packaged', () => {
  // Packaged, __dirname is inside app.asar: a path that climbs out of it names
  // nothing. The window icon pointed at ../windows/valkama.ico for that reason
  // and silently fell back to the executable's own icon.
  const climbing = main.split('\n').filter((line) => /__dirname,\s*'\.\.'/.test(line))
  assert.ok(climbing.length > 0, 'the source run still names the repository icon')
  for (const line of climbing) {
    assert.match(line, /app\.isPackaged \? undefined :/, `reachable when packaged: ${line.trim()}`)
  }
})
