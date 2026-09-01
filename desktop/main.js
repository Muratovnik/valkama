'use strict'

// Native window for Valkama. The product itself stays where it is: this process
// only makes sure the local Python server is listening and shows its page in a
// Chromium window, so nothing here duplicates what the page already does.

const { app, BrowserWindow, Menu, Notification, ipcMain, shell } = require('electron')
const { spawn } = require('node:child_process')
const { createHash } = require('node:crypto')
const { readFileSync, statSync } = require('node:fs')
const { request: httpRequest } = require('node:http')
const path = require('node:path')
const { newAttention } = require('./attention')
const {
  LAUNCHER_COMMAND_NAME,
  LAUNCHER_MANIFEST_NAME,
  LAUNCHER_SHIM_NAME,
  launcherStatusMatches,
  listenerLifecycleAction,
  parseJsonObject,
  parseRuntimeJson,
  runtimeMatches,
  validateLauncherBootstrap,
} = require('./runtime_contract')
const { discoverSupportedOpeners, resolveSupportedOpener } = require('./opener_catalog')
const { openSessionRequest } = require('./session_opener')
const { openSourceRequest } = require('./source_opener')

const PORT = Number(process.env.VALKAMA_PORT || 8642)
const HOST = '127.0.0.1'
const URL = `http://${HOST}:${PORT}/`

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
let serverFailureReason = ''
/** Attention reasons already notified, so a stream push cannot repeat a toast. */
let notifiedAttention = new Set()

function isValkamaSender(event) {
  const senderUrl = event.senderFrame?.url || event.sender.getURL()
  return typeof senderUrl === 'string' && senderUrl.startsWith(URL)
}

ipcMain.handle('valkama:open-source', async (event, request) => {
  const senderUrl = event.senderFrame?.url || event.sender.getURL()
  return openSourceRequest({ senderUrl, appUrl: URL, request, shell })
})

ipcMain.on('valkama:attention', (event, inbox) => {
  // Same trust boundary as the source opener: only the Valkama page may make
  // this process raise notifications.
  if (!isValkamaSender(event) || !Notification.isSupported()) return
  const { toasts, keys } = newAttention(notifiedAttention, inbox)
  notifiedAttention = keys
  for (const toast of toasts) {
    const notification = new Notification({ title: toast.title, body: toast.body })
    notification.on('click', () => {
      if (!mainWindow) return
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    })
    notification.show()
  }
})

const MAX_NOTIFY_PER_PUSH = 6

