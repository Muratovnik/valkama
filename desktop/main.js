'use strict'

// Native window for Valkama. The product itself stays where it is: this process
// only makes sure the local Python server is listening and shows its page in a
// Chromium window, so nothing here duplicates what the page already does.
//
// The window comes first. It used to be created only after every check had
// passed, so a click showed nothing for seconds and a failure arrived as the
// first sign of life. Now it opens on app-ready with a starting page, the
// server is found or started behind it, and the same window then shows
// Valkama, or the failure and its remedy.

const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron')
const { spawn } = require('node:child_process')
const { createHash } = require('node:crypto')
const { readFileSync, statSync, writeFileSync } = require('node:fs')
const { request: httpRequest } = require('node:http')
const os = require('node:os')
const path = require('node:path')
const {
  LAUNCHER_COMMAND_NAME,
  LAUNCHER_MANIFEST_NAME,
  LAUNCHER_SHIM_NAME,
  parseJsonObject,
  parseRuntimeJson,
  validateLauncherBootstrap,
} = require('./runtime_contract')
const { discoverSupportedOpeners, resolveSupportedOpener } = require('./opener_catalog')
const { establishServer, verifyStartedOwnership } = require('./server_startup')
const { openSessionRequest } = require('./session_opener')
const { openSourceRequest } = require('./source_opener')
const { createStartupLog } = require('./startup_log')
const { resolveLocale, startupAction, startupPageUrl } = require('./startup_page')

const PORT = Number(process.env.VALKAMA_PORT || 8642)
const HOST = '127.0.0.1'
const URL = `http://${HOST}:${PORT}/`

const exeStartedAt = process.getCreationTime?.() ?? Date.now() - process.uptime() * 1000
const log = createStartupLog({ directory: os.tmpdir(), pid: process.pid, startedAt: exeStartedAt })
log('main-start', { port: PORT, packaged: app.isPackaged })

// The stable launcher is the desktop's only server identity. Its manifest is
// verified before its Python/shim pair is invoked, and the launcher's own
// status command confirms the same paths. A checkout move updates that one
// manifest; neither this app nor a running listener changes identity.
function fileExists(file) {
  try {
    return statSync(file).isFile()
  } catch {
    return false
  }
}

function fileState(file) {
  try {
    return {
      exists: statSync(file).isFile(),
      sha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
    }
  } catch {
    return { exists: false, sha256: '' }
  }
}

function readLauncherBootstrap() {
  const localAppData = process.env.LOCALAPPDATA || ''
  const directory = localAppData ? path.join(localAppData, 'Valkama', 'bin') : ''
  const manifestPath = directory ? path.join(directory, LAUNCHER_MANIFEST_NAME) : ''
  let manifest = null
  try {
    manifest = parseJsonObject(readFileSync(manifestPath, 'utf8'))
  } catch {
    // The validator below owns the actionable failure wording.
  }
  return validateLauncherBootstrap({
    directory,
    manifest,
    fileState: {
      [LAUNCHER_COMMAND_NAME]: fileState(path.join(directory, LAUNCHER_COMMAND_NAME)),
      [LAUNCHER_SHIM_NAME]: fileState(path.join(directory, LAUNCHER_SHIM_NAME)),
    },
    pythonExists: fileExists(manifest?.python || ''),
    sourceExists: fileExists(manifest?.source_script || ''),
  })
}

const launcherBootstrap = readLauncherBootstrap()
const launcherCandidate = launcherBootstrap.launcher

/** A process we started ourselves, and are therefore allowed to stop. */
let serverProcess = null
let mainWindow = null
/** What the starting page offers right now; a remedy link outside it is ignored. */
let offeredActions = []
/** The one startup in flight, so a second request joins it instead of racing it. */
let starting = null
let focusWhenCreated = false
let uiLoadedOnce = false

function isValkamaSender(event) {
  const senderUrl = event.senderFrame?.url || event.sender.getURL()
  return typeof senderUrl === 'string' && senderUrl.startsWith(URL)
}

ipcMain.handle('valkama:open-source', async (event, request) => {
  const senderUrl = event.senderFrame?.url || event.sender.getURL()
  return openSourceRequest({ senderUrl, appUrl: URL, request, shell })
})

function directoryExists(dir) {
  try {
    return statSync(dir).isDirectory()
  } catch {
    return false
  }
}

function protocolAvailability(protocol) {
  try {
    return app.getApplicationNameForProtocol(`${protocol}://`) ? 'available' : 'unavailable'
  } catch {
    return 'unknown'
  }
}

ipcMain.handle('valkama:open-session', async (event, request) => {
  const senderUrl = event.senderFrame?.url || event.sender.getURL()
  return openSessionRequest({
    senderUrl,
    appUrl: URL,
    request,
    shell,
    spawn,
    directoryExists,
    resolveOpener(kind) {
      return resolveSupportedOpener(kind, { protocolAvailability })
    },
    // The Electron main process resolves the exact planning resource itself.
    // The renderer's opaque IPC request is never accepted as spawn authority.
  })
})

