'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  codexThreadUrl,
  openSessionRequest,
  planSessionRequest,
  vscodeFolderUrl,
} = require('./session_opener')

const APP = 'http://127.0.0.1:8642/'
const RESOURCE_REF = {
  kind: 'planning-space',
  resource_id: Buffer.from(
    JSON.stringify({
      data_scope_id: '22222222-2222-4222-8222-222222222222',
      space_key: 'SAMPLE',
    }),
    'utf8',
  ).toString('base64url'),
}
const TARGET = {
  id: 'f89d66c7-f023-4169-8d1a-2e69d4b1af68',
  client: 'claude',
  cwd: 'C:\\work\\repo',
  resource_ref: RESOURCE_REF,
}

function projectEntry(projectId, root, board = projectId, bindings = null) {
  const projectBindings = bindings ?? [{ resource_ref: RESOURCE_REF }]
  return {
    project_id: projectId,
    display_name: board,
    canonical_root: root,
    planning_binding: projectBindings[0]?.resource_ref || null,
  }
}

function registryBytes(projects = [projectEntry('sample', TARGET.cwd, 'B')]) {
  return Buffer.from(JSON.stringify({ schema_version: 3, projects }), 'utf8')
}

function fakeSpawn(calls, fail) {
  return (command, args, options) => {
    calls.push({ command, args, options })
    return {
      once(eventName, handler) {
        if (fail && eventName === 'error') queueMicrotask(() => handler(new Error(fail)))
        if (!fail && eventName === 'spawn') queueMicrotask(handler)
      },
      unref() {},
    }
  }
}

test('plans are rebuilt from the raw target, refusing bad shapes by reason', () => {
  const vscode = planSessionRequest({ ...TARGET, opener: { kind: 'vscode' } })
  assert.deepEqual(vscode, { mode: 'url', url: 'vscode://file/C:/work/repo' })
  assert.equal(
    vscodeFolderUrl('/home/operator/my project/'),
    'vscode://file/home/operator/my%20project',
  )

  const terminal = planSessionRequest(
    { ...TARGET, opener: { kind: 'terminal' } },
    { executable: 'C:\\WindowsApps\\wt.exe' },
  )
  assert.equal(terminal.mode, 'spawn')
  assert.equal(terminal.argv[0], 'C:\\WindowsApps\\wt.exe')
  assert.deepEqual(terminal.argv.slice(1), [
    '-d',
    TARGET.cwd,
    'cmd.exe',
    '/k',
    'claude',
    '--resume',
    TARGET.id,
  ])
  assert.equal(terminal.display, `claude --resume ${TARGET.id}`)

  const cursor = planSessionRequest(
    { ...TARGET, opener: { kind: 'cursor' } },
    { executable: 'C:\\Apps\\Cursor\\cursor.exe' },
  )
  assert.deepEqual(cursor.argv, ['C:\\Apps\\Cursor\\cursor.exe', TARGET.cwd])

  const custom = planSessionRequest({
    ...TARGET,
    opener: { kind: 'custom', command: 'wt -d "{cwd}" codex resume {session}' },
  })
  assert.equal(custom.mode, 'spawn')
  assert.deepEqual(custom.argv, ['wt', '-d', TARGET.cwd, 'codex', 'resume', TARGET.id])

  assert.equal(
    planSessionRequest({ ...TARGET, opener: { kind: 'shell' } }).reason,
    'invalid-request',
  )
  assert.equal(
    planSessionRequest(
      { ...TARGET, id: 'x" & calc & "', opener: { kind: 'terminal' } },
      { executable: 'wt.exe' },
    ).reason,
    'invalid-session',
  )
  assert.equal(
    planSessionRequest(
      { ...TARGET, id: '', opener: { kind: 'terminal' } },
      { executable: 'wt.exe' },
    ).reason,
    'no-session',
  )
  assert.equal(
    planSessionRequest({ ...TARGET, cwd: '', opener: { kind: 'vscode' } }).reason,
    'no-cwd',
  )
  assert.equal(
    planSessionRequest({
      ...TARGET,
      opener: { kind: 'custom', command: '   ' },
    }).reason,
    'no-command',
  )
})

