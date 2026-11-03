'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { EDITORS, editorExecutable, findExecutable } = require('./opener_catalog')

// Carrying out what a click on a session, a file or a folder opens.
//
// The page names only its target and the owner's settings. Where it goes is the
// server's plan (`GET /api/open-plan`), which this side fetches itself, checks
// step by step against closed lists, and only then carries out. Nothing the page
// sends becomes a link, a program or an argument, so a compromised page can ask
// for no more than a click in the app could. The one exception is the owner's
// own command, which has no step in the plan and is carried out here as before.

// A leading letter or digit: an id that began with `-` would reach a command line as a flag.
const SESSION_ID = /^[0-9A-Za-z][0-9A-Za-z._:-]{3,127}$/
/** What the settings may name, for the fallback and for "always open in". */
const OPEN_PLACES = Object.freeze([
  'vscode',
  'vscode-insiders',
  'cursor',
  'windsurf',
  'terminal',
  'claude-desktop',
  'codex-app',
])
const SCHEMES = Object.freeze([...EDITORS, 'claude', 'codex', 'claude-cli'])
/** Every reason an `explain` step can give, as the server's planner names them. */
const REASONS = Object.freeze([
  'no-session',
  'invalid-session',
  'unsupported-client',
  'gone',
  'live-headless',
  'live-in-terminal',
  'live-elsewhere',
  'no-folder',
  'not-installed',
  'path-refused',
])
/** Why this side opened nothing; the page has words for each, and never an exception's text. */
const REFUSALS = Object.freeze([
  'not-app',
  'invalid-request',
  'plan-unavailable',
  'invalid-plan',
  'invalid-step',
  'not-installed',
  'launch-failed',
  'window-not-confirmed',
  'no-folder',
  'no-command',
])
const RESUME = Object.freeze({
  claude: (id) => ['claude', '--resume', id],
  codex: (id) => ['codex', 'resume', id],
})
const COPY_TEXT = /^(?:claude --resume|codex resume|claude --desktop --resume) [0-9A-Za-z][0-9A-Za-z._:-]{3,127}$/
const DETAIL = Object.freeze({
  host: (value) => typeof value === 'string' && /^[a-z][a-z-]{0,31}$/.test(value),
  archived: (value) => typeof value === 'boolean',
  code: (value) => typeof value === 'string' && /^[a-z_]{1,32}$/.test(value),
})
const CONTROL = /[\u0000-\u001f\u007f]/
const MAX_STEPS = 8
const MAX_LINK = 4096
const MAX_COMMAND = 400
const MAX_TEXT = 1024
/** How long after a window opens before a link is sent, so it reaches that window. */
const PAUSE_MS = 300
/** A running editor's second instance exits once the window is open; a first one never does. */
const WINDOW_WAIT_MS = 15000

class Refusal extends Error {
  constructor(reason, detail = {}) {
    super(reason)
    this.reason = reason
    this.detail = detail
  }
}