ipcMain.handle('valkama:list-session-openers', async (event) => {
  if (!isValkamaSender(event)) return []
  return discoverSupportedOpeners({
    protocolAvailability,
  })
})

function runJsonProcess(command, args) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(command, args, {
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (error) {
      resolve({ payload: null, detail: error.message })
      return
    }
    let output = ''
    let errorOutput = ''
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    child.stdout?.setEncoding?.('utf8')
    child.stdout?.on?.('data', (chunk) => {
      output += String(chunk)
    })
    child.stderr?.setEncoding?.('utf8')
    child.stderr?.on?.('data', (chunk) => {
      errorOutput += String(chunk)
    })
    child.once('error', (error) => finish({ payload: null, detail: error.message }))
    child.once('close', (code) => {
      const payload = code === 0 ? parseJsonObject(output) : null
      const detail = payload ? '' : (errorOutput || output || `process exited ${code}`).trim()
      finish({ payload, detail })
    })
  })
}

function runLauncherJson(launcher, args) {
  return runJsonProcess(launcher.python, [launcher.shim, ...args])
}

function readListenerRuntime(timeout) {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    let request
    try {
      request = httpRequest(
        { host: HOST, port: PORT, path: '/api/runtime', timeout },
        (response) => {
          let output = ''
          response.setEncoding('utf8')
          response.on('data', (chunk) => {
            output += chunk
          })
          response.on('end', () =>
            finish({
              reachable: true,
              payload: response.statusCode === 200 ? parseRuntimeJson(output) : null,
            }),
          )
          response.on('error', () => finish({ reachable: true, payload: null }))
        },
      )
      request.once('error', () => finish({ reachable: false, payload: null }))
      request.once('timeout', () => {
        request.destroy()
        finish({ reachable: false, payload: null })
      })
      request.end()
    } catch {
      finish({ reachable: false, payload: null })
    }
  })
}

/**
 * Start `serve` through the managed shim, as a child this app owns.
 *
 * Its stderr is kept (the tail only) for two reasons: the line the server
 * prints once it is bound is the readiness signal, and the last lines before
 * an early exit are the failure the owner needs to read. The pipe is drained
 * for the server's whole life, so it can never fill and stall the server.
 */
function spawnServer(launcher) {
  const child = spawn(launcher.python, [launcher.shim, 'serve', '--port', String(PORT)], {
    detached: false,
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  })
  serverProcess = child
  const marker = `Valkama on ${URL}`
  let tail = ''
  let announce
  const announced = new Promise((resolve) => {
    announce = resolve
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => {
    tail = (tail + chunk).slice(-4000)
    if (tail.includes(marker)) announce()
  })
  const exited = new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }))
    child.once('error', (error) => resolve({ code: null, error: error.message }))
  })
  void exited.then((exit) => {
    log('server-exited', {
      pid: child.pid,
      code: exit.code,
      signal: exit.signal,
      error: exit.error,
    })
    if (serverProcess === child) serverProcess = null
  })
  return {
    pid: child.pid,
    announced,
    exited,
    isAlive: () => child.exitCode === null && child.signalCode === null,
    tail: () => tail.trim(),
    kill: () => child.kill(),
  }
}

function startupDeps(launcher) {
  return {
    launcher,
    bootstrapDetail: launcherBootstrap.detail,
    readStatus: () =>
      runLauncherJson(launcher, ['launcher', 'status', '--directory', launcher.directory]),
    readRuntime: () => runLauncherJson(launcher, ['runtime']),
    readOwnership: () =>
      runLauncherJson(launcher, [
        'launcher',
        'listener',
        'status',
        '--directory',
        launcher.directory,
        '--port',
        String(PORT),
      ]),
    stopListener: () =>
      runLauncherJson(launcher, [
        'launcher',
        'listener',
        'stop',
        '--directory',
        launcher.directory,
        '--port',
        String(PORT),
      ]),
    probe: readListenerRuntime,
    spawnServer: () => spawnServer(launcher),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: Date.now,
    log,
  }
}

// The workspace remembers its language in the page's own storage, which this
// window cannot read before the page exists. The language the page last used
// is kept here instead, so the starting page speaks it from the first frame.
function preferencesFile() {
  return path.join(app.getPath('userData'), 'valkama-desktop.json')
}

function startupLocale() {
  let stored = null
  try {
    stored = parseJsonObject(readFileSync(preferencesFile(), 'utf8'))?.locale ?? null
  } catch {
    // First start, or unreadable: the system languages decide.
  }
  return resolveLocale(stored, app.getPreferredSystemLanguages())
}

function rememberLocale(webContents) {
  webContents
    .executeJavaScript("localStorage.getItem('valkama-locale')", true)
    .then((locale) => {
      if (locale !== 'en' && locale !== 'ru') return
      writeFileSync(preferencesFile(), `${JSON.stringify({ locale })}\n`, 'utf8')
    })
    .catch(() => {})
}