// Page-decided toasts: the renderer already filtered and capped them by the
// owner's settings, so this side only guards shape and routes clicks back.
ipcMain.on('valkama:notify', (event, toasts) => {
  if (!isValkamaSender(event) || !Notification.isSupported()) return
  const list = Array.isArray(toasts) ? toasts.slice(0, MAX_NOTIFY_PER_PUSH) : []
  for (const toast of list) {
    if (!toast || typeof toast.title !== 'string' || typeof toast.body !== 'string') continue
    const board = typeof toast.board === 'string' ? toast.board : ''
    const cardId = Number.isInteger(toast.card_id) && toast.card_id > 0 ? toast.card_id : 0
    const notification = new Notification({
      title: toast.title.slice(0, 120),
      body: toast.body.slice(0, 240),
    })
    notification.on('click', () => {
      if (!mainWindow) return
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
      if (cardId) {
        mainWindow.webContents.send('valkama:navigate-card', { board, card_id: cardId })
      }
    })
    notification.show()
  }
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

async function readManagedLauncher() {
  if (!launcherBootstrap.ok || !launcherCandidate) {
    return {
      launcher: null,
      detail: `${launcherBootstrap.detail}. Run "python valkama.py launcher install" from the current checkout.`,
    }
  }
  const reading = await runLauncherJson(launcherCandidate, [
    'launcher',
    'status',
    '--directory',
    launcherCandidate.directory,
  ])
  if (!launcherStatusMatches(launcherCandidate, reading.payload)) {
    return {
      launcher: null,
      detail: `${reading.detail || 'managed launcher status did not match its manifest'}. Run "python valkama.py launcher install" from the current checkout.`,
    }
  }
  return { launcher: launcherCandidate, detail: '' }
}

async function readLocalRuntime(launcher) {
  const reading = await runLauncherJson(launcher, ['runtime'])
  const payload = reading.payload
  return {
    payload: runtimeMatches(payload, payload) ? payload : null,
    detail: reading.detail || 'the managed launcher returned a malformed runtime identity',
  }
}

function readListenerOwnership(launcher) {
  return runLauncherJson(launcher, [
    'launcher',
    'listener',
    'status',
    '--directory',
    launcher.directory,
    '--port',
    String(PORT),
  ])
}

function stopManagedListener(launcher) {
  return runLauncherJson(launcher, [
    'launcher',
    'listener',
    'stop',
    '--directory',
    launcher.directory,
    '--port',
    String(PORT),
  ])
}

function readListenerRuntime() {
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
        { host: HOST, port: PORT, path: '/api/runtime', timeout: 700 },
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

async function ensureServer() {
  serverFailureReason = ''
  const managed = await readManagedLauncher()
  if (!managed.launcher) {
    serverFailureReason = managed.detail
    console.error(serverFailureReason)
    return false
  }
  const launcher = managed.launcher
  const local = await readLocalRuntime(launcher)
  if (!local.payload) {
    serverFailureReason = `could not calculate the managed runtime identity: ${local.detail}`
    console.error(serverFailureReason)
    return false
  }
  const expected = local.payload
  const [existing, ownershipReading] = await Promise.all([
    readListenerRuntime(),
    readListenerOwnership(launcher),
  ])
  if (!ownershipReading.payload) {
    serverFailureReason =
      ownershipReading.detail || `could not verify the process listening on port ${PORT}`
    console.error(serverFailureReason)
    return false
  }
  const plan = listenerLifecycleAction(expected, existing, ownershipReading.payload)
  if (plan.action === 'refuse') {
    serverFailureReason = plan.reason
    console.error(serverFailureReason)
    return false
  }
  if (plan.action === 'reuse') return true
  if (plan.action === 'restart') {
    const stopped = await stopManagedListener(launcher)
    if (!stopped.payload || !['stopped', 'free'].includes(stopped.payload.state)) {
      serverFailureReason =
        stopped.payload?.detail ||
        stopped.detail ||
        'the managed listener could not be stopped safely'
      console.error(serverFailureReason)
      return false
    }
    for (let attempt = 0; attempt < 25; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 200))
      const ownership = await readListenerOwnership(launcher)
      if (!ownership.payload) {
        serverFailureReason =
          ownership.detail || 'listener ownership could not be verified after stop'
        console.error(serverFailureReason)
        return false
      }
      if (ownership.payload.state === 'free') break
      if (ownership.payload.state === 'foreign') {
        serverFailureReason = ownership.payload.detail
        console.error(serverFailureReason)
        return false
      }
      if (attempt === 24) {
        serverFailureReason = `managed listener process ${ownership.payload.pid || ''} did not release port ${PORT}`
        console.error(serverFailureReason)
        return false
      }
    }
  }
  serverProcess = spawn(launcher.python, [launcher.shim, 'serve', '--port', String(PORT)], {
    detached: false,
    stdio: 'ignore',
    windowsHide: true,
  })
  serverProcess.on('error', (error) => {
    console.error(`cannot start the Valkama server: ${error.message}`)
  })
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 300))
    const [actual, ownership] = await Promise.all([
      readListenerRuntime(),
      readListenerOwnership(launcher),
    ])
    const current = listenerLifecycleAction(expected, actual, ownership.payload)
    if (current.action === 'reuse') return true
    if (current.action === 'refuse') {
      serverFailureReason = ownership.payload ? current.reason : ownership.detail || current.reason
      console.error(serverFailureReason)
      return false
    }
  }
  serverFailureReason = 'the Valkama server did not expose the expected runtime identity'
  console.error(serverFailureReason)
  return false
}

function createWindow(reachable) {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 720,
    minHeight: 480,
    // The window is the chrome the workspace panel lies on, so this is
    // `--color-navigation` rather than `--color-canvas`: the frame paints before the shell
    // does, and the first thing drawn should be the ground it keeps.
    backgroundColor: '#0d1117', // --color-navigation
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

  if (reachable) {
    void mainWindow.loadURL(URL)
  } else {
    const attemptedLauncher = launcherCandidate
      ? `${launcherCandidate.python}\n${launcherCandidate.shim}`
      : path.join(process.env.LOCALAPPDATA || '', 'Valkama', 'bin', LAUNCHER_MANIFEST_NAME)
    const message = `The Valkama server is not reusable.\n\n${serverFailureReason}\n\nManaged launcher:\n${attemptedLauncher}`
    void mainWindow.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(
        `<body style="font:14px system-ui;background:#0d1117;color:#ececec;padding:24px">
         <h1 style="font-size:16px">Valkama</h1><pre>${message}</pre></body>`,
      )}`,
    )
  }

  // Anything that is not Valkama opens in the real browser, never in here.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(URL)) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null)
    createWindow(await ensureServer())
    app.on('activate', async () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(await ensureServer())
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
