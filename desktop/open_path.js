'use strict'

// The address a launch asks the window to show. Two callers ask. The listener starts
// the app with a route when a person follows a link to a work item, and Windows starts
// it with `valkama://open/<number>` when a person clicks a toast, at first start or on
// top of a running window; a toast about a question adds `?reveal=question`, an order the
// page takes out of the address as it obeys it. A command line is untrusted: anything on this machine can
// write one, and any page can call the scheme, whose address Windows may split into
// more arguments than it was. So only the shapes these two issue are taken. Any other
// switch value leaves the window where it was, and a scheme address of any other shape
// does not even raise it (`refusesLaunch`).
//
// The route, not the short `/open/<number>`: this window's own navigation carries
// the same fetch metadata as an address opened from outside, so loading the short
// one would have the listener start the app again. A toast knows only the number, so
// its address becomes the short one with `in=browser`, which starts nothing: the
// listener answers it with the redirect, and a page that is up follows that itself.

const OPEN_PATH_SWITCH = '--open-path='

// `_CARD_ROUTE` in server/http_surface.py; tests/test_work_item_link.py compares them.
const CARD_ROUTE = /^(?:\/modules\/planning\/project\/[a-z][a-z0-9-]{0,159}\?entity=[A-Za-z0-9_-]+(?:&reveal=question)?|\/modules\/planning\/global\?panel=questions)$/

// `_QUESTIONS_ROUTE` in server/http_surface.py, compared with it by the same test.
const QUESTIONS_ROUTE = '/modules/planning/global?panel=questions'

const ANY_SCHEME_ADDRESS = /^valkama:/i

// `messages.QUESTIONS`, `_HUMAN_ID` and `messages.REVEAL_QUESTION` in server/, compared by
// the same test. Nothing else: no other host, path, query, fragment, percent escape or
// lower-case spelling.
const SCHEME_ADDRESS = /^valkama:\/\/open\/(?:(questions)|([A-Z][A-Z0-9]{1,7}-[1-9][0-9]{0,8})(\?reveal=question)?)$/

function isAddress(argument) {
  return (
    typeof argument === 'string' &&
    (argument.startsWith(OPEN_PATH_SWITCH) || ANY_SCHEME_ADDRESS.test(argument))
  )
}

function routeOf(argument) {
  if (argument.startsWith(OPEN_PATH_SWITCH)) {
    const route = argument.slice(OPEN_PATH_SWITCH.length)
    return CARD_ROUTE.test(route) ? route : null
  }
  const named = SCHEME_ADDRESS.exec(argument)
  if (named === null) return null
  if (named[1]) return QUESTIONS_ROUTE
  return `/open/${named[2]}?in=browser${named[3] ? '&reveal=question' : ''}`
}

/** The route one command line asks for, or null. Two answers are no answer. */
function openPathFromArgv(argv) {
  if (!Array.isArray(argv)) return null
  const asked = argv.filter(isAddress)
  return asked.length === 1 ? routeOf(asked[0]) : null
}

/**
 * Whether this launch came through the scheme with an address it does not take.
 * Windows starts the app before anything can read the address, so all that is left
 * to refuse is the rest: no window, no raised window, no hand-over to a running one.
 */
function refusesLaunch(argv) {
  return (
    Array.isArray(argv) &&
    argv.some((argument) => typeof argument === 'string' && ANY_SCHEME_ADDRESS.test(argument)) &&
    openPathFromArgv(argv) === null
  )
}

/** The route on this window's own origin; `appUrl` ends in the root's slash. */
function openPathUrl(appUrl, route) {
  return `${appUrl}${route.slice(1)}`
}

/**
 * How a window that was asked for a route gets there.
 *
 * Until it holds Valkama the address waits for the load that follows the starting
 * page. A page that said it listens gets the route and moves with its own router,
 * so nothing reloads and its leave check asks before a draft goes.
 *
 * A page that did not say so is a bundle older than this app, or a renderer that
 * is gone, and only a load can move it. That costs nothing it could keep: an older
 * bundle holds `beforeunload` while it has a draft, which refuses the load and
 * leaves the window where it was, and a renderer that is gone has nothing left.
 */
function howToOpen({ showingValkama, pageListens }) {
  if (!showingValkama) return 'wait'
  return pageListens ? 'hand-over' : 'load'
}

/**
 * Whether the page that says it listens for routes is the one a route is handed to.
 *
 * `howToOpen` decides for the main window alone, so only the top frame of its own web
 * contents, on Valkama's origin, may say so. A document's window on the same origin, or
 * a frame inside a page, saying it would make the next route go over the bridge to a main
 * page that is reloading and has not said so yet, and the route would be lost.
 */
function saysItListens(event, { appUrl, mainContents }) {
  if (!mainContents || event?.sender !== mainContents) return false
  const frame = event.senderFrame
  if (!frame || frame.parent !== null) return false
  const url = frame.url || mainContents.getURL()
  return typeof url === 'string' && url.startsWith(appUrl)
}

module.exports = { howToOpen, openPathFromArgv, openPathUrl, refusesLaunch, saysItListens }