test('only the Valkama app may open sessions', async () => {
  const result = await openSessionRequest({
    senderUrl: 'https://evil.example/',
    appUrl: APP,
    request: { ...TARGET, opener: { kind: 'terminal' } },
    shell: { openExternal: async () => assert.fail('must not open') },
    spawn: () => assert.fail('must not spawn'),
    directoryExists: () => true,
  })
  assert.equal(result.ok, false)
  assert.match(result.error, /limited to the Valkama app/)
})

test('a vscode plan goes to the OS URL handler, never to a process spawn', async () => {
  const opened = []
  const result = await openSessionRequest({
    senderUrl: APP,
    appUrl: APP,
    request: { ...TARGET, opener: { kind: 'vscode' } },
    shell: { openExternal: async (url) => opened.push(url) },
    spawn: () => assert.fail('must not spawn'),
    readBytes: registryBytes,
    directoryExists: () => true,
  })
  assert.deepEqual(opened, ['vscode://file/C:/work/repo'])
  assert.equal(result.ok, true)
  assert.equal(result.mode, 'opened')
  assert.equal(result.command, 'vscode://file/C:/work/repo')
  assert.equal(result.cwd, TARGET.cwd)
  assert.equal(result.source, 'host_runtime')
  assert.equal(result.status, 'mapped')
})

test('Codex App opens only a Codex-family UUID after launch-time protocol verification', async () => {
  const codex = {
    ...TARGET,
    id: '019fe338-0335-7b20-8bfc-cedaad62feda',
    client: 'raw-codex-reporter',
    client_family: 'codex',
  }
  const opened = []
  assert.equal(codexThreadUrl(codex.id), `codex://threads/${codex.id}`)
  const result = await openSessionRequest({
    senderUrl: APP,
    appUrl: APP,
    request: { ...codex, opener: { kind: 'codex-app' } },
    shell: { openExternal: async (url) => opened.push(url) },
    spawn: () => assert.fail('must not spawn'),
    resolveOpener: () => ({ availability: 'available', executable: '' }),
    readBytes: registryBytes,
    directoryExists: () => true,
  })
  assert.equal(result.ok, true)
  assert.deepEqual(opened, [`codex://threads/${codex.id}`])
  assert.equal(
    planSessionRequest({ ...codex, id: 'bad', opener: { kind: 'codex-app' } }).reason,
    'invalid-session',
  )
  assert.equal(
    planSessionRequest({
      ...codex,
      client_family: 'claude',
      opener: { kind: 'codex-app' },
    }).reason,
    'unsupported-client',
  )
  const unavailable = await openSessionRequest({
    senderUrl: APP,
    appUrl: APP,
    request: { ...codex, opener: { kind: 'codex-app' } },
    shell: { openExternal: async () => assert.fail('must not open') },
    spawn: () => assert.fail('must not spawn'),
    resolveOpener: () => ({ availability: 'unavailable', executable: '' }),
    readBytes: registryBytes,
    directoryExists: () => true,
  })
  assert.equal(unavailable.error, 'opener-unavailable')
})

test('a terminal plan is re-resolved in the main process and resumes the observed client', async () => {
  const calls = []
  const result = await openSessionRequest({
    senderUrl: APP,
    appUrl: APP,
    request: { ...TARGET, opener: { kind: 'terminal' } },
    shell: { openExternal: async () => assert.fail('not a url plan') },
    spawn: fakeSpawn(calls),
    resolveOpener: () => ({
      availability: 'available',
      executable: 'C:\\WindowsApps\\wt.exe',
    }),
    readBytes: registryBytes,
    directoryExists: (dir) => dir === TARGET.cwd,
  })
  assert.equal(result.ok, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].command, 'C:\\WindowsApps\\wt.exe')
  assert.deepEqual(calls[0].args.slice(0, 5), ['-d', TARGET.cwd, 'cmd.exe', '/k', 'claude'])
  assert.equal(calls[0].options.cwd, TARGET.cwd)
  assert.equal(result.cwd, TARGET.cwd)
  assert.equal(result.source, 'host_runtime')
  assert.equal(result.status, 'mapped')

  // A vanished directory must refuse rather than inherit Electron's cwd.
  const fallback = []
  const vanished = await openSessionRequest({
    senderUrl: APP,
    appUrl: APP,
    request: { ...TARGET, opener: { kind: 'terminal' } },
    shell: {},
    spawn: fakeSpawn(fallback),
    resolveOpener: () => ({ availability: 'available', executable: 'wt.exe' }),
    readBytes: registryBytes,
    directoryExists: () => false,
  })
  assert.equal(vanished.ok, false)
  assert.equal(vanished.error, 'space-root-unavailable')
  assert.equal(fallback.length, 0)
})

