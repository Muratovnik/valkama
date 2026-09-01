'use strict'

const path = require('node:path')

const RUNTIME_INTERFACE_VERSION = 'runtime'
const LAUNCHER_SCHEMA_VERSION = 1
const LAUNCHER_COMMAND_NAME = 'valkama.cmd'
const LAUNCHER_MANIFEST_NAME = 'valkama-launcher.json'
const LAUNCHER_SHIM_NAME = 'valkama-launcher.py'

function runtimeMatches(expected, actual) {
  return Boolean(
    expected &&
    actual &&
    expected.interface_version === RUNTIME_INTERFACE_VERSION &&
    actual.interface_version === RUNTIME_INTERFACE_VERSION &&
    typeof expected.identity === 'string' &&
    expected.identity.length === 64 &&
    expected.identity === actual.identity,
  )
}

function listenerRuntimeReusable(expected, observed) {
  return Boolean(
    observed && observed.reachable === true && runtimeMatches(expected, observed.payload),
  )
}

function parseJsonObject(text) {
  try {
    const payload = JSON.parse(String(text || ''))
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null
  } catch {
    return null
  }
}

function parseRuntimeJson(text) {
  return parseJsonObject(text)
}

function sameManagedPath(left, right) {
  return Boolean(
    typeof left === 'string' &&
    typeof right === 'string' &&
    path.win32.normalize(left).toLowerCase() === path.win32.normalize(right).toLowerCase(),
  )
}

function invalidLauncher(detail) {
  return { ok: false, detail, launcher: null }
}

function validateLauncherBootstrap({ directory, manifest, fileState, pythonExists, sourceExists }) {
  if (!path.win32.isAbsolute(directory || '')) {
    return invalidLauncher('LOCALAPPDATA does not resolve to an absolute launcher directory')
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return invalidLauncher('the managed launcher manifest is missing or malformed')
  }
  if (manifest.schema_version !== LAUNCHER_SCHEMA_VERSION || manifest.platform !== 'nt') {
    return invalidLauncher('the managed launcher manifest has an unsupported schema or platform')
  }
  if (!manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)) {
    return invalidLauncher('the managed launcher manifest has no file hashes')
  }
  for (const name of [LAUNCHER_COMMAND_NAME, LAUNCHER_SHIM_NAME]) {
    const expected = manifest.files[name]
    const actual = fileState && fileState[name]
    if (typeof expected !== 'string' || !actual || actual.exists !== true) {
      return invalidLauncher(`managed launcher file is missing: ${name}`)
    }
    if (
      typeof actual.sha256 !== 'string' ||
      actual.sha256.toLowerCase() !== expected.toLowerCase()
    ) {
      return invalidLauncher(`managed launcher file was modified: ${name}`)
    }
  }
  if (
    typeof manifest.python !== 'string' ||
    !path.win32.isAbsolute(manifest.python) ||
    pythonExists !== true
  ) {
    return invalidLauncher('the Python interpreter recorded by the managed launcher is missing')
  }
  if (
    typeof manifest.source_script !== 'string' ||
    !path.win32.isAbsolute(manifest.source_script) ||
    sourceExists !== true
  ) {
    return invalidLauncher(
      'the source recorded by the managed launcher is missing; reinstall the launcher from the current checkout',
    )
  }
  return {
    ok: true,
    detail: '',
    launcher: {
      directory: path.win32.normalize(directory),
      command: path.win32.join(directory, LAUNCHER_COMMAND_NAME),
      shim: path.win32.join(directory, LAUNCHER_SHIM_NAME),
      manifest: path.win32.join(directory, LAUNCHER_MANIFEST_NAME),
      python: path.win32.normalize(manifest.python),
      sourceScript: path.win32.normalize(manifest.source_script),
    },
  }
}

function launcherStatusMatches(launcher, status) {
  return Boolean(
    launcher &&
    status &&
    status.schema_version === LAUNCHER_SCHEMA_VERSION &&
    status.state === 'installed' &&
    status.source_available === true &&
    sameManagedPath(status.directory, launcher.directory) &&
    sameManagedPath(status.command, launcher.command) &&
    sameManagedPath(status.shim, launcher.shim) &&
    sameManagedPath(status.manifest, launcher.manifest) &&
    sameManagedPath(status.python, launcher.python) &&
    sameManagedPath(status.source_script, launcher.sourceScript),
  )
}

function listenerLifecycleAction(expected, observed, ownership) {
  if (!ownership || !['free', 'managed', 'foreign'].includes(ownership.state)) {
    return {
      action: 'refuse',
      reason: 'Valkama could not verify who owns the configured port; it was left untouched.',
    }
  }
  if (ownership.state === 'foreign') {
    return {
      action: 'refuse',
      reason:
        ownership.detail ||
        'The configured port is held by a process not started by the managed Valkama launcher; it was left untouched.',
    }
  }
  if (ownership.state === 'free') {
    if (observed && observed.reachable) {
      return {
        action: 'refuse',
        reason:
          'A listener answered on the configured port but managed ownership could not be verified.',
      }
    }
    return { action: 'start', reason: 'the managed listener is not running' }
  }
  if (listenerRuntimeReusable(expected, observed)) {
    return {
      action: 'reuse',
      reason: 'the managed listener has the current runtime identity',
    }
  }
  return {
    action: 'restart',
    reason: 'the managed listener has a stale or unreadable runtime identity',
  }
}

module.exports = {
  LAUNCHER_COMMAND_NAME,
  LAUNCHER_MANIFEST_NAME,
  LAUNCHER_SCHEMA_VERSION,
  LAUNCHER_SHIM_NAME,
  RUNTIME_INTERFACE_VERSION,
  launcherStatusMatches,
  listenerLifecycleAction,
  listenerRuntimeReusable,
  parseJsonObject,
  parseRuntimeJson,
  runtimeMatches,
  validateLauncherBootstrap,
}
