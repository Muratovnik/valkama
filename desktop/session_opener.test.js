'use strict'

const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { claudeLiveness } = require('./live_sessions')
const { PAUSE_MS, copyableCommand, openSessionRequest, writtenFolder } = require('./session_opener')

const APP = 'http://127.0.0.1:8642/'
const ID = 'f89d66c7-f023-4169-8d1a-2e69d4b1af68'
const FOLDER = 'C:\\work\\repo'
const CODE = 'C:\\Apps\\VS Code\\Code.exe'
const WT = 'C:\\WindowsApps\\wt.exe'
const CLI = 'C:\\work\\bin\\claude.exe'
const CODEX = 'C:\\work\\bin\\codex.exe'
const TOOL = 'C:\\tools\\tool.exe'
const CMD = 'C:\\Windows\\System32\\cmd.exe'
const EXTENSION_LINK = `vscode://anthropic.claude-code/open?session=${ID}`

function plan(steps, extra = {}) {
  return {
    target: { kind: 'session', session: ID, agent: '' },
    surface: 'desktop',
    client: 'claude',
    state: 'ended',
    place: { opened_in: 'ide', opened_host: 'vscode', source: 'recorded', first_open: false },
    opens: { opened_in: 'ide', opened_host: 'vscode', source: 'recorded', missed: '' },
    one_action: false,
    steps,
    ...extra,
  }
}

const FOCUS = { kind: 'focus-folder', ide: 'vscode', folder: FOLDER }
const LINK = { kind: 'open-link', scheme: 'vscode', link: EXTENSION_LINK }

/**
 * A machine of stubs. `timeline` holds every effect in the order it happened,
 * `exits` says whether a started program exits by itself (a second instance does).
 */
function machine({ plans, exits = true, spawnError = '' } = {}) {
  const timeline = []
  const queries = []
  const logged = []
  const answer = typeof plans === 'function' ? plans : () => plans
  return {
    timeline,
    queries,
    logged,
    options: (extra = {}) => ({
      senderUrl: APP,
      appUrl: APP,
      fetchPlan: async (query) => {
        queries.push(query)
        timeline.push('fetch')
        const value = answer(query)
        return Array.isArray(value)
          ? { status: value[0], body: JSON.stringify(value[1]) }
          : { status: 200, body: JSON.stringify(value) }
      },
      shell: {
        openExternal: async (url) => {
          timeline.push(`link ${url}`)
        },
      },
      clipboard: { writeText: (value) => timeline.push(`copy ${value}`) },
      spawn: (file, args, spawnOptions) => {
        timeline.push({ spawn: file, args, options: spawnOptions })
        const child = new EventEmitter()
        child.unref = () => {}
        setImmediate(() => {
          if (spawnError) {
            child.emit('error', new Error(spawnError))
            return
          }
          child.emit('spawn')
          if (exits) {
            setImmediate(() => {
              timeline.push(`exit ${file}`)
              child.emit('exit', 0, null)
            })
          }
        })
        return child
      },
      sleep: async (ms) => {
        timeline.push(`sleep ${ms}`)
      },
      editorExecutable: (ide) => (ide === 'vscode' ? CODE : ''),
      findExecutable: (name) => ({ 'wt.exe': WT, 'claude.exe': CLI, 'codex.exe': CODEX })[name] || '',
      programOnPath: (name) => ({ tool: TOOL, wt: WT })[name] || '',
      isDirectory: (dir) => dir === FOLDER || dir === 'C:\\work\\my;folder',
      isFile: (file) => file === 'C:\\work\\repo\\docs\\plan.md',
      env: { ELECTRON_RUN_AS_NODE: '1', PATH: 'C:\\Windows', SystemRoot: 'C:\\Windows' },
      home: 'C:\\work\\home',
      log: (event, fields) => logged.push({ event, fields }),
      windowWaitMs: 2000,
      ...extra,
    }),
  }
}

function effects(timeline) {
  return timeline.filter((entry) => entry !== 'fetch')
}

