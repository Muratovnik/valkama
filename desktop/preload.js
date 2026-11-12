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

// The page's language and rail width, which the window's starting page draws before
// the page exists (`preferences.js`). The page stores them only in answer to the
// reader — a drag that lets go, a key, a click — so the window hears them once the page
// has loaded, a moment after each such input, and as the page is hidden or goes away
// with the window. It hears a value only when it differs from the last one it heard.
const PREFERENCE_KEYS = { locale: 'valkama-locale', navWidth: 'valkama-navigation-width' }
let heard = null

function reportPreferences() {
  let reported
  try {
    reported = {
      locale: localStorage.getItem(PREFERENCE_KEYS.locale),
      navWidth: localStorage.getItem(PREFERENCE_KEYS.navWidth),
    }
  } catch {
    // A page with no storage of its own, such as the starting page's data URL.
    return
  }
  const said = JSON.stringify(reported)
  if (said === heard) return
  heard = said
  ipcRenderer.send('valkama:preferences', reported)
}

// After the page's own handlers for the same input have stored what it changed.
const reportAfterInput = () => setTimeout(reportPreferences, 0)

window.addEventListener('DOMContentLoaded', reportPreferences)
for (const input of ['pointerup', 'click', 'keyup', 'change']) {
  window.addEventListener(input, reportAfterInput, true)
}
window.addEventListener('pagehide', reportPreferences)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') reportPreferences()
})
