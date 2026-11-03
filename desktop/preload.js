'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('valkamaDesktop', {
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