test('a request that names more than a target and settings is refused before anything is asked', async () => {
  for (const request of [
    null,
    'vscode://anthropic.claude-code/open',
    [ID],
    { session: ID, url: EXTENSION_LINK },
    { session: ID, link: EXTENSION_LINK },
    { session: ID, argv: ['calc.exe'] },
    { session: ID, opener: { kind: 'vscode' } },
    { session: ID, cwd: 'C:\\evil' },
    { url: EXTENSION_LINK },
    { argv: ['calc.exe'] },
    { session: 'x" & calc & "' },
    { session: 12345678 },
    { session: ID, fallback: 'shell' },
    { session: ID, always: 'cmd.exe' },
    { session: ID, step: -1 },
    { session: ID, step: 1.5 },
    { session: ID, command: ['calc.exe'] },
    { session: ID, command: 'tool', fallback: 'vscode' },
    { path: 'docs/plan.md' },
    { path: { kind: 'file', project: 'sample', path: 'docs/plan.md', argv: ['x'] } },
    { path: { kind: 'program', project: 'sample', path: 'calc.exe' } },
    { path: { kind: 'folder', project: 'sample', path: 'docs', line: 3 } },
    { path: { kind: 'file', project: 'sample', path: 'docs/plan.md' }, always: 'vscode' },
  ]) {
    const box = machine({ plans: () => assert.fail('no plan is asked for') })
    const result = await openSessionRequest(box.options({ request }))
    assert.equal(result.ok, false, JSON.stringify(request))
    assert.equal(result.reason, 'invalid-request', JSON.stringify(request))
    assert.deepEqual(box.timeline, [], JSON.stringify(request))
  }
})

test('only the Valkama app may ask', async () => {
  const box = machine({ plans: () => assert.fail('no plan is asked for') })
  const result = await openSessionRequest(
    box.options({ senderUrl: 'https://evil.example/', request: { session: ID } }),
  )
  assert.equal(result.reason, 'not-app')
  assert.deepEqual(box.timeline, [])
})

test('a plan with one step outside the closed lists runs nothing at all', async () => {
  const bad = [
    { kind: 'open-link', scheme: 'ms-settings', link: 'ms-settings:privacy' },
    { kind: 'open-link', scheme: 'file', link: 'file:///C:/Windows/System32/calc.exe' },
    { kind: 'open-link', scheme: 'vscode', link: 'claude://code/continue?session=x' },
    { kind: 'open-link', scheme: 'vscode', link: `${EXTENSION_LINK} --x` },
    { ...LINK, argv: ['calc.exe'] },
    { kind: 'run', argv: ['calc.exe'] },
    { kind: 'focus-folder', ide: 'notepad', folder: FOLDER },
    { kind: 'focus-folder', ide: 'vscode', folder: '\\\\server\\share\\repo' },
    { kind: 'focus-folder', ide: 'vscode', folder: 'C:\\work\\repo\\..\\..\\Windows' },
    { kind: 'focus-folder', ide: 'vscode', folder: 'work\\repo' },
    { kind: 'focus-folder', ide: 'vscode', folder: 'C:\\work\\missing' },
    { kind: 'resume-in-terminal', client: 'bash', session: ID, folder: FOLDER },
    { kind: 'resume-in-terminal', client: 'claude', session: `${ID} & calc`, folder: FOLDER },
    { kind: 'desktop-resume', session: '--dangerously-skip-permissions' },
    { kind: 'copy', text: 'calc.exe' },
    { kind: 'open-file', ide: 'vscode', path: 'C:\\Windows\\win.ini', line: null },
    { kind: 'explain', reason: 'because' },
    { kind: 'explain', reason: 'not-installed', host: 'x" onclick="' },
    { kind: 'explain', reason: 'gone', constructor: 'x' },
  ]
  for (const second of bad) {
    // A valid first step, so a check that stops at the first one is caught too.
    const box = machine({ plans: plan([FOCUS, second], { one_action: true }) })
    const result = await openSessionRequest(box.options({ request: { session: ID } }))
    assert.equal(result.reason, 'invalid-plan', JSON.stringify(second))
    assert.deepEqual(effects(box.timeline), [], JSON.stringify(second))
  }
  const browser = machine({ plans: plan([LINK], { surface: 'browser', one_action: true }) })
  const refused = await openSessionRequest(browser.options({ request: { session: ID } }))
  assert.equal(refused.reason, 'invalid-plan')
  assert.deepEqual(effects(browser.timeline), [])
})

