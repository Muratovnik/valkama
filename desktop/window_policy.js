'use strict'

// What any window of this app may open and where it may go. Set on every web contents
// as it is created, so that a window opened later holds to it from its first navigation:
// a window with no handler of its own would open a link in an Electron window with none
// of these settings, and would follow one to any site.

const { startupAction } = require('./startup_page')

const DOCUMENT_PAGE = '/doc'
/**
 * What may go to the system. The page links only these (`safeHref` in the web app),
 * and an open plan's links go through the session opener, never here: any other
 * scheme would ask Windows to start whatever program claims it.
 */
const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

function parsed(url) {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

/** Whether an address is on Valkama's own origin, with no user name to pass for it. */
function isSameOrigin(url, appUrl) {
  const address = parsed(url)
  return (
    address !== null &&
    address.origin === new URL(appUrl).origin &&
    address.username === '' &&
    address.password === ''
  )
}

/** Hands an address to the system browser when its scheme is one the page links. */
function openOutside(url, openExternal) {
  const address = parsed(url)
  if (address !== null && EXTERNAL_PROTOCOLS.has(address.protocol)) void openExternal(url)
}

/** Whether an address is the one page that opens in a window of this app. */
function isDocumentPage(url, appUrl) {
  return isSameOrigin(url, appUrl) && new URL(url).pathname === DOCUMENT_PAGE
}

/**
 * What a `window.open` comes to. A document's own page opens here with the options the
 * caller gives every window, and closes with the window that opened it; anything else
 * goes to the system browser, which is where a page that is not Valkama belongs, when
 * its scheme is one the page links, and nowhere otherwise.
 */
function windowOpenAnswer(url, { appUrl, openExternal, windowOptions }) {
  if (isDocumentPage(url, appUrl)) {
    return {
      action: 'allow',
      outlivesOpener: false,
      overrideBrowserWindowOptions: windowOptions,
    }
  }
  openOutside(url, openExternal)
  return { action: 'deny' }
}

/**
 * Holds one web contents to the policy, and shows it the context menu.
 *
 * A remedy link on the starting page is the main window's to act on, in a listener of its
 * own; it never navigates and never goes to the browser, here or in any other window.
 */
function guardWindow(contents, { appUrl, openExternal, showContextMenu, windowOptions }) {
  contents.setWindowOpenHandler(({ url }) =>
    windowOpenAnswer(url, { appUrl, openExternal, windowOptions }),
  )
  contents.on('will-navigate', (event, url) => {
    if (isSameOrigin(url, appUrl)) return
    event.preventDefault()
    if (startupAction(url) === null) openOutside(url, openExternal)
  })
  contents.on('context-menu', (_event, params) => {
    void showContextMenu(contents, params)
  })
}

module.exports = { guardWindow, isDocumentPage, windowOpenAnswer }