function sessionId(value) {
  return typeof value === 'string' && SESSION_ID.test(value)
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function onlyKeys(value, allowed) {
  return plainObject(value) && Object.keys(value).every((key) => allowed.includes(key))
}

function text(value, max) {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !CONTROL.test(value)
}

function choice(value) {
  return value === undefined || value === '' || OPEN_PLACES.includes(value)
}

/**
 * The page's request, reduced to the query the plan is asked with, or null.
 *
 * `{session, fallback?, always?, step?}`, `{path: {kind, project, path, line?},
 * fallback?, step?}` or the owner's command `{session, command}`; any other key,
 * a URL, an argv or an opener included, refuses the whole request.
 */
function parseRequest(raw) {
  if (!plainObject(raw)) return null
  const step = raw.step
  if (step !== undefined && !(Number.isInteger(step) && step >= 0 && step < MAX_STEPS)) return null
  if (Object.hasOwn(raw, 'command')) {
    if (!onlyKeys(raw, ['session', 'command']) || !sessionId(raw.session)) return null
    if (typeof raw.command !== 'string') return null
    return { custom: raw.command, query: { target: 'session', session: raw.session } }
  }
  if (Object.hasOwn(raw, 'session')) {
    if (!onlyKeys(raw, ['session', 'fallback', 'always', 'step'])) return null
    if (!sessionId(raw.session) || !choice(raw.fallback) || !choice(raw.always)) {
      return null
    }
    const query = { target: 'session', session: raw.session }
    if (raw.fallback) query.fallback = raw.fallback
    if (raw.always) query.always = raw.always
    return { step, query, session: true }
  }
  if (!onlyKeys(raw, ['path', 'fallback', 'step']) || !choice(raw.fallback)) return null
  const target = raw.path
  if (!onlyKeys(target, ['kind', 'project', 'path', 'line'])) return null
  if (target.kind !== 'file' && target.kind !== 'folder') return null
  if (!text(target.project, 256) || !text(target.path, MAX_TEXT)) return null
  const line = target.line
  if (line !== undefined && line !== null) {
    if (target.kind !== 'file' || !Number.isInteger(line) || line < 1 || line > 999999999) {
      return null
    }
  }
  const query = { target: target.kind, project: target.project, path: target.path }
  if (line) query.line = String(line)
  if (raw.fallback) query.fallback = raw.fallback
  return { step, query, session: false }
}

/** An existing local folder by its drive: no network path, no way back up. */
function usableFolder(folder, isDirectory) {
  if (!text(folder, MAX_TEXT) || !/^[A-Za-z]:[\\/]/.test(folder)) return false
  return !folder.split(/[\\/]/).includes('..') && isDirectory(folder)
}

function usableFile(file, isFile) {
  if (!text(file, MAX_TEXT) || !/^[A-Za-z]:[\\/]/.test(file)) return false
  return !file.split(/[\\/]/).includes('..') && isFile(file)
}

function exactly(step, keys) {
  const present = Object.keys(step)
  return present.length === keys.length && keys.every((key) => Object.hasOwn(step, key))
}

/** Whether one step is a step this side carries out, with every field as the contract says. */
function validStep(step, checks) {
  if (!plainObject(step)) return false
  switch (step.kind) {
    case 'focus-folder':
      return (
        exactly(step, ['kind', 'ide', 'folder']) &&
        EDITORS.includes(step.ide) &&
        usableFolder(step.folder, checks.isDirectory)
      )
    case 'open-link':
      return (
        exactly(step, ['kind', 'scheme', 'link']) &&
        SCHEMES.includes(step.scheme) &&
        text(step.link, MAX_LINK) &&
        !/\s/.test(step.link) &&
        step.link.startsWith(`${step.scheme}://`)
      )
    case 'resume-in-terminal':
      return (
        exactly(step, ['kind', 'client', 'session', 'folder']) &&
        Object.hasOwn(RESUME, step.client) &&
        sessionId(step.session) &&
        // Windows Terminal reads `;` anywhere on its command line as the start of
        // another command, so a folder named with one would run what follows it.
        !String(step.folder).includes(';') &&
        usableFolder(step.folder, checks.isDirectory)
      )
    case 'desktop-resume':
      return exactly(step, ['kind', 'session']) && sessionId(step.session)
    case 'open-file':
      return (
        exactly(step, ['kind', 'ide', 'path', 'line']) &&
        EDITORS.includes(step.ide) &&
        (step.line === null || (Number.isInteger(step.line) && step.line > 0)) &&
        usableFile(step.path, checks.isFile)
      )
    case 'copy':
      return exactly(step, ['kind', 'text']) && typeof step.text === 'string' && COPY_TEXT.test(step.text)
    case 'explain':
      return (
        REASONS.includes(step.reason) &&
        Object.keys(step).every(
          (key) => key === 'kind' || key === 'reason' || (Object.hasOwn(DETAIL, key) && DETAIL[key](step[key])),
        )
      )
    default:
      return false
  }
}

/** The plan's steps when every one of them passes, or null: one bad step and nothing runs. */
function validPlan(plan, checks) {
  if (!plainObject(plan) || plan.surface !== 'desktop' || !Array.isArray(plan.steps)) return null
  if (plan.steps.length === 0 || plan.steps.length > MAX_STEPS) return null
  return plan.steps.every((step) => validStep(step, checks)) ? plan.steps : null
}

/** The environment a started program gets: never told to run as plain Node. */
function childEnvironment(env) {
  const copy = { ...env }
  delete copy.ELECTRON_RUN_AS_NODE
  return copy
}

/**
 * Start one program. With `waitMs` it resolves once the program exits, or with
 * `exited: false` when it is still running then; without, once it has started.
 */
function launch(context, file, args, { cwd, hidden = false, waitMs = 0 }) {
  return new Promise((resolve, reject) => {
    let settled = false
    let timer = null
    let child
    const settle = (outcome, value) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      child?.unref?.()
      outcome(value)
    }
    try {
      child = context.spawn(file, args, {
        cwd,
        detached: true,
        stdio: 'ignore',
        windowsHide: hidden,
        env: childEnvironment(context.env),
      })
    } catch (error) {
      reject(error)
      return
    }
    child.once('error', (error) => settle(reject, error))
    child.once('spawn', () => {
      if (!waitMs) settle(resolve, { exited: false })
      else timer = setTimeout(() => settle(resolve, { exited: false }), waitMs)
    })
    if (waitMs) child.once('exit', () => settle(resolve, { exited: true }))
  })
}