test('the plan is asked for with the target and settings alone, as the desktop', async () => {
  const box = machine({ plans: plan([LINK], { one_action: true }) })
  await openSessionRequest(
    box.options({ request: { session: ID, fallback: 'cursor', always: 'codex-app' } }),
  )
  await openSessionRequest(
    box.options({
      request: { path: { kind: 'file', project: 'sample', path: 'docs/plan.md', line: 12 } },
    }),
  )
  assert.deepEqual(box.queries, [
    { target: 'session', session: ID, fallback: 'cursor', always: 'codex-app', surface: 'desktop' },
    { target: 'file', project: 'sample', path: 'docs/plan.md', line: '12', surface: 'desktop' },
  ])
})

test('a server that refuses the plan opens nothing and says so in a closed word', async () => {
  const box = machine({ plans: [403, { error: { code: 'fetch_metadata_refused' } }] })
  const result = await openSessionRequest(box.options({ request: { session: ID } }))
  assert.equal(result.reason, 'plan-unavailable')
  assert.deepEqual(effects(box.timeline), [])
})

test('one action runs window, the second instance exiting, a pause, then the link', async () => {
  const box = machine({ plans: plan([FOCUS, LINK], { one_action: true }) })
  const result = await openSessionRequest(box.options({ request: { session: ID } }))
  assert.equal(result.ok, true)
  assert.equal(result.next, null)
  const order = effects(box.timeline).map((entry) =>
    typeof entry === 'string' ? entry : `spawn ${entry.spawn} ${entry.args.join(' ')}`,
  )
  assert.deepEqual(order, [
    `spawn ${CODE} ${FOLDER}`,
    `exit ${CODE}`,
    `sleep ${PAUSE_MS}`,
    `link ${EXTENSION_LINK}`,
  ])
  const started = box.timeline.find((entry) => typeof entry === 'object')
  assert.equal(started.options.cwd, FOLDER)
  // A program started from here never runs as plain Node, whatever this process inherited.
  assert.equal(started.options.env.ELECTRON_RUN_AS_NODE, undefined)
  assert.equal(started.options.env.PATH, 'C:\\Windows')
})

test('a window that is not confirmed gets no link, which is left for the person', async () => {
  const box = machine({ plans: plan([FOCUS, LINK], { one_action: true }), exits: false })
  const result = await openSessionRequest(box.options({ request: { session: ID }, windowWaitMs: 30 }))
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'window-not-confirmed')
  assert.equal(result.next, 1)
  assert.ok(!box.timeline.some((entry) => String(entry).startsWith('link')))
})

test('a plan that takes two actions runs one step per click', async () => {
  const box = machine({ plans: plan([FOCUS, LINK]) })
  const first = await openSessionRequest(box.options({ request: { session: ID } }))
  assert.equal(first.ok, true)
  assert.equal(first.next, 1)
  assert.equal(first.plan.one_action, false)
  const afterFirst = effects(box.timeline)
  assert.equal(afterFirst.length, 1)
  assert.equal(afterFirst[0].spawn, CODE)

  box.timeline.length = 0
  const second = await openSessionRequest(box.options({ request: { session: ID, step: 1 } }))
  assert.equal(second.ok, true)
  assert.equal(second.next, null)
  assert.deepEqual(effects(box.timeline), [`link ${EXTENSION_LINK}`])

  const beyond = await openSessionRequest(box.options({ request: { session: ID, step: 2 } }))
  assert.equal(beyond.reason, 'invalid-step')
})