test('a custom plan spawns its own argv and reports a missing program honestly', async () => {
  const calls = []
  const ok = await openSessionRequest({
    senderUrl: APP,
    appUrl: APP,
    request: {
      ...TARGET,
      opener: { kind: 'custom', command: 'wt -d "{cwd}"' },
    },
    shell: {},
    spawn: fakeSpawn(calls),
    readBytes: registryBytes,
    directoryExists: () => true,
  })
  assert.equal(ok.ok, true)
  assert.equal(calls[0].command, 'wt')
  assert.deepEqual(calls[0].args, ['-d', TARGET.cwd])

  const missing = await openSessionRequest({
    senderUrl: APP,
    appUrl: APP,
    request: {
      ...TARGET,
      opener: { kind: 'custom', command: 'no-such-tool {session}' },
    },
    shell: {},
    spawn: fakeSpawn([], 'spawn no-such-tool ENOENT'),
    readBytes: registryBytes,
    directoryExists: () => true,
  })
  assert.equal(missing.ok, false)
  assert.match(missing.error, /ENOENT/)
})

test('mapped resource root wins over renderer cwd and custom session_cwd is observed', async () => {
  const calls = []
  const result = await openSessionRequest({
    senderUrl: APP,
    appUrl: APP,
    request: {
      ...TARGET,
      cwd: 'C:\\evil',
      session_cwd: TARGET.cwd,
      opener: {
        kind: 'custom',
        command: 'tool --root "{cwd}" --observed "{session_cwd}"',
      },
    },
    readBytes: () => registryBytes([projectEntry('sample', 'C:\\trusted', 'Presentation')]),
    shell: {},
    spawn: fakeSpawn(calls),
    directoryExists: (dir) => dir === 'C:\\trusted' || dir === TARGET.cwd,
  })
  assert.equal(result.ok, true)
  assert.deepEqual(calls[0].args, ['--root', 'C:\\trusted', '--observed', TARGET.cwd])
  assert.equal(calls[0].options.cwd, 'C:\\trusted')
  assert.equal(result.cwd, 'C:\\trusted')
  assert.equal(result.source, 'host_runtime')
  assert.equal(result.status, 'mapped')
  assert.equal(result.fallback, false)
})

test('missing exact binding refuses the observed session cwd as launch authority', async () => {
  const calls = []
  const refused = await openSessionRequest({
    senderUrl: APP,
    appUrl: APP,
    request: {
      ...TARGET,
      session_cwd: TARGET.cwd,
      opener: { kind: 'terminal' },
    },
    readBytes: () => registryBytes([projectEntry('sample', TARGET.cwd, 'SAMPLE', [])]),
    shell: {},
    spawn: fakeSpawn(calls),
    resolveOpener: () => ({ availability: 'available', executable: 'wt.exe' }),
    directoryExists: () => true,
  })
  assert.equal(refused.ok, false)
  assert.equal(refused.error, 'space-root-unavailable')
  assert.equal(refused.source.status, 'missing')
  assert.equal(refused.source.effective_cwd, '')
  assert.equal(refused.source.session_cwd, TARGET.cwd)
  assert.equal(refused.source.fallback, false)
  assert.equal(calls.length, 0)
})
