'use strict'

const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

/**
 * A page for the preload to run in: its storage, the listeners it adds to the window and
 * the document, and its timers, run when the test says.
 */
function fakePage({ storage = {}, storageThrows = false } = {}) {
  const listeners = { window: new Map(), document: new Map() }
  const timers = []
  const target = (name) => ({
    addEventListener(type, listener) {
      const list = listeners[name].get(type) ?? []
      list.push(listener)
      listeners[name].set(type, list)
    },
  })
  const page = {
    storage: { ...storage },
    visibilityState: 'visible',
    dispatch(name, type) {
      for (const listener of listeners[name].get(type) ?? []) listener({ type })
    },
    runTimers() {
      for (const timer of timers.splice(0)) timer()
    },
  }
  page.globals = {
    window: target('window'),
    document: {
      ...target('document'),
      get visibilityState() {
        return page.visibilityState
      },
    },
    get localStorage() {
      if (storageThrows) throw new Error('SecurityError: no storage on an opaque origin')
      return { getItem: (key) => (key in page.storage ? page.storage[key] : null) }
    },
    setTimeout(callback) {
      timers.push(callback)
    },
  }
  return page
}

function loadBridge(page = fakePage()) {
  const calls = []
  const handlers = new Map()
  const sent = []
  const reports = []
  let bridge = null
  const source = readFileSync(path.join(__dirname, 'preload.js'), 'utf8')
  // The page's globals keep their getters: the storage is asked for when the preload reads it.
  const context = Object.defineProperties({}, Object.getOwnPropertyDescriptors(page.globals))
  vm.runInNewContext(source, Object.assign(context, {
    Promise,
    require(moduleName) {
      assert.equal(moduleName, 'electron')
      return {
        contextBridge: {
          exposeInMainWorld(name, value) {
            assert.equal(name, 'valkamaDesktop')
            bridge = value
          },
        },
        ipcRenderer: {
          invoke(channel, request) {
            calls.push({ channel, request })
            return Promise.resolve({ ok: true, mode: 'opened' })
          },
          on(channel, handler) {
            handlers.set(channel, handler)
          },
          removeAllListeners(channel) {
            handlers.delete(channel)
          },
          send(channel, payload) {
            // Copied out of the page's realm, as IPC copies what it carries.
            if (channel === 'valkama:preferences') reports.push(JSON.parse(JSON.stringify(payload)))
            else sent.push(channel)
          },
        },
      }
    },
  }))
  return { bridge, calls, handlers, reports, sent }
}

test('preload hands an open request to the app as it is', async () => {
  const { bridge, calls } = loadBridge()
  const request = { path: { kind: 'file', project: 'demo', path: 'src/a.ts', line: 42 } }

  await bridge.openSession(request)

  assert.equal(calls.length, 1)
  assert.equal(calls[0].channel, 'valkama:open-session')
  assert.equal(calls[0].request, request)
})

test('a page that listens for routes gets the route alone, and says so only once it listens', () => {
  const { bridge, handlers, sent } = loadBridge()
  assert.deepEqual(sent, [])
  const routes = []
  bridge.onOpenRoute((...received) => routes.push(received))
  assert.deepEqual(sent, ['valkama:open-route-ready'])

  handlers.get('valkama:open-route')({ sender: 'the event' }, '/a')
  assert.deepEqual(routes, [['/a']])
})

test('a second listener replaces the first, and something else is no listener', () => {
  const { bridge, handlers, sent } = loadBridge()
  const first = []
  const second = []
  bridge.onOpenRoute((route) => first.push(route))
  bridge.onOpenRoute((route) => second.push(route))
  handlers.get('valkama:open-route')({}, '/a')
  assert.deepEqual([first, second], [[], ['/a']])

  sent.length = 0
  bridge.onOpenRoute('not a function')
  assert.deepEqual(sent, [])
})

const LOCALE = 'valkama-locale'
const WIDTH = 'valkama-navigation-width'

test('the window hears the language and the rail width once the page has loaded', () => {
  const page = fakePage({ storage: { [LOCALE]: 'ru', [WIDTH]: '320' } })
  const { reports } = loadBridge(page)
  assert.deepEqual(reports, [])
  page.dispatch('window', 'DOMContentLoaded')
  assert.deepEqual(reports, [{ locale: 'ru', navWidth: '320' }])
})

test('a width the reader changes reaches the window after the input that changed it', () => {
  const page = fakePage({ storage: { [LOCALE]: 'en', [WIDTH]: '260' } })
  const { reports } = loadBridge(page)
  page.dispatch('window', 'DOMContentLoaded')
  reports.length = 0

  // The drag lets go; the page's own handler stores the width after the preload hears it.
  page.dispatch('window', 'pointerup')
  page.storage[WIDTH] = '412'
  assert.deepEqual(reports, [], 'read before the page had stored it')
  page.runTimers()
  assert.deepEqual(reports, [{ locale: 'en', navWidth: '412' }])

  // A key steps it again.
  page.dispatch('window', 'keyup')
  page.storage[WIDTH] = '428'
  page.runTimers()
  assert.deepEqual(reports.at(-1), { locale: 'en', navWidth: '428' })

  // Input that changed nothing says nothing.
  const said = reports.length
  for (const input of ['pointerup', 'click', 'keyup', 'change']) page.dispatch('window', input)
  page.runTimers()
  assert.equal(reports.length, said)
})

test('a change the window has not heard yet reaches it as the page goes away or is hidden', () => {
  const page = fakePage({ storage: { [WIDTH]: '300' } })
  const { reports } = loadBridge(page)
  page.dispatch('window', 'DOMContentLoaded')
  // Stored, and the window closed before the timer after the input could run.
  page.dispatch('window', 'pointerup')
  page.storage[WIDTH] = '360'
  page.dispatch('window', 'pagehide')
  assert.deepEqual(reports.at(-1), { locale: null, navWidth: '360' })

  page.storage[WIDTH] = '380'
  page.dispatch('document', 'visibilitychange')
  assert.deepEqual(reports.at(-1), { locale: null, navWidth: '360' }, 'still visible')
  page.visibilityState = 'hidden'
  page.dispatch('document', 'visibilitychange')
  assert.deepEqual(reports.at(-1), { locale: null, navWidth: '380' })
})

test('a page without storage of its own, the starting page, reports nothing', () => {
  const page = fakePage({ storageThrows: true })
  const { reports } = loadBridge(page)
  page.dispatch('window', 'DOMContentLoaded')
  page.dispatch('window', 'pointerup')
  page.runTimers()
  page.dispatch('window', 'pagehide')
  assert.deepEqual(reports, [])
})