test('an explanation opens nothing and carries its closed code to the page', async () => {
  const refusedPath = plan([{ kind: 'explain', reason: 'path-refused', code: 'outside_root' }], {
    target: { kind: 'file', project: 'sample', path: '../x.md', line: null },
    state: 'none',
    opens: null,
  })
  const box = machine({ plans: refusedPath })
  const result = await openSessionRequest(
    box.options({ request: { path: { kind: 'file', project: 'sample', path: '../x.md' } } }),
  )
  assert.equal(result.mode, 'explained')
  assert.equal(result.reason, 'path-refused')
  assert.equal(result.code, 'outside_root')
  assert.equal(result.next, null)
  assert.deepEqual(effects(box.timeline), [])

  // Said first, then a way to look at the session elsewhere, each its own action.
  const look = machine({
    plans: plan([{ kind: 'explain', reason: 'live-in-terminal' }, FOCUS, LINK], { state: 'live' }),
  })
  const told = await openSessionRequest(look.options({ request: { session: ID } }))
  assert.equal(told.reason, 'live-in-terminal')
  assert.equal(told.next, 1)
  assert.deepEqual(effects(look.timeline), [])
})

/** The server's rule: a live session in a terminal gets no second process, an ended one resumes. */
function terminalPlans(query) {
  if (query.liveness === 'ended') {
    return plan([{ kind: 'resume-in-terminal', client: 'claude', session: ID, folder: FOLDER }], {
      one_action: true,
    })
  }
  // Without the process's own state the row decides, and after a crash it still says live.
  return plan([{ kind: 'explain', reason: 'live-in-terminal' }], { state: 'live', opens: null })
}

function registryWith(pidAlive) {
  return (session) =>
    claudeLiveness(session, {
      directory: 'C:\\work\\claude-config\\sessions',
      readdir: () => ['4100.json', '4100.1f2e.key'],
      readFile: (file) => {
        assert.ok(file.endsWith('4100.json'), `read ${file}`)
        return Buffer.from(JSON.stringify({ pid: 4100, sessionId: ID }))
      },
      processAlive: () => pidAlive,
    })
}

test('a dead pid makes a crashed terminal session resumable in a new terminal', async () => {
  const box = machine({ plans: terminalPlans })
  const result = await openSessionRequest(
    box.options({ request: { session: ID }, liveness: registryWith(false) }),
  )
  assert.equal(result.ok, true)
  assert.deepEqual(
    box.queries.map((query) => query.liveness),
    [undefined, 'ended'],
  )
  const started = effects(box.timeline)[0]
  assert.equal(started.spawn, WT)
  // Every program by its full path, and none started in the session's folder: cmd
  // looks for a bare name there first, so a claude.cmd in that repository would run.
  assert.deepEqual(started.args, ['-d', FOLDER, CMD, '/k', CLI, '--resume', ID])
  assert.equal(started.options.cwd, 'C:\\work\\home')
})

test('a resume runs the client found by its full path, or nothing', async () => {
  const codexPlan = plan([{ kind: 'resume-in-terminal', client: 'codex', session: ID, folder: FOLDER }], {
    client: 'codex',
    one_action: true,
  })
  const codex = machine({ plans: codexPlan })
  await openSessionRequest(codex.options({ request: { session: ID } }))
  assert.deepEqual(effects(codex.timeline)[0].args, ['-d', FOLDER, CMD, '/k', CODEX, 'resume', ID])

  const missing = machine({ plans: codexPlan })
  const refused = await openSessionRequest(
    missing.options({ request: { session: ID }, findExecutable: (name) => (name === 'wt.exe' ? WT : '') }),
  )
  assert.deepEqual([refused.reason, refused.host], ['not-installed', 'codex-app'])
  assert.deepEqual(effects(missing.timeline), [])
})

