'use strict'

/**
 * The startup decision, run against fake effects.
 *
 * What is protected: a process is stopped only when the listener is proven
 * managed and the owner asked; the child this app started is trusted on its
 * own answer, without an ownership query per poll; a child that exits early
 * is the error path, and one transition (the port changing hands mid-start)
 * is read again before anything is refused or offered.
 */

const assert = require('node:assert/strict')
const test = require('node:test')
const { establishServer, verifyStartedOwnership } = require('./server_startup')

const LAUNCHER = {
  directory: 'C:\\L',
  command: 'C:\\L\\valkama.cmd',
  shim: 'C:\\L\\valkama-launcher.py',
  manifest: 'C:\\L\\valkama-launcher.json',
  python: 'C:\\Py\\python.exe',
  sourceScript: 'C:\\R\\valkama.py',
}
const STATUS = {
  schema_version: 1,
  state: 'installed',
  source_available: true,
  directory: LAUNCHER.directory,
  command: LAUNCHER.command,
  shim: LAUNCHER.shim,
  manifest: LAUNCHER.manifest,
  python: LAUNCHER.python,
  source_script: LAUNCHER.sourceScript,
}
const EXPECTED = {
  interface_version: 'runtime',
  identity: 'a'.repeat(64),
  static: { sha256: 's1' },
  backend: { sha256: 'b1' },
}
const REBUILT = { ...EXPECTED, identity: 'b'.repeat(64), static: { sha256: 's2' } }
const ANSWER = (payload) => ({ reachable: true, payload })
const SILENT = { reachable: false, payload: null }
const OWNER = {
  free: { state: 'free', pid: null },
  managed: {
    state: 'managed',
    pid: 900,
    detail: 'port 8642 is owned by managed launcher process 900',
  },
  foreign: {
    state: 'foreign',
    pid: 77,
    detail: 'port 8642 is held by process 77; Valkama left it untouched.',
  },
}

/**
 * Fake effects. `owners` and `answers` are read in order, the last repeating;
 * a child is `{ ready }` (announces and answers EXPECTED), `{ exits }` (exits
 * with that code before answering) or `{ hangs }` (alive, never answers).
 */
function harness({
  owners = ['free'],
  answers = [SILENT],
  child = { ready: true },
  stop = 'stopped',
  status = STATUS,
  runtime = EXPECTED,
} = {}) {
  let clock = 0
  const calls = []
  const children = []
  const next = (list, index) => list[Math.min(index, list.length - 1)]
  let ownerReads = 0
  let probes = 0
  const deps = {
    launcher: LAUNCHER,
    bootstrapDetail: '',
    now: () => clock,
    sleep: (ms) =>
      new Promise((resolve) => {
        clock += ms
        setImmediate(resolve)
      }),
    log: () => {},
    readStatus: async () => {
      calls.push('status')
      return { payload: status, detail: '' }
    },
    readRuntime: async () => {
      calls.push('runtime')
      return { payload: runtime, detail: runtime ? '' : 'no runtime' }
    },
    readOwnership: async () => {
      calls.push('owner')
      const state = next(owners, ownerReads++)
      return state === 'unavailable'
        ? { payload: null, detail: 'could not inspect the process listening on port 8642' }
        : { payload: OWNER[state], detail: '' }
    },
    probe: async () => {
      calls.push('probe')
      const spawned = children.at(-1)
      if (spawned?.serving) return ANSWER(EXPECTED)
      return next(answers, probes++)
    },
    stopListener: async () => {
      calls.push('stop')
      return {
        payload: {
          state: stop,
          pid: 900,
          detail: stop === 'refused' ? 'listener ownership changed before stop' : '',
        },
        detail: '',
      }
    },
    spawnServer: () => {
      calls.push('spawn')
      let exit
      const record = {
        pid: 4242 + children.length,
        alive: true,
        serving: false,
        killed: false,
        exited: new Promise((resolve) => {
          exit = resolve
        }),
        announced: new Promise(() => {}),
        isAlive: () => record.alive,
        tail: () =>
          child.exits !== undefined ? 'OSError: [WinError 10048] address already in use' : '',
        kill: () => {
          record.killed = true
          record.alive = false
          exit({ code: 1 })
        },
      }
      if (child.ready) {
        record.serving = true
        record.announced = Promise.resolve()
      } else if (child.exits !== undefined) {
        record.alive = false
        exit({ code: child.exits })
      }
      children.push(record)
      return record
    },
  }
  return { deps, calls, children, count: (name) => calls.filter((call) => call === name).length }
}

test('a free port starts the server and trusts the child without polling ownership', async () => {
  const run = harness({ owners: ['free'] })
  const result = await establishServer(run.deps)
  assert.deepEqual(result, { ok: true, mode: 'started', pid: 4242 })
  assert.equal(run.count('spawn'), 1)
  assert.equal(run.count('owner'), 1, 'readiness is the child plus its answer, not another proof')
  assert.equal(run.count('stop'), 0)
})

test('the three launcher questions are asked together, before any answer is awaited', async () => {
  const run = harness()
  const order = []
  for (const name of ['readStatus', 'readRuntime', 'readOwnership']) {
    const original = run.deps[name]
    let first = true
    run.deps[name] = () => {
      order.push(`ask:${name}`)
      if (!first) return original()
      first = false
      return new Promise((resolve) => setImmediate(resolve)).then(() => {
        order.push(`answer:${name}`)
        return original()
      })
    }
  }
  await establishServer(run.deps)
  assert.deepEqual(order.slice(0, 3), ['ask:readStatus', 'ask:readRuntime', 'ask:readOwnership'])
})