async function runStep(step, context, linkFollows) {
  if (step.kind === 'explain') return
  if (step.kind === 'open-link') {
    await context.shell.openExternal(step.link)
    return
  }
  if (step.kind === 'copy') {
    context.clipboard.writeText(step.text)
    return
  }
  if (step.kind === 'focus-folder') {
    const editor = context.editorExecutable(step.ide)
    if (!editor) throw new Refusal('not-installed', { host: step.ide })
    const waitMs = linkFollows ? context.windowWaitMs : 0
    const started = await launch(context, editor, [step.folder], { cwd: step.folder, waitMs })
    if (!linkFollows) return
    // The link goes to the window in focus: sent before the window is there, it
    // starts an empty conversation in another one, so nothing is sent unconfirmed.
    if (!started.exited) throw new Refusal('window-not-confirmed')
    await context.sleep(PAUSE_MS)
    return
  }
  if (step.kind === 'open-file') {
    const editor = context.editorExecutable(step.ide)
    if (!editor) throw new Refusal('not-installed', { host: step.ide })
    const target = step.line ? `${step.path}:${step.line}` : step.path
    await launch(context, editor, ['-g', target], { cwd: path.dirname(step.path) })
    return
  }
  if (step.kind === 'resume-in-terminal') {
    const terminal = context.findExecutable('wt.exe')
    if (!terminal) throw new Refusal('not-installed', { host: 'terminal' })
    const argv = ['-d', step.folder, 'cmd.exe', '/k', ...RESUME[step.client](step.session)]
    await launch(context, terminal, argv, { cwd: step.folder })
    return
  }
  // desktop-resume: the CLI hands the session to Claude Desktop, with no window of its own.
  const cli = context.findExecutable('claude.exe')
  if (!cli) throw new Refusal('not-installed', { host: 'claude-cli' })
  await launch(context, cli, ['--desktop', '--resume', step.session], {
    cwd: context.home,
    hidden: true,
  })
}

function refused(reason, extra = {}) {
  return { ok: false, mode: 'refused', reason, next: null, ...extra }
}

function explained(step, plan, next) {
  const { kind: _kind, ...detail } = step
  return { ok: false, mode: 'explained', ...detail, next, plan }
}

async function fetchPlan(context, query) {
  const answer = await context.fetchPlan({ ...query, surface: 'desktop' })
  if (answer?.status !== 200) {
    context.log('open-plan-refused', { status: answer?.status ?? 0 })
    return null
  }
  try {
    const plan = JSON.parse(answer.body)
    return plainObject(plan) ? plan : null
  } catch {
    return null
  }
}

/**
 * The plan, asked again with the process's own state when Claude Code's
 * registry of running sessions says otherwise than the server's row (D3).
 */
async function planWithLiveness(context, parsed) {
  const plan = await fetchPlan(context, parsed.query)
  if (!plan || !parsed.session || plan.client !== 'claude') return plan
  if (plan.state !== 'live' && plan.state !== 'ended') return plan
  const session = plan.target?.session
  if (!sessionId(session)) return plan
  const verdict = context.liveness(session)
  if (verdict !== 'live' && verdict !== 'ended') return plan
  if (verdict === plan.state) return plan
  return fetchPlan(context, { ...parsed.query, liveness: verdict })
}

/** Split the owner's template into argv, honoring double quotes, then substitute. */
function customArgv(template, target) {
  const tokens = template.match(/"[^"]*"|\S+/g) || []
  return tokens
    .map((token) => (token.startsWith('"') && token.endsWith('"') ? token.slice(1, -1) : token))
    .map((token) =>
      token
        .replaceAll('{session}', target.session)
        .replaceAll('{cwd}', target.folder)
        .replaceAll('{session_cwd}', target.folder),
    )
    .filter((token) => token.length > 0)
}

