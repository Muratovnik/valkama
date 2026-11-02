'use strict'

const { contextBridge, ipcRenderer } = require('electron')

const SOURCE_REQUEST_KEYS = new Set(['source', 'resource_ref'])
const RESOURCE_REF_KEYS = new Set(['kind', 'resource_id'])

function exactKeys(value, expected) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const keys = Object.keys(value)
  return keys.length === expected.size && keys.every((key) => expected.has(key))
}

function isSourceRequest(request) {
  if (!exactKeys(request, SOURCE_REQUEST_KEYS)) return false
  if (typeof request.source !== 'string' || request.source.length === 0) return false
  const resourceRef = request.resource_ref
  return (
    exactKeys(resourceRef, RESOURCE_REF_KEYS) &&
    resourceRef.kind === 'planning-space' &&
    typeof resourceRef.resource_id === 'string' &&
    resourceRef.resource_id.length > 0
  )
}

contextBridge.exposeInMainWorld('valkamaDesktop', {
  openSource(request) {
    if (!isSourceRequest(request)) {
      return Promise.resolve({ ok: false, mode: 'opened', error: 'invalid-source-request' })
    }
    return ipcRenderer.invoke('valkama:open-source', request)
  },
  openSession(request) {
    return ipcRenderer.invoke('valkama:open-session', request)
  },
  listSessionOpeners() {
    return ipcRenderer.invoke('valkama:list-session-openers')
  },
  // Only the route reaches the page, never the event, which carries the IPC sender.
  onOpenRoute(listener) {
    if (typeof listener !== 'function') return
    ipcRenderer.removeAllListeners('valkama:open-route')
    ipcRenderer.on('valkama:open-route', (_event, route) => listener(route))
    ipcRenderer.send('valkama:open-route-ready')
  },
})
