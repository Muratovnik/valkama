'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

// The programs the session executor may start, each found one way.
//
// An editor is found through its own URL scheme: `HKEY_CLASSES_ROOT\<scheme>\
// shell\open\command` names the program Windows starts for a link, which is the
// program the server already took as proof the editor is installed
// (`server/ops/url_schemes.py`). `commandExecutable` is the counterpart of
// `url_schemes.command_executable`, and both read the samples in
// `tests/fixtures/scheme-command-samples.json`, so the two cannot drift apart.
// Windows Terminal and the Claude and Codex CLIs have no scheme to read and are found by name.

const SUPPORTED_OPENERS = Object.freeze(['vscode', 'codex-app', 'terminal', 'cursor', 'custom'])
/** The editors, whose product name is also their scheme. */
const EDITORS = Object.freeze(['vscode', 'vscode-insiders', 'cursor', 'windsurf'])
/** The programs found by name; nothing outside this list reaches a registry query. */
const NAMED = Object.freeze({
  'wt.exe': (env) => [path.join(env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps', 'wt.exe')],
  'claude.exe': (env) => [
    path.join(env.USERPROFILE || os.homedir(), '.local', 'bin', 'claude.exe'),
  ],
  // The Codex app installs its CLI beside itself.
  'codex.exe': (env) => [
    path.join(env.LOCALAPPDATA || '', 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe'),
  ],
})

const LEADING_EXECUTABLE = /^\s*(?:"([^"]+)"|(.+?\.exe)(?=\s|$)|(\S+))/i
const VAR_CHARS = /[A-Za-z0-9_-]/

function lookup(env, name) {
  // Windows names are case-insensitive, as Python's `os.environ` reads them there.
  const wanted = name.toUpperCase()
  const key = Object.keys(env).find((candidate) => candidate.toUpperCase() === wanted)
  return key === undefined ? undefined : String(env[key])
}

/**
 * `$var`, `${var}` and `%var%` expanded as Python's `ntpath.expandvars` does:
 * an unknown name stays as written, `$$` and `%%` stand for one sign, and
 * nothing inside single quotes is expanded.
 */
function expandVars(text, env = process.env) {
  if (!text.includes('$') && !text.includes('%')) return text
  let out = ''
  let index = 0
  while (index < text.length) {
    const c = text[index]
    if (c === "'") {
      const end = text.indexOf("'", index + 1)
      if (end === -1) return out + text.slice(index)
      out += text.slice(index, end + 1)
      index = end + 1
    } else if (c === '%') {
      if (text[index + 1] === '%') {
        out += '%'
        index += 2
        continue
      }
      const end = text.indexOf('%', index + 1)
      if (end === -1) return out + text.slice(index)
      const name = text.slice(index + 1, end)
      const value = lookup(env, name)
      out += value === undefined ? `%${name}%` : value
      index = end + 1
    } else if (c === '$') {
      if (text[index + 1] === '$') {
        out += '$'
        index += 2
      } else if (text[index + 1] === '{') {
        const end = text.indexOf('}', index + 2)
        if (end === -1) return out + text.slice(index)
        const name = text.slice(index + 2, end)
        const value = lookup(env, name)
        out += value === undefined ? `\${${name}}` : value
        index = end + 1
      } else {
        let end = index + 1
        while (end < text.length && VAR_CHARS.test(text[end])) end += 1
        const name = text.slice(index + 1, end)
        const value = name ? lookup(env, name) : undefined
        out += value === undefined ? `$${name}` : value
        index = end
      }
    } else {
      out += c
      index += 1
    }
  }
  return out
}

/** The program a `shell\open\command` value starts, with variables expanded. */
function commandExecutable(command, env = process.env) {
  const found = LEADING_EXECUTABLE.exec(expandVars(String(command ?? ''), env))
  return found ? found[1] || found[2] || found[3] || '' : ''
}

/**
 * One registry value, read as UTF-8.
 *
 * `reg.exe` writes in the console's OEM code page, where a character outside it
 * becomes `?`: a path under a profile with a name in another script would name
 * nothing. Switching that hidden console to 65001 first makes it write UTF-8.
 * `key` is built only from the closed lists above, never from a request.
 */
function readRegistryValue(key, valueArgs, run = execFileSync) {
  const line = `chcp 65001 >nul & reg.exe query "${key}" ${valueArgs}`
  let output
  try {
    output = run('cmd.exe', [`/d /s /c "${line}"`], {
      windowsHide: true,
      windowsVerbatimArguments: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return ''
  }
  const found = /\sREG_(?:EXPAND_)?SZ[ \t]+(.*?)[ \t]*$/m.exec(Buffer.from(output).toString('utf8'))
  return found ? found[1] : ''
}

/** The command an editor's scheme runs; '' for a name outside the list or no command. */
function schemeCommand(editor, run = execFileSync) {
  if (!EDITORS.includes(editor)) return ''
  return readRegistryValue(`HKCR\\${editor}\\shell\\open\\command`, '/ve', run)
}

function isFile(file) {
  try {
    return fs.statSync(file).isFile()
  } catch {
    return false
  }
}

/** The editor's own program, absolute and present, or ''. */
function editorExecutable(editor, options = {}) {
  const readCommand = options.readCommand || schemeCommand
  const exists = options.isFile || isFile
  const executable = commandExecutable(readCommand(editor), options.env || process.env)
  return executable && path.win32.isAbsolute(executable) && exists(executable) ? executable : ''
}

/** One allowlisted program by name: its usual place, App Paths, then the PATH. */
function findExecutable(name, options = {}) {
  const candidates = NAMED[name]
  if (!candidates) return ''
  const env = options.env || process.env
  const exists = options.isFile || isFile
  const run = options.execFileSync || execFileSync
  const present = (file) => (file && path.win32.isAbsolute(file) && exists(file) ? file : '')
  for (const candidate of candidates(env)) {
    if (present(candidate)) return candidate
  }
  for (const hive of ['HKCU', 'HKLM']) {
    const key = `${hive}\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${name}`
    const found = present(readRegistryValue(key, '/ve', run).trim())
    if (found) return found
  }
  let first = ''
  try {
    first = String(
      run('where.exe', [name], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }),
    )
      .split(/\r?\n/)
      .find(Boolean)
  } catch {
    // Not on the PATH either.
  }
  return present(String(first || '').trim())
}

/**
 * Renderer-visible catalog for the settings page: stable ids and availability,
 * never a local path. It answers until the settings stop asking (where a
 * session opens is the server's plan now, not an opener per client).
 */
function discoverSupportedOpeners(options = {}) {
  const protocolAvailability = options.protocolAvailability || (() => 'unknown')
  const find = options.findExecutable || findExecutable
  const editor = options.editorExecutable || editorExecutable
  const available = (found) => (found ? 'available' : 'unavailable')
  return SUPPORTED_OPENERS.map((kind) => {
    if (kind === 'vscode') return { kind, availability: protocolAvailability('vscode') }
    if (kind === 'codex-app') return { kind, availability: protocolAvailability('codex') }
    if (kind === 'terminal') return { kind, availability: available(find('wt.exe')) }
    if (kind === 'cursor') return { kind, availability: available(editor('cursor')) }
    return { kind, availability: 'available' }
  })
}

module.exports = {
  EDITORS,
  SUPPORTED_OPENERS,
  commandExecutable,
  discoverSupportedOpeners,
  editorExecutable,
  expandVars,
  findExecutable,
  readRegistryValue,
  schemeCommand,
}