test('a live pid starts no second process on the same transcript', async () => {
  const resumable = plan(
    [{ kind: 'resume-in-terminal', client: 'claude', session: ID, folder: FOLDER }],
    { one_action: true },
  )
  const box = machine({
    plans: (query) =>
      query.liveness === 'live'
        ? plan([{ kind: 'explain', reason: 'live-in-terminal' }], { state: 'live', opens: null })
        : resumable,
  })
  const result = await openSessionRequest(
    box.options({ request: { session: ID }, liveness: registryWith(true) }),
  )
  assert.equal(result.reason, 'live-in-terminal')
  assert.deepEqual(
    box.queries.map((query) => query.liveness),
    [undefined, 'live'],
  )
  assert.deepEqual(effects(box.timeline), [])
})

test('the registry is not asked about a client it does not know', async () => {
  const box = machine({
    plans: plan([{ kind: 'open-link', scheme: 'codex', link: `codex://threads/${ID}` }], {
      client: 'codex',
      one_action: true,
    }),
  })
  await openSessionRequest(
    box.options({ request: { session: ID }, liveness: () => assert.fail('not a Claude session') }),
  )
  assert.equal(box.queries.length, 1)
})

test('a folder Windows Terminal would split into two commands is refused', async () => {
  // The folder exists; its name alone is what would start another command.
  const folder = 'C:\\work\\my;folder'
  const box = machine({
    plans: plan([{ kind: 'resume-in-terminal', client: 'codex', session: ID, folder }], {
      client: 'codex',
      one_action: true,
    }),
  })
  const result = await openSessionRequest(box.options({ request: { session: ID } }))
  assert.equal(result.reason, 'invalid-plan')
  assert.deepEqual(effects(box.timeline), [])
})

// The same samples `tests/test_session_open.py` reads for `_written_folder`: the
// server offers a folder only where this side takes it, so the two must agree on each.
const FOLDER_SAMPLES = JSON.parse(
  readFileSync(path.join(__dirname, '..', 'tests', 'fixtures', 'folder-samples.json'), 'utf8'),
).samples

test('a folder is taken as the server takes it', () => {
  assert.ok(FOLDER_SAMPLES.length > 10)
  for (const sample of FOLDER_SAMPLES) {
    const folder = sample.folder + 'a'.repeat(sample.pad || 0)
    assert.equal(writtenFolder(folder), sample.opens, JSON.stringify(folder.slice(0, 60)))
    assert.equal(writtenFolder(folder, { terminal: true }), sample.terminal, JSON.stringify(folder.slice(0, 60)))
  }
})

// The same samples `_copied_command` reads: the server leads a command into a folder
// only where this side would take the line it wrote.
test('a command to copy is taken as the server writes it', () => {
  const samples = JSON.parse(
    readFileSync(path.join(__dirname, '..', 'tests', 'fixtures', 'folder-samples.json'), 'utf8'),
  ).pasted
  assert.ok(samples.length > 4)
  for (const sample of samples) {
    const folder = sample.folder + 'a'.repeat(sample.pad || 0)
    assert.equal(copyableCommand(`cd "${folder}" && claude --resume ${ID}`), sample.pastes, JSON.stringify(folder.slice(0, 60)))
  }
  assert.equal(copyableCommand(`claude --resume ${ID}`), true)
  assert.equal(copyableCommand(`cd "C:\\work" && calc.exe`), false)
  assert.equal(copyableCommand(`cd "C:\\work" & claude --resume ${ID}`), false)
  assert.equal(copyableCommand(`claude --resume ${ID} && calc.exe`), false)
})

test('a plan step runs only on a folder the shared rule takes', async () => {
  const rooted = { ...FOCUS, folder: '\\work\\repo' }
  const box = machine({ plans: plan([rooted], { one_action: true }) })
  const result = await openSessionRequest(
    box.options({ request: { session: ID }, isDirectory: () => true }),
  )
  assert.equal(result.reason, 'invalid-plan')
  const semicolon = machine({ plans: plan([{ ...FOCUS, folder: 'C:\\work\\my;folder' }], { one_action: true }) })
  const opened = await openSessionRequest(semicolon.options({ request: { session: ID } }))
  assert.equal(opened.ok, true, 'a window takes the folder as an argument, where `;` starts nothing')
})

