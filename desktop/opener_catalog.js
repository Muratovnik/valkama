'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const SUPPORTED_OPENERS = Object.freeze(['vscode', 'codex-app', 'terminal', 'cursor', 'custom'])
const EXECUTABLES = Object.freeze({ terminal: 'wt.exe', cursor: 'cursor.exe' })

function existingFile(value, exists = fs.existsSync) {
  return typeof value === 'string' && value.length > 0 && exists(value) ? value : ''
}

function output(command, args, run = execFileSync) {
  try {
    return String(run(command, args, { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })).trim()
  } catch {
    return ''
  }
}

/** Resolve one allowlisted executable without a shell or an unbounded filesystem walk. */
function defaultFindExecutable(executable, options = {}) {
  const env = options.env || process.env
  const exists = options.exists || fs.existsSync
  const run = options.execFileSync || execFileSync
  const local = env.LOCALAPPDATA || ''
  const known = executable === 'wt.exe'
    ? [path.join(local, 'Microsoft', 'WindowsApps', 'wt.exe')]
    : executable === 'cursor.exe'
      ? [path.join(local, 'Programs', 'cursor', 'Cursor.exe')]
      : []
  for (const candidate of known) {
    const found = existingFile(candidate, exists)
    if (found) return found
  }

  for (const hive of ['HKCU', 'HKLM']) {
    const registry = output('reg.exe', [
      'query',
      `${hive}\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${executable}`,
      '/ve',
    ], run)
    const match = registry.match(/REG_SZ\s+(.+)$/mi)
    const found = existingFile(match?.[1]?.trim(), exists)
    if (found) return found
  }

  const first = output('where.exe', [executable], run).split(/\r?\n/).find(Boolean) || ''
  return existingFile(first.trim(), exists)
}

function resolveSupportedOpener(kind, options = {}) {
  if (!SUPPORTED_OPENERS.includes(kind)) return { availability: 'unavailable', executable: '' }
  if (kind === 'custom' || kind === 'vscode') return { availability: 'available', executable: '' }
  if (kind === 'codex-app') {
    const protocolAvailability = options.protocolAvailability || (() => 'unknown')
    return { availability: protocolAvailability('codex'), executable: '' }
  }
  const findExecutable = options.findExecutable || defaultFindExecutable
  const executable = findExecutable(EXECUTABLES[kind])
  return { availability: executable ? 'available' : 'unavailable', executable: executable || '' }
}

/** Renderer-visible catalog: stable ids and availability only, never local paths. */
function discoverSupportedOpeners(options = {}) {
  const protocolAvailability = options.protocolAvailability || (() => 'unknown')
  const findExecutable = options.findExecutable || defaultFindExecutable
  return SUPPORTED_OPENERS.map((kind) => {
    if (kind === 'vscode' || kind === 'codex-app') {
      const protocol = kind === 'vscode' ? 'vscode' : 'codex'
      return { kind, availability: protocolAvailability(protocol) }
    }
    if (kind === 'custom') return { kind, availability: 'available' }
    return { kind, availability: resolveSupportedOpener(kind, { findExecutable }).availability }
  })
}

module.exports = {
  SUPPORTED_OPENERS,
  defaultFindExecutable,
  discoverSupportedOpeners,
  resolveSupportedOpener,
}
