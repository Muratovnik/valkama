'use strict'

const fs = require('node:fs')
const { trustedTarget } = require('./project_registry')
const { resolveSupportedOpener } = require('./opener_catalog')

// Opening one observed agent session in its associated program. The renderer
// sends the raw target and opener choice; this side rebuilds the launch plan
// from scratch, so a compromised page can never hand the shell a prebuilt
// command line — the same trust boundary as the source opener.

const SESSION_ID = /^[0-9A-Za-z._:-]{4,128}$/
// Codex task identifiers currently use UUIDv7. Keep the accepted versions
// aligned with RFC 9562 instead of silently limiting launches to UUIDv1-v5.
const SESSION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const OPENER_KINDS = new Set(['vscode', 'codex-app', 'terminal', 'cursor', 'custom'])
const MAX_COMMAND = 400

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/** vscode://file/c:/path — the folder form VS Code's own URL handler accepts. */
function vscodeFolderUrl(dir) {
  const forward = dir.replace(/\\/g, '/').replace(/\/+$/, '')
  const rooted = forward.startsWith('/') ? forward : `/${forward}`
  return `vscode://file${encodeURI(rooted)}`
}

function codexThreadUrl(id) {
  return SESSION_UUID.test(id) ? `codex://threads/${id}` : ''
}

/** Split a custom template into argv, honoring double quotes, then substitute. */
function customArgv(template, target) {
  const tokens = template.match(/"[^"]*"|\S+/g) || []
  return tokens
    .map((token) => (token.startsWith('"') && token.endsWith('"') ? token.slice(1, -1) : token))
    .map((token) =>
      token
        .replaceAll('{session}', target.id)
        .replaceAll('{cwd}', target.cwd)
        .replaceAll('{session_cwd}', target.session_cwd || target.cwd),
    )
    .filter((token) => token.length > 0)
}

function display(argv) {
  return argv.map((part) => (/\s/.test(part) ? `"${part}"` : part)).join(' ')
}

/**
 * The validated launch plan for one request. Pure so tests can enumerate it:
 * `url` goes to the OS handler, `terminal` opens a console window through
 * cmd start, `spawn` runs the owner's own windowed program directly.
 */
function planSessionRequest(request, resolved = {}) {
  const id = text(request && request.id)
  const cwd = text(request && request.cwd)
  const opener = (request && request.opener) || {}
  if (!OPENER_KINDS.has(opener.kind)) return { mode: 'refused', reason: 'invalid-request' }
  if (id && !SESSION_ID.test(id)) return { mode: 'refused', reason: 'invalid-session' }
  if (opener.kind === 'codex-app') {
    if (text(request && request.client_family).toLowerCase() !== 'codex') {
      return { mode: 'refused', reason: 'unsupported-client' }
    }
    const url = codexThreadUrl(id)
    if (!url) return { mode: 'refused', reason: 'invalid-session' }
    if (resolved.availability !== 'available')
      return { mode: 'refused', reason: 'opener-unavailable' }
    return { mode: 'url', url }
  }
  if (opener.kind === 'vscode') {
    if (!cwd) return { mode: 'refused', reason: 'no-cwd' }
    return { mode: 'url', url: vscodeFolderUrl(cwd) }
  }
  if (opener.kind === 'cursor') {
    if (!cwd) return { mode: 'refused', reason: 'no-cwd' }
    if (!resolved.executable) return { mode: 'refused', reason: 'opener-unavailable' }
    const argv = [resolved.executable, cwd]
    return { mode: 'spawn', argv, cwd, display: `Cursor · ${cwd}` }
  }
  if (opener.kind === 'terminal') {
    if (!id) return { mode: 'refused', reason: 'no-session' }
    if (!resolved.executable) return { mode: 'refused', reason: 'opener-unavailable' }
    const family = text(request && request.client).toLowerCase()
    const resume = family.startsWith('claude')
      ? ['claude', '--resume', id]
      : family.startsWith('codex')
        ? ['codex', 'resume', id]
        : []
    if (!resume.length) return { mode: 'refused', reason: 'unsupported-client' }
    const argv = [resolved.executable, '-d', cwd, 'cmd.exe', '/k', ...resume]
    return { mode: 'spawn', argv, cwd, display: display(resume) }
  }
  const command = text(opener.command)
  if (!command || command.length > MAX_COMMAND) return { mode: 'refused', reason: 'no-command' }
  if (!id && command.includes('{session}')) return { mode: 'refused', reason: 'no-session' }
  const argv = customArgv(command, {
    id,
    cwd,
    session_cwd: text(request && request.session_cwd) || cwd,
  })
  if (!argv.length) return { mode: 'refused', reason: 'no-command' }
  return { mode: 'spawn', argv, cwd, display: display(argv) }
}

/** Resolves once the child actually started; ENOENT arrives as an event. */
function started(child) {
  return new Promise((resolve, reject) => {
    child.once('spawn', resolve)
    child.once('error', reject)
  })
}

async function openSessionRequest({
  senderUrl,
  appUrl,
  request,
  shell,
  spawn,
  directoryExists,
  readBytes,
  resolveOpener,
}) {
  if (typeof senderUrl !== 'string' || !senderUrl.startsWith(appUrl)) {
    return {
      ok: false,
      mode: 'refused',
      error: 'Session requests are limited to the Valkama app',
    }
  }
  const exists =
    typeof directoryExists === 'function'
      ? directoryExists
      : (directory) => {
          try {
            return fs.statSync(directory).isDirectory()
          } catch {
            return false
          }
        }
  const trusted = trustedTarget(request || {}, {
    readBytes,
    directoryExists: exists,
  })
  if (!trusted.effective_cwd || !exists(trusted.effective_cwd)) {
    return {
      ok: false,
      mode: 'refused',
      error: 'space-root-unavailable',
      source: trusted,
    }
  }
  // Renderer-supplied cwd is observational. The exact project binding result
  // above is the sole spawn authority on the Electron side.
  const resolve = typeof resolveOpener === 'function' ? resolveOpener : resolveSupportedOpener
  const resolved = resolve(request?.opener?.kind)
  const plan = planSessionRequest(
    {
      ...(request || {}),
      cwd: trusted.effective_cwd,
      session_cwd: trusted.session_cwd,
    },
    resolved,
  )
  if (plan.mode === 'refused') return { ok: false, mode: 'refused', error: plan.reason }
  try {
    if (plan.mode === 'url') {
      await shell.openExternal(plan.url)
      return {
        ok: true,
        mode: 'opened',
        command: plan.url,
        cwd: trusted.effective_cwd,
        source: trusted.source,
        status: trusted.status,
        fallback: Boolean(trusted.fallback),
      }
    }
    // The cwd was validated above. Never omit it: doing so would silently
    // inherit Electron's process directory and lose the trust boundary.
    const cwd = plan.cwd
    const child = spawn(plan.argv[0], plan.argv.slice(1), {
      cwd,
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    })
    await started(child)
    child.unref()
    return {
      ok: true,
      mode: 'opened',
      command: plan.display,
      cwd: trusted.effective_cwd,
      source: trusted.source,
      status: trusted.status,
      fallback: Boolean(trusted.fallback),
    }
  } catch (failure) {
    return {
      ok: false,
      mode: 'refused',
      error: failure instanceof Error ? failure.message : String(failure),
    }
  }
}

module.exports = {
  SESSION_ID,
  codexThreadUrl,
  customArgv,
  openSessionRequest,
  planSessionRequest,
  vscodeFolderUrl,
}