async function runCustom(context, parsed, checks) {
  const template = parsed.custom.trim()
  if (!template || template.length > MAX_COMMAND) return refused('no-command')
  const plan = await fetchPlan(context, parsed.query)
  if (!plan) return refused('plan-unavailable')
  const session = plan.target?.session
  if (plan.state === 'none' || plan.state === 'gone' || !sessionId(session)) {
    const first = Array.isArray(plan.steps) ? plan.steps[0] : null
    return validStep(first, checks) && first.kind === 'explain'
      ? explained(first, plan, null)
      : refused('invalid-plan')
  }
  const steps = Array.isArray(plan.steps) ? plan.steps : []
  const folder =
    steps
      .map((step) => (plainObject(step) ? step.folder : ''))
      .find((candidate) => usableFolder(candidate, checks.isDirectory)) || ''
  if (!folder && /\{(?:session_)?cwd\}/.test(template)) return refused('no-folder')
  const argv = customArgv(template, { session, folder })
  if (!argv.length) return refused('no-command')
  try {
    await launch(context, argv[0], argv.slice(1), { cwd: folder || context.home })
  } catch (failure) {
    context.log('open-session-failed', { step: 'custom', error: failure?.message })
    return refused('launch-failed')
  }
  return { ok: true, mode: 'opened', next: null, plan }
}

function defaultIsDirectory(dir) {
  try {
    return fs.statSync(dir).isDirectory()
  } catch {
    return false
  }
}

function defaultIsFile(file) {
  try {
    return fs.statSync(file).isFile()
  } catch {
    return false
  }
}

/**
 * One click from the page. `step` names a step of the server's plan to carry
 * out on its own: a plan that is not `one_action` takes one action from the
 * person per step, and the answer's `next` says which step that is.
 */
async function openSessionRequest(options) {
  const { senderUrl, appUrl, request } = options
  if (typeof senderUrl !== 'string' || !senderUrl.startsWith(appUrl)) return refused('not-app')
  const context = {
    shell: options.shell,
    clipboard: options.clipboard,
    spawn: options.spawn,
    fetchPlan: options.fetchPlan,
    liveness: options.liveness || (() => ''),
    editorExecutable: options.editorExecutable || editorExecutable,
    findExecutable: options.findExecutable || findExecutable,
    sleep: options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    log: options.log || (() => {}),
    env: options.env || process.env,
    home: options.home || os.homedir(),
    windowWaitMs: options.windowWaitMs || WINDOW_WAIT_MS,
  }
  const checks = {
    isDirectory: options.isDirectory || defaultIsDirectory,
    isFile: options.isFile || defaultIsFile,
  }
  const parsed = parseRequest(request)
  if (!parsed) return refused('invalid-request')
  if (parsed.custom !== undefined) return runCustom(context, parsed, checks)

  const plan = await planWithLiveness(context, parsed)
  if (!plan) return refused('plan-unavailable')
  const steps = validPlan(plan, checks)
  if (!steps) {
    const failing = Array.isArray(plan.steps)
      ? plan.steps.find((step) => !validStep(step, checks))
      : null
    context.log('open-plan-invalid', { step: plainObject(failing) ? String(failing.kind) : '' })
    return refused('invalid-plan')
  }
  const start = parsed.step ?? 0
  if (start >= steps.length) return refused('invalid-step', { plan })
  const end = parsed.step === undefined && plan.one_action === true ? steps.length : start + 1
  const nextOf = (index) => (index < steps.length ? index : null)

  for (let index = start; index < end; index += 1) {
    const step = steps[index]
    if (step.kind === 'explain') return explained(step, plan, nextOf(index + 1))
    try {
      await runStep(step, context, index + 1 < end && steps[index + 1].kind === 'open-link')
    } catch (failure) {
      if (failure instanceof Refusal) {
        // A window that did not confirm still leaves the link for the person to send.
        const next = failure.reason === 'window-not-confirmed' ? nextOf(index + 1) : null
        return refused(failure.reason, { ...failure.detail, next, plan })
      }
      context.log('open-session-failed', { step: step.kind, error: failure?.message })
      return refused('launch-failed', { plan })
    }
  }
  const last = steps[end - 1]
  if (last.kind === 'copy') {
    return { ok: true, mode: 'copied', command: last.text, next: nextOf(end), plan }
  }
  return { ok: true, mode: 'opened', next: nextOf(end), plan }
}

module.exports = {
  OPEN_PLACES,
  PAUSE_MS,
  REASONS,
  REFUSALS,
  SCHEMES,
  SESSION_ID,
  customArgv,
  openSessionRequest,
  parseRequest,
  validPlan,
}