function showStartupPage(state) {
  if (!mainWindow) return
  offeredActions = state.phase === 'stale' ? ['restart'] : state.phase === 'failed' ? ['retry'] : []
  const shown = Date.now()
  const pageUrl = startupPageUrl({ ...state, locale: startupLocale(), port: PORT })
  void mainWindow.loadURL(pageUrl).then(
    () => log('startup-page-shown', { phase: state.phase, ms: Date.now() - shown }),
    () => {}, // replaced before it finished loading: nothing was shown
  )
}

function launcherDetail(result) {
  if (result.kind !== 'launcher') return result.detail
  const attempted = launcherCandidate
    ? `${launcherCandidate.python}\n${launcherCandidate.shim}`
    : path.join(process.env.LOCALAPPDATA || '', 'Valkama', 'bin', LAUNCHER_MANIFEST_NAME)
  return `${result.detail}\n\nManaged launcher:\n${attempted}`
}

function loadValkama() {
  offeredActions = []
  const loadStarted = Date.now()
  void mainWindow.loadURL(URL).then(
    () => {
      log('ui-loaded', { ms: Date.now() - loadStarted, first: !uiLoadedOnce })
      uiLoadedOnce = true
    },
    (error) => log('ui-load-failed', { ms: Date.now() - loadStarted, error: error?.message }),
  )
}

/** Find or start the server, then show Valkama or say why it cannot be shown. */
function startValkama({ allowRestart = false } = {}) {
  if (starting) return starting
  starting = (async () => {
    showStartupPage({ phase: allowRestart ? 'restarting' : 'starting' })
    if (!launcherCandidate) log('launcher-missing', { detail: launcherBootstrap.detail })
    const begun = Date.now()
    const result = launcherCandidate
      ? await establishServer(startupDeps(launcherCandidate), { allowRestart })
      : await establishServer({ launcher: null, bootstrapDetail: launcherBootstrap.detail })
    if (!mainWindow) return
    if (!result.ok) {
      log('failure-shown', { phase: result.phase, kind: result.kind, ms: Date.now() - begun })
      log('failure-detail', { detail: result.detail })
      showStartupPage({ ...result, detail: launcherDetail(result) })
      return
    }
    log('server-ready', { mode: result.mode, pid: result.pid, ms: Date.now() - begun })
    loadValkama()
    if (result.mode === 'started' && launcherCandidate) {
      // The child was trusted because it is ours; the ownership proof is
      // still taken, after the window has what it needs.
      void verifyStartedOwnership(startupDeps(launcherCandidate), result.pid).then((proof) =>
        log(proof.verified ? 'ownership-verified' : 'ownership-unverified', {
          state: proof.state,
          pid: proof.pid,
          detail: proof.verified ? '' : proof.detail,
        }),
      )
    }
  })().finally(() => {
    starting = null
  })
  return starting
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 720,
    minHeight: 480,
    // The window is the chrome the workspace panel lies on, so this is
    // `--color-navigation` rather than `--color-canvas`: the frame paints before the shell
    // does, and the first thing drawn should be the ground it keeps.
    backgroundColor: '#0e0f10', // --color-navigation
    autoHideMenuBar: true,
    title: 'Valkama',
    icon: path.join(__dirname, '..', 'windows', 'valkama.ico'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  })
  log('window-created', { visible: mainWindow.isVisible() })
  mainWindow.once('ready-to-show', () => log('window-painted'))
  if (focusWhenCreated) mainWindow.focus()

  // Anything that is not Valkama opens in the real browser, never in here.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const action = startupAction(url)
    if (action) {
      // A remedy link on the starting page: the main process acts, the page
      // never navigates, and a link the page does not currently offer is inert.
      event.preventDefault()
      if (!offeredActions.includes(action)) return
      log('remedy-chosen', { action })
      void startValkama({ allowRestart: action === 'restart' })
      return
    }
    if (!url.startsWith(URL)) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })
  mainWindow.webContents.on('did-finish-load', () => {
    if (mainWindow?.webContents.getURL().startsWith(URL)) rememberLocale(mainWindow.webContents)
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

if (!app.requestSingleInstanceLock()) {
  log('second-launch', { outcome: 'handed to the running window' })
  app.quit()
} else {
  app.on('second-instance', () => {
    // The window exists from app-ready on, so a click during startup lands
    // here and brings the starting window forward instead of being lost.
    log('second-instance', { window: Boolean(mainWindow) })
    if (!mainWindow) {
      focusWhenCreated = true
      return
    }
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app.whenReady().then(() => {
    log('app-ready')
    Menu.setApplicationMenu(null)
    createWindow()
    void startValkama()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
        void startValkama()
      }
    })
  })

  app.on('window-all-closed', () => {
    app.quit()
  })

  // Leave a server that was already running alone: the session hook and the
  // agents share it, and closing the window must not take the server down.
  app.on('before-quit', () => {
    if (
      serverProcess &&
      serverProcess.exitCode === null &&
      Number.isInteger(serverProcess.pid) &&
      !serverProcess.killed
    ) {
      serverProcess.kill()
    }
  })
}
