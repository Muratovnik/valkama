'use strict'

// How the window gets a server: reuse the managed one, start one, or say why
// neither is possible -- the one place that decides it. The tray used to run
// the same checks first and decide alone, which is how two deciders, each
// reading the port at a different moment of the same startup, ended in a
// "Restart it now?" aimed at the server this app had just started.
//
// Every effect is passed in, so the sequence is testable as it runs: which
// questions are asked in parallel, when a process may be stopped (only a
// managed listener, only when the owner asked), and what counts as ready.

const {
  launcherStatusMatches,
  listenerLifecycleAction,
  runtimeMatches,
  staleReasons,
} = require('./runtime_contract')

const HTTP_PROBE_MS = 700
const READY_PROBE_MS = 500
const READY_POLL_MS = 1000
const READY_TIMEOUT_MS = 60000
const RELEASE_WAIT_ATTEMPTS = 25
const RELEASE_WAIT_MS = 200
const TRANSITION_WAIT_MS = 400

function failed(kind, detail) {
  return { ok: false, phase: 'failed', kind, detail: String(detail || '').trim() }
}

const LAUNCHER_REMEDY = 'Run "python valkama.py launcher install" from the current checkout.'

/**
 * Wait for the child this app started to serve the expected runtime.
 *
 * The child is trusted because it is ours: a live process plus a matching
 * `/api/runtime` answer is readiness, and no ownership query runs on this
 * path. The server announces its listener on stderr the moment it binds, so
 * the first probe is aimed at that moment; a slow poll covers a release that
 * does not announce. The child exiting first -- a port it could not bind, a
 * store it could not open -- is the error path, with its last words.
 */
async function awaitChild(deps, child, expected, timeoutMs) {
  const deadline = deps.now() + timeoutMs
  const exited = child.exited.then((exit) => ({ exit }))
  let announced = child.announced.then(() => ({ announced: true }))
  const exitedFailure = (exit) =>
    failed(
      'server-exited',
      [
        `the Valkama server exited${exit?.code === null || exit?.code === undefined ? '' : ` with code ${exit.code}`} before it was ready`,
        exit?.error || '',
        child.tail(),
      ]
        .filter(Boolean)
        .join('\n'),
    )
  while (deps.now() < deadline) {
    const woke = await Promise.race([
      exited,
      announced,
      deps.sleep(READY_POLL_MS).then(() => ({ tick: true })),
    ])
    if (woke.exit) return exitedFailure(woke.exit)
    if (woke.announced) announced = new Promise(() => {})
    const observed = await deps.probe(READY_PROBE_MS)
    if (!child.isAlive()) return exitedFailure(await child.exited)
    if (observed.reachable && runtimeMatches(expected, observed.payload)) {
      return { ok: true, mode: 'started', pid: child.pid }
    }
  }
  child.kill()
  return failed(
    'timeout',
    `the Valkama server did not expose the expected runtime identity within ${Math.round(timeoutMs / 1000)} s\n${child.tail()}`,
  )
}

async function waitForRelease(deps) {
  for (let attempt = 0; attempt < RELEASE_WAIT_ATTEMPTS; attempt += 1) {
    await deps.sleep(RELEASE_WAIT_MS)
    const reading = await deps.readOwnership()
    if (!reading.payload) {
      return {
        failure: failed(
          'unverified',
          reading.detail || 'listener ownership could not be verified after stop',
        ),
      }
    }
    if (reading.payload.state === 'free') return { owner: reading }
    if (reading.payload.state === 'foreign')
      return { failure: failed('foreign', reading.payload.detail) }
  }
  return { failure: failed('stop-failed', 'the managed listener did not release the port') }
}

/**
 * Find or start the server the window will load.
 *
 * Answers `{ ok: true, mode: 'reused' | 'started' }`, `{ phase: 'stale' }` for
 * a managed listener of another runtime (the restart is offered, never taken
 * unasked), or `{ phase: 'failed', kind }`.
 */
