'use strict'

// The address a launch asks the window to show. The listener starts the app with
// a card's route when a person follows a link to a work item, at first start or
// on top of a running window. A command line is untrusted: anything on this
// machine can write one, so only the one shape the listener issues is taken, and
// everything else leaves the window where it was.
//
// The route, not the short `/open/<number>`: this window's own navigation carries
// the same fetch metadata as an address opened from outside, so loading the short
// one would have the listener start the app again.

const OPEN_PATH_SWITCH = '--open-path='

// `_CARD_ROUTE` in server/http_surface.py; tests/test_work_item_link.py compares them.
const CARD_ROUTE = /^\/modules\/planning\/project\/[a-z][a-z0-9-]{0,159}\?entity=[A-Za-z0-9_-]+$/

/** The route one command line asks for, or null. Two answers are no answer. */
function openPathFromArgv(argv) {
  if (!Array.isArray(argv)) return null
  const asked = argv.filter(
    (argument) => typeof argument === 'string' && argument.startsWith(OPEN_PATH_SWITCH),
  )
  if (asked.length !== 1) return null
  const route = asked[0].slice(OPEN_PATH_SWITCH.length)
  return CARD_ROUTE.test(route) ? route : null
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

module.exports = { howToOpen, openPathFromArgv, openPathUrl }