test('a managed listener with the current runtime is reused, and nothing is started or stopped', async () => {
  const run = harness({ owners: ['managed'], answers: [ANSWER(EXPECTED)] })
  assert.deepEqual(await establishServer(run.deps), { ok: true, mode: 'reused', pid: 900 })
  assert.equal(run.count('spawn') + run.count('stop'), 0)
})

test('a stale managed listener is offered a restart, never restarted unasked', async () => {
  const run = harness({ owners: ['managed'], answers: [ANSWER(REBUILT)] })
  const result = await establishServer(run.deps)
  assert.equal(result.phase, 'stale')
  assert.deepEqual(result.reasons, ['front-end'])
  assert.equal(run.count('stop') + run.count('spawn'), 0)
})

test('when the owner asks, only a managed listener is stopped, then the server starts', async () => {
  const run = harness({ owners: ['managed', 'free'], answers: [ANSWER(REBUILT)] })
  const result = await establishServer(run.deps, { allowRestart: true })
  assert.deepEqual(result, { ok: true, mode: 'started', pid: 4242 })
  assert.deepEqual(
    run.calls.filter((call) => ['stop', 'spawn'].includes(call)),
    ['stop', 'spawn'],
  )
})

test('a foreign listener is refused and left untouched, even when the owner asked to restart', async () => {
  for (const answer of [ANSWER(EXPECTED), ANSWER(REBUILT), SILENT]) {
    const run = harness({ owners: ['foreign'], answers: [answer] })
    const result = await establishServer(run.deps, { allowRestart: true })
    assert.equal(result.phase, 'failed')
    assert.equal(result.kind, 'foreign')
    assert.match(result.detail, /left it untouched/)
    assert.equal(run.count('stop') + run.count('spawn'), 0)
  }
})

test('a stop the launcher refuses is reported, and nothing is started', async () => {
  const run = harness({ owners: ['managed'], answers: [ANSWER(REBUILT)], stop: 'refused' })
  const result = await establishServer(run.deps, { allowRestart: true })
  assert.equal(result.kind, 'foreign')
  assert.equal(run.count('spawn'), 0)
})

test('ownership that cannot be read is never treated as a free port', async () => {
  const run = harness({ owners: ['unavailable'] })
  const result = await establishServer(run.deps)
  assert.equal(result.kind, 'unverified')
  assert.equal(run.count('spawn') + run.count('stop'), 0)
})

test('a child that exits before it is ready is the error path, with its last words', async () => {
  const run = harness({ owners: ['free', 'free'], child: { exits: 1 } })
  const result = await establishServer(run.deps)
  assert.equal(result.kind, 'server-exited')
  assert.match(result.detail, /code 1/)
  assert.match(result.detail, /10048/)
  assert.equal(run.count('spawn'), 1, 'one transition re-read, not a respawn loop')
})

test('a child that lost the port to another start reuses the server that won it', async () => {
  const run = harness({
    owners: ['free', 'managed'],
    answers: [ANSWER(EXPECTED)],
    child: { exits: 1 },
  })
  assert.deepEqual(await establishServer(run.deps), { ok: true, mode: 'reused', pid: 900 })
  assert.equal(run.count('stop'), 0)
})

test('a managed listener that has not answered yet is read again before it is called stale', async () => {
  const run = harness({ owners: ['managed'], answers: [SILENT, ANSWER(EXPECTED)] })
  assert.deepEqual(await establishServer(run.deps), { ok: true, mode: 'reused', pid: 900 })
  const silent = harness({ owners: ['managed'], answers: [SILENT] })
  const result = await establishServer(silent.deps)
  assert.equal(result.phase, 'stale')
  assert.deepEqual(result.reasons, ['unreadable'])
  assert.equal(silent.count('stop'), 0)
})

test('a child that never answers is stopped when the wait ends', async () => {
  const run = harness({ owners: ['free'], child: { hangs: true } })
  const result = await establishServer(run.deps, { readyTimeoutMs: 5000 })
  assert.equal(result.kind, 'timeout')
  assert.equal(run.children[0].killed, true)
})

test('a launcher whose status does not match its manifest is refused before anything runs', async () => {
  const run = harness({ status: { ...STATUS, shim: 'C:\\Elsewhere\\valkama-launcher.py' } })
  const result = await establishServer(run.deps)
  assert.equal(result.kind, 'launcher')
  assert.match(result.detail, /launcher install/)
  assert.equal(run.count('spawn') + run.count('stop'), 0)
  const missing = await establishServer({
    launcher: null,
    bootstrapDetail: 'the managed launcher manifest is missing or malformed',
  })
  assert.equal(missing.kind, 'launcher')
  assert.match(missing.detail, /manifest is missing/)
})

test('the ownership proof after load names whether the port is the started child', async () => {
  const run = harness({ owners: ['managed'] })
  assert.equal((await verifyStartedOwnership(run.deps, 900)).verified, true)
  assert.equal((await verifyStartedOwnership(run.deps, 4242)).verified, false)
  const foreign = harness({ owners: ['foreign'] })
  assert.deepEqual(
    { ...(await verifyStartedOwnership(foreign.deps, 77)), detail: '' },
    { verified: false, state: 'foreign', pid: 77, detail: '' },
  )
})