test('the remaining steps each do their one thing', async () => {
  const copy = machine({ plans: plan([{ kind: 'copy', text: `claude --resume ${ID}` }], { one_action: true }) })
  const copied = await openSessionRequest(copy.options({ request: { session: ID } }))
  assert.equal(copied.mode, 'copied')
  assert.deepEqual(effects(copy.timeline), [`copy claude --resume ${ID}`])

  const desktop = machine({ plans: plan([{ kind: 'desktop-resume', session: ID }], { one_action: true }) })
  await openSessionRequest(desktop.options({ request: { session: ID } }))
  const handed = effects(desktop.timeline)[0]
  assert.equal(handed.spawn, CLI)
  assert.deepEqual(handed.args, ['--desktop', '--resume', ID])
  assert.equal(handed.options.windowsHide, true)

  const file = machine({
    plans: plan(
      [FOCUS, { kind: 'open-file', ide: 'vscode', path: 'C:\\work\\repo\\docs\\plan.md', line: 12 }],
      { one_action: true },
    ),
  })
  await openSessionRequest(
    file.options({ request: { path: { kind: 'file', project: 'sample', path: 'docs/plan.md' } } }),
  )
  const opened = effects(file.timeline).filter((entry) => typeof entry === 'object')
  assert.deepEqual(
    opened.map((entry) => [entry.spawn, ...entry.args]),
    [
      [CODE, FOLDER],
      [CODE, '-g', 'C:\\work\\repo\\docs\\plan.md:12'],
    ],
  )
})

test('a missing editor and a failed start are closed words, the failure only in the log', async () => {
  const missing = machine({ plans: plan([{ ...FOCUS, ide: 'cursor' }], { one_action: true }) })
  const notInstalled = await openSessionRequest(missing.options({ request: { session: ID } }))
  assert.equal(notInstalled.reason, 'not-installed')
  assert.equal(notInstalled.host, 'cursor')

  const failing = machine({
    plans: plan([{ kind: 'desktop-resume', session: ID }], { one_action: true }),
    spawnError: 'spawn C:\\work\\bin\\claude.exe EACCES',
  })
  const failed = await openSessionRequest(failing.options({ request: { session: ID } }))
  assert.equal(failed.reason, 'launch-failed')
  assert.ok(!JSON.stringify(failed).includes('EACCES'))
  assert.match(failing.logged.at(-1).fields.error, /EACCES/)
})

test("the owner's own command runs with the plan's session and folder", async () => {
  const box = machine({ plans: plan([FOCUS, LINK], { target: { kind: 'session', session: ID, agent: 'a1' } }) })
  const result = await openSessionRequest(
    box.options({
      request: { session: `${ID}:a1`, command: 'tool --root "{cwd}" --session {session}' },
    }),
  )
  assert.equal(result.ok, true)
  const started = effects(box.timeline)[0]
  assert.equal(started.spawn, TOOL)
  assert.deepEqual(started.args, ['--root', FOLDER, '--session', ID])
  assert.equal(started.options.cwd, FOLDER)

  const nowhere = machine({
    plans: plan([{ kind: 'open-link', scheme: 'codex', link: `codex://threads/${ID}` }]),
  })
  const noFolder = await openSessionRequest(
    nowhere.options({ request: { session: ID, command: 'tool "{cwd}"' } }),
  )
  assert.equal(noFolder.reason, 'no-folder')
  const tooLong = await openSessionRequest(
    nowhere.options({ request: { session: ID, command: 'x'.repeat(401) } }),
  )
  assert.equal(tooLong.reason, 'no-command')
})

