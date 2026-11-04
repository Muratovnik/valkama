'use strict'

const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const {
  commandExecutable,
  discoverSupportedOpeners,
  editorExecutable,
  findExecutable,
  programOnPath,
  readRegistryValue,
  schemeCommand,
} = require('./opener_catalog')

// The same samples `tests/test_url_schemes.py` reads for `command_executable`:
// the server says an editor is installed by the program its command names, and
// this side starts that program, so the two readings must agree on every one.
const SAMPLES = JSON.parse(
  readFileSync(path.join(__dirname, '..', 'tests', 'fixtures', 'scheme-command-samples.json'), 'utf8'),
).samples

/** What `reg.exe query <key> /ve` writes, in the shape it writes it. */
function regOutput(type, value, label = '(Default)') {
  return Buffer.from(`\r\nHKEY_CLASSES_ROOT\\vscode\\shell\\open\\command\r\n    ${label}    ${type}    ${value}\r\n\r\n`, 'utf8')
}

test('the program a scheme starts is read as the server reads it', () => {
  assert.ok(SAMPLES.length > 5)
  for (const sample of SAMPLES) {
    assert.equal(commandExecutable(sample.command, sample.env), sample.expected, sample.command)
  }
})

test('a registry value is read as UTF-8, whatever the label and the value type', () => {
  const calls = []
  const run = (file, args, options) => {
    calls.push({ file, args, options })
    return regOutput('REG_SZ', '"C:\\work\\Редактор\\Code.exe" --open-url -- "%1"', '(По умолчанию)')
  }
  assert.equal(
    readRegistryValue('HKCR\\vscode\\shell\\open\\command', '/ve', run),
    '"C:\\work\\Редактор\\Code.exe" --open-url -- "%1"',
  )
  // The console is switched to UTF-8 before reg.exe writes, or a name outside the
  // OEM code page arrives as '?' and names a program that does not exist.
  assert.equal(calls[0].file, 'cmd.exe')
  assert.equal(calls[0].options.windowsVerbatimArguments, true)
  assert.match(calls[0].args[0], /chcp 65001 >nul & reg\.exe query "HKCR\\vscode\\shell\\open\\command" \/ve/)

  assert.equal(
    readRegistryValue('k', '/ve', () => regOutput('REG_EXPAND_SZ', '%LOCALAPPDATA%\\x\\Code.exe %1')),
    '%LOCALAPPDATA%\\x\\Code.exe %1',
  )
  assert.equal(readRegistryValue('k', '/ve', () => regOutput('REG_SZ', '')), '')
  assert.equal(
    readRegistryValue('k', '/ve', () => {
      throw new Error('ERROR: The system was unable to find the specified registry key or value.')
    }),
    '',
  )
})

test('only an editor in the closed list reaches a registry query', () => {
  const asked = []
  const run = (file, args) => {
    asked.push(args[0])
    return regOutput('REG_SZ', 'C:\\x\\Code.exe "%1"')
  }
  for (const name of ['codex', 'claude-cli', 'vscode" & calc & "', '..\\vscode', '']) {
    assert.equal(schemeCommand(name, run), '', name)
  }
  assert.deepEqual(asked, [])
  assert.equal(schemeCommand('cursor', run), 'C:\\x\\Code.exe "%1"')
  assert.match(asked[0], /HKCR\\cursor\\shell\\open\\command/)
})

test('an editor counts only by an absolute program that is there', () => {
  const present = new Set(['C:\\Apps\\VS Code\\Code.exe'])
  const options = (command) => ({
    readCommand: () => command,
    isFile: (file) => present.has(file),
    env: {},
  })
  assert.equal(
    editorExecutable('vscode', options('"C:\\Apps\\VS Code\\Code.exe" --open-url -- "%1"')),
    'C:\\Apps\\VS Code\\Code.exe',
  )
  // The key an uninstalled editor left behind, and a command that names no folder.
  assert.equal(editorExecutable('cursor', options('"C:\\Gone\\Cursor.exe" "%1"')), '')
  assert.equal(editorExecutable('vscode', options('rundll32 url.dll,FileProtocolHandler %1')), '')
  assert.equal(editorExecutable('vscode', options('')), '')
})

test('a program is found by name only from the allowlist, its usual place first', () => {
  const run = () => assert.fail('nothing outside the allowlist is looked up')
  assert.equal(findExecutable('calc.exe', { execFileSync: run }), '')
  const env = { LOCALAPPDATA: 'C:\\work\\profile\\local', USERPROFILE: 'C:\\work\\profile' }
  const usual = path.join(env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'wt.exe')
  assert.equal(
    findExecutable('wt.exe', { env, isFile: (file) => file === usual, execFileSync: run }),
    usual,
  )
  const cli = path.join(env.USERPROFILE, '.local', 'bin', 'claude.exe')
  assert.equal(findExecutable('claude.exe', { env, isFile: (file) => file === cli, execFileSync: run }), cli)
  const codex = path.join(env.LOCALAPPDATA, 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe')
  assert.equal(findExecutable('codex.exe', { env, isFile: (file) => file === codex, execFileSync: run }), codex)
})

test('the settings catalog keeps its ids and availability and names no path', () => {
  const capabilities = discoverSupportedOpeners({
    protocolAvailability: () => 'available',
    findExecutable: (name) => (name === 'wt.exe' ? 'C:\\WindowsApps\\wt.exe' : ''),
    editorExecutable: () => '',
  })
  assert.deepEqual(capabilities, [
    { kind: 'vscode', availability: 'available' },
    { kind: 'codex-app', availability: 'available' },
    { kind: 'terminal', availability: 'available' },
    { kind: 'cursor', availability: 'unavailable' },
    { kind: 'custom', availability: 'available' },
  ])
})

test('a program named alone is found on the PATH, never in the folder it starts in', () => {
  const files = new Set(['C:\\bin\\tool.exe', 'C:\\later\\tool.com', 'C:\\later\\other.com'])
  const isFile = (file) => files.has(file)
  // The current folder is not an entry; a relative entry is not one either.
  const env = { Path: '.;repo;"C:\\bin";C:\\later' }
  assert.equal(programOnPath('tool', { env, isFile }), 'C:\\bin\\tool.exe')
  assert.equal(programOnPath('other', { env, isFile }), 'C:\\later\\other.com')
  assert.equal(programOnPath('tool.exe', { env, isFile }), 'C:\\bin\\tool.exe')
  // A script needs a shell, and a written path is not a name to look up.
  assert.equal(programOnPath('tool.cmd', { env, isFile: () => true }), '')
  assert.equal(programOnPath('.\\tool', { env, isFile }), '')
  assert.equal(programOnPath('missing', { env, isFile }), '')
  assert.equal(programOnPath('tool', { env: {}, isFile }), '')
})