async function establishServer(
  deps,
  { allowRestart = false, readyTimeoutMs = READY_TIMEOUT_MS } = {},
) {
  if (!deps.launcher) return failed('launcher', `${deps.bootstrapDetail}. ${LAUNCHER_REMEDY}`)
  const started = deps.now()
  const spent = {}
  const timed = (name, promise) =>
    promise.then((value) => {
      spent[name] = deps.now() - started
      return value
    })
  // Independent questions, asked at once. The HTTP answer is awaited only if
  // something holds the port: on Windows a refused loopback connect costs
  // its whole timeout, and a free port needs no answer from anyone.
  let observed = timed('http', deps.probe(HTTP_PROBE_MS))
  const [status, runtime, ownership] = await Promise.all([
    timed('status', deps.readStatus()),
    timed('runtime', deps.readRuntime()),
    timed('owner', deps.readOwnership()),
  ])
  deps.log('probed', { ...spent, owner: ownership.payload?.state })
  if (!launcherStatusMatches(deps.launcher, status.payload)) {
    return failed(
      'launcher',
      `${status.detail || 'managed launcher status did not match its manifest'}. ${LAUNCHER_REMEDY}`,
    )
  }
  if (!runtimeMatches(runtime.payload, runtime.payload)) {
    return failed(
      'runtime',
      `could not calculate the managed runtime identity: ${runtime.detail || 'the managed launcher returned a malformed runtime identity'}`,
    )
  }
  const expected = runtime.payload
  let owner = ownership
  let restarted = false
  let rechecked = false
  let respawned = false
  for (;;) {
    if (!owner.payload) {
      return failed(
        'unverified',
        owner.detail || 'could not verify the process listening on the port',
      )
    }
    if (owner.payload.state === 'free') {
      const child = deps.spawnServer()
      deps.log('server-spawned', { pid: child.pid })
      const outcome = await awaitChild(deps, child, expected, readyTimeoutMs)
      if (outcome.ok || outcome.kind !== 'server-exited' || respawned) return outcome
      // The port was free when read and taken when bound: another start won
      // the race. Read it again once; that server may be the one to reuse.
      respawned = true
      deps.log('in-transition', { reason: 'spawned server exited' })
      owner = await deps.readOwnership()
      observed = deps.probe(HTTP_PROBE_MS)
      if (owner.payload?.state === 'free') return outcome
      continue
    }
    const listener = await observed
    if (owner.payload.state === 'managed' && !listener.reachable && !rechecked) {
      // A managed listener that does not answer yet is most likely one that
      // has just bound. Look once more before calling it stale.
      rechecked = true
      deps.log('in-transition', { reason: 'managed listener did not answer' })
      await deps.sleep(TRANSITION_WAIT_MS)
      observed = deps.probe(HTTP_PROBE_MS * 2)
      owner = await deps.readOwnership()
      continue
    }
    const plan = listenerLifecycleAction(expected, listener, owner.payload)
    deps.log('decided', { action: plan.action, owner: owner.payload.state, pid: owner.payload.pid })
    if (plan.action === 'reuse') return { ok: true, mode: 'reused', pid: owner.payload.pid }
    if (plan.action === 'refuse') {
      return failed(owner.payload.state === 'foreign' ? 'foreign' : 'unverified', plan.reason)
    }
    if (plan.action !== 'restart') return failed('unverified', plan.reason)
    if (!allowRestart || restarted) {
      return {
        ok: false,
        phase: 'stale',
        reasons: staleReasons(expected, listener.reachable ? listener.payload : null),
        detail: plan.reason,
      }
    }
    // The owner asked. The launcher re-reads the listener's process identity
    // under a held handle before it stops anything; an HTTP answer is never
    // stop authority.
    restarted = true
    const stopped = await deps.stopListener()
    deps.log('stopped', { state: stopped.payload?.state, pid: stopped.payload?.pid })
    if (!stopped.payload || !['stopped', 'free'].includes(stopped.payload.state)) {
      return failed(
        stopped.payload?.state === 'refused' ? 'foreign' : 'stop-failed',
        stopped.payload?.detail ||
          stopped.detail ||
          'the managed listener could not be stopped safely',
      )
    }
    const released = await waitForRelease(deps)
    if (released.failure) return released.failure
    owner = released.owner
  }
}

/** After the UI is up: does the port belong to the child this app started? */
async function verifyStartedOwnership(deps, pid) {
  const reading = await deps.readOwnership()
  const state = reading.payload?.state || 'unavailable'
  return {
    verified: state === 'managed' && reading.payload.pid === pid,
    state,
    pid: reading.payload?.pid,
    detail: reading.payload?.detail || reading.detail || '',
  }
}

module.exports = { HTTP_PROBE_MS, establishServer, verifyStartedOwnership }