test("the owner's command gets no folder Windows Terminal would split into two commands", async () => {
  // The owner's command may well be `wt`, which reads `;` as the start of another command.
  const folder = 'C:\\work\\my;folder'
  const box = machine({ plans: plan([{ ...FOCUS, folder }, LINK]) })
  const result = await openSessionRequest(
    box.options({ request: { session: ID, command: 'wt -d "{cwd}" cmd /k claude --resume {session}' } }),
  )
  assert.equal(result.reason, 'no-folder')
  assert.deepEqual(effects(box.timeline), [])
  const without = await openSessionRequest(
    box.options({ request: { session: ID, command: 'tool --session {session}' } }),
  )
  assert.equal(without.ok, true, 'a command that names no folder still runs')
  assert.equal(effects(box.timeline)[0].options.cwd, 'C:\\work\\home')
})

test("the owner's command runs the program on the PATH, never one in the session's folder", async () => {
  const box = machine({ plans: plan([FOCUS, LINK]) })
  await openSessionRequest(box.options({ request: { session: ID, command: 'tool {session}' } }))
  assert.equal(effects(box.timeline)[0].spawn, TOOL, 'a bare name runs from where the PATH has it')
  assert.equal(effects(box.timeline)[0].options.cwd, FOLDER)

  const missing = machine({ plans: plan([FOCUS, LINK]) })
  const result = await openSessionRequest(
    missing.options({ request: { session: ID, command: 'nowhere {session}' } }),
  )
  assert.equal(result.reason, 'launch-failed')
  assert.deepEqual(effects(missing.timeline), [], 'nothing starts when the PATH has no such program')

  const written = machine({ plans: plan([FOCUS, LINK]) })
  await openSessionRequest(
    written.options({ request: { session: ID, command: '"C:\\tools\\other.exe" {session}' } }),
  )
  assert.equal(effects(written.timeline)[0].spawn, 'C:\\tools\\other.exe', 'a path the owner wrote stands')
})

/** A session in a terminal, long silent: the plan the server answers, by what it was told. */
function silentPlans(query) {
  const explain = { kind: 'explain', reason: 'live-in-terminal' }
  const look = [{ kind: 'desktop-resume', session: ID }]
  if (query.liveness === 'live') return plan([explain, ...look], { state: 'live' })
  return plan(
    [
      { ...explain, silent_since: '2026-11-01T10:00:00Z' },
      ...look,
      { kind: 'resume-in-terminal', client: 'claude', session: ID, folder: FOLDER },
    ],
    { state: 'live' },
  )
}

test('a plan that offers to resume a silent session is taken, and its step runs only when named', async () => {
  const box = machine({ plans: silentPlans })
  const told = await openSessionRequest(
    box.options({ request: { session: ID }, liveness: () => '' }),
  )
  assert.equal(told.mode, 'explained')
  assert.equal(told.silent_since, '2026-11-01T10:00:00Z')
  assert.equal(told.next, 1)
  assert.deepEqual(box.timeline, ['fetch'])

  const resumed = await openSessionRequest(
    box.options({ request: { session: ID, step: 2 }, liveness: () => '' }),
  )
  assert.equal(resumed.mode, 'opened')
  assert.equal(box.timeline.at(-1).spawn, WT)
})

test('the registry saying the process is alive leaves no step to resume it with', async () => {
  const box = machine({ plans: silentPlans })
  const result = await openSessionRequest(
    box.options({ request: { session: ID, step: 2 }, liveness: registryWith(true) }),
  )
  assert.equal(result.mode, 'refused')
  assert.equal(result.reason, 'invalid-step')
  assert.equal(
    box.timeline.some((effect) => effect.spawn),
    false,
  )
  assert.deepEqual(
    box.queries.map((query) => query.liveness),
    [undefined, 'live'],
  )
})

test('a silence that is no time is refused with the rest of its plan', async () => {
  const box = machine({
    plans: plan([{ kind: 'explain', reason: 'live-in-terminal', silent_since: 'yesterday' }]),
  })
  const result = await openSessionRequest(box.options({ request: { session: ID } }))
  assert.equal(result.reason, 'invalid-plan')
})
