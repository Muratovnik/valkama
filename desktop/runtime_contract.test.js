'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  launcherStatusMatches,
  listenerLifecycleAction,
  listenerRuntimeReusable,
  parseRuntimeJson,
  runtimeMatches,
  staleReasons,
  validateLauncherBootstrap,
} = require('./runtime_contract')

const CURRENT = { interface_version: 'runtime', identity: 'a'.repeat(64) }
const DIRECTORY = 'C:\\Users\\operator\\AppData\\Local\\Valkama\\bin'
const PYTHON = 'C:\\Python313\\python.exe'
const SOURCE = 'D:\\src\\valkama\\valkama.py'
const COMMAND_HASH = 'c'.repeat(64)
const SHIM_HASH = 's'.repeat(64)

function bootstrap(overrides = {}) {
  return validateLauncherBootstrap({
    directory: DIRECTORY,
    manifest: {
      schema_version: 1,
      platform: 'nt',
      python: PYTHON,
      source_script: SOURCE,
      files: {
        'valkama.cmd': COMMAND_HASH,
        'valkama-launcher.py': SHIM_HASH,
      },
      ...overrides.manifest,
    },
    fileState: {
      'valkama.cmd': { exists: true, sha256: COMMAND_HASH },
      'valkama-launcher.py': { exists: true, sha256: SHIM_HASH },
      ...overrides.fileState,
    },
    pythonExists: overrides.pythonExists ?? true,
    sourceExists: overrides.sourceExists ?? true,
  })
}

test('a responsive listener with a different runtime identity is not reusable', () => {
  assert.equal(
    listenerRuntimeReusable(CURRENT, {
      reachable: true,
      payload: { ...CURRENT, identity: 'b'.repeat(64) },
    }),
    false,
  )
  assert.equal(listenerRuntimeReusable(CURRENT, { reachable: false, payload: CURRENT }), false)
  assert.equal(listenerRuntimeReusable(CURRENT, { reachable: true, payload: null }), false)
})

test('runtime matching requires the unnumbered public marker and a complete identity', () => {
  assert.equal(
    runtimeMatches(CURRENT, {
      interface_version: 'runtime',
      identity: 'a'.repeat(63),
    }),
    false,
  )
  assert.equal(
    runtimeMatches(CURRENT, {
      interface_version: 'wrong',
      identity: CURRENT.identity,
    }),
    false,
  )
  assert.equal(runtimeMatches(CURRENT, CURRENT), true)
})

test('malformed CLI output is never trusted as a runtime identity', () => {
  assert.equal(parseRuntimeJson('not json'), null)
  assert.equal(parseRuntimeJson('[]'), null)
  assert.deepEqual(parseRuntimeJson(JSON.stringify(CURRENT)), CURRENT)
})

test('the verified launcher manifest supplies the only desktop runtime invocation', () => {
  const reading = bootstrap()
  assert.equal(reading.ok, true)
  assert.deepEqual(reading.launcher, {
    directory: DIRECTORY,
    command: `${DIRECTORY}\\valkama.cmd`,
    shim: `${DIRECTORY}\\valkama-launcher.py`,
    manifest: `${DIRECTORY}\\valkama-launcher.json`,
    python: PYTHON,
    sourceScript: SOURCE,
  })
  assert.equal(
    launcherStatusMatches(reading.launcher, {
      schema_version: 1,
      state: 'installed',
      source_available: true,
      directory: DIRECTORY.toLowerCase(),
      command: `${DIRECTORY}\\valkama.cmd`,
      shim: `${DIRECTORY}\\valkama-launcher.py`,
      manifest: `${DIRECTORY}\\valkama-launcher.json`,
      python: PYTHON,
      source_script: SOURCE,
    }),
    true,
  )
})

test('a drifted shim or missing relocated source fails launcher bootstrap closed', () => {
  assert.equal(
    bootstrap({
      fileState: { 'valkama-launcher.py': { exists: true, sha256: 'changed' } },
    }).ok,
    false,
  )
  const missing = bootstrap({ sourceExists: false })
  assert.equal(missing.ok, false)
  assert.match(missing.detail, /reinstall the launcher/)
})

test('a stale managed listener is restarted but a foreign listener is refused untouched', () => {
  const stale = {
    reachable: true,
    payload: { ...CURRENT, identity: 'b'.repeat(64) },
  }
  assert.equal(listenerLifecycleAction(CURRENT, stale, { state: 'managed' }).action, 'restart')
  const foreign = listenerLifecycleAction(CURRENT, stale, {
    state: 'foreign',
    detail: 'foreign listener; left it untouched',
  })
  assert.equal(foreign.action, 'refuse')
  assert.match(foreign.reason, /left it untouched/)
})

test('a matching runtime is reusable only when the managed launcher owns its process', () => {
  const observed = { reachable: true, payload: CURRENT }
  assert.equal(listenerLifecycleAction(CURRENT, observed, { state: 'managed' }).action, 'reuse')
  assert.equal(listenerLifecycleAction(CURRENT, observed, { state: 'foreign' }).action, 'refuse')
  assert.equal(listenerLifecycleAction(CURRENT, observed, { state: 'free' }).action, 'refuse')
})

test('a stale listener is described by the half that drifted', () => {
  const expected = {
    interface_version: 'runtime',
    identity: 'a'.repeat(64),
    static: { sha256: 's1' },
    backend: { sha256: 'b1' },
  }
  const drifted = (part) => ({ ...expected, identity: 'b'.repeat(64), ...part })
  assert.deepEqual(staleReasons(expected, drifted({ static: { sha256: 's2' } })), ['front-end'])
  assert.deepEqual(staleReasons(expected, drifted({ backend: { sha256: 'b2' } })), ['server-code'])
  assert.deepEqual(
    staleReasons(expected, drifted({ static: { sha256: 's2' }, backend: { sha256: 'b2' } })),
    ['front-end', 'server-code'],
  )
  assert.deepEqual(staleReasons(expected, drifted({})), ['identity'])
  assert.deepEqual(staleReasons(expected, null), ['unreadable'])
  assert.deepEqual(staleReasons(expected, { interface_version: '' }), ['unreadable'])
})
