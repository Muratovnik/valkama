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
  // The page owns the live session stream, so it reports the inbox and the
  // shell decides which reasons are new enough to raise a Windows toast.
  reportAttention(inbox) {
    ipcRenderer.send('valkama:attention', inbox)
  },
  // Page-decided toasts: the renderer filters by the owner's settings and this
  // shell only shows them natively and routes clicks back as navigation.
  notify(toasts) {
    ipcRenderer.send('valkama:notify', toasts)
  },
  onNavigateCard(callback) {
    ipcRenderer.on('valkama:navigate-card', (_event, target) => callback(target))
  },
  openSession(request) {
    return ipcRenderer.invoke('valkama:open-session', request)
  },
  listSessionOpeners() {
    return ipcRenderer.invoke('valkama:list-session-openers')
  },
})
