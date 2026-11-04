'use strict'

/**
 * What a window may open and where it may go, against a stand-in for a web contents.
 *
 * Electron itself is not here: that it honours these answers, loads the preload into the
 * second window, and answers that window over the bridge is for a run of the real app.
 */

const assert = require('node:assert/strict')
const test = require('node:test')

const { guardWindow, isDocumentPage, windowOpenAnswer } = require('./window_policy')

const APP = 'http://127.0.0.1:8642/'
const PAGE = `${APP}doc?project=demo&path=docs%2Fplan.md#kb:a7f3`
const OPTIONS = { webPreferences: { sandbox: true }, backgroundColor: '#000000' }

function policy() {
  const external = []
  return {
    external,
    options: {
      appUrl: APP,
      openExternal: async (url) => {
        external.push(url)
      },
      windowOptions: OPTIONS,
    },
  }
}

function contents() {
  const listeners = {}
  const menus = []
  const { external, options } = policy()
  const target = {
    setWindowOpenHandler(handler) {
      target.handler = handler
    },
    on(name, listener) {
      listeners[name] = listener
    },
  }
  guardWindow(target, {
    ...options,
    showContextMenu: async (from, params) => {
      menus.push({ from, params })
    },
  })
  const navigate = (url) => {
    const event = {
      prevented: false,
      preventDefault() {
        event.prevented = true
      },
    }
    listeners['will-navigate'](event, url)
    return event.prevented
  }
  return { external, listeners, menus, navigate, target }
}

test('a document page of this origin opens here, with what every window has', () => {
  const { external, options } = policy()
  assert.deepEqual(windowOpenAnswer(PAGE, options), {
    action: 'allow',
    outlivesOpener: false,
    overrideBrowserWindowOptions: OPTIONS,
  })
  assert.equal(windowOpenAnswer(PAGE, options).overrideBrowserWindowOptions, OPTIONS)
  assert.deepEqual(external, [])
})

test('anything else goes to the system browser and opens nothing here', () => {
  for (const url of [
    'https://example.com/doc?project=demo&path=a.md',
    'http://127.0.0.1:8643/doc?project=demo&path=a.md',
    'https://127.0.0.1:8642/doc?project=demo&path=a.md',
    'http://localhost:8642/doc?project=demo&path=a.md',
    'http://127.0.0.1.example.com:8642/doc?project=demo&path=a.md',
    'http://evil@127.0.0.1:8642/doc?project=demo&path=a.md',
    `${APP}docs`,
    `${APP}doc/`,
    `${APP}doc/plan.md`,
    `${APP}modules/planning/global`,
    APP,
    'mailto:someone@example.com',
  ]) {
    const { external, options } = policy()
    assert.deepEqual(windowOpenAnswer(url, options), { action: 'deny' }, url)
    assert.deepEqual(external, [url], url)
  }
})

test('an address of any other scheme opens nowhere, in here or out', () => {
  // The page links only http, https and mailto; a plan's own links go through the opener,
  // never here. Anything else would hand the system a program to start.
  for (const url of [
    'file:///C:/work/doc',
    'file://server/share/run.exe',
    'vscode://anthropic.claude-code/open?session=x',
    'ms-settings:privacy',
    'search-ms:query=x',
    'javascript:alert(1)',
    'not an address',
  ]) {
    const { external, options } = policy()
    assert.deepEqual(windowOpenAnswer(url, options), { action: 'deny' }, url)
    assert.deepEqual(external, [], url)
    const window = contents()
    assert.equal(window.navigate(url), true, url)
    assert.deepEqual(window.external, [], url)
  }
})

test('the page is known by its path alone, whatever its query and fragment', () => {
  assert.ok(isDocumentPage(`${APP}doc`, APP))
  assert.ok(isDocumentPage(`${APP}doc?anything=1#anywhere`, APP))
  assert.ok(!isDocumentPage(`${APP}DOC`, APP))
})

test('any window, not only the main one, opens by the same answers', () => {
  const { external, target } = contents()
  assert.equal(target.handler({ url: PAGE }).action, 'allow')
  assert.deepEqual(target.handler({ url: 'https://example.com/' }), { action: 'deny' })
  assert.deepEqual(external, ['https://example.com/'])
})

test('a navigation stays on this origin, and off it goes to the system browser', () => {
  const { external, navigate } = contents()
  assert.equal(navigate(`${APP}modules/planning/global`), false)
  assert.equal(navigate(PAGE), false)
  assert.deepEqual(external, [])

  for (const url of ['https://example.com/', 'http://127.0.0.1.example.com:8642/doc']) {
    assert.equal(navigate(url), true, url)
  }
  assert.deepEqual(external, ['https://example.com/', 'http://127.0.0.1.example.com:8642/doc'])
})

test('a remedy link of the starting page neither navigates nor reaches the browser', () => {
  const { external, navigate } = contents()
  assert.equal(navigate('https://valkama.invalid/retry'), true)
  assert.equal(navigate('https://valkama.invalid/restart'), true)
  assert.deepEqual(external, [])
})

test('the context menu is asked for on the window it was opened in', () => {
  const { listeners, menus, target } = contents()
  const params = { linkURL: 'https://example.com/' }
  listeners['context-menu']({}, params)
  assert.deepEqual(menus, [{ from: target, params }])
})
