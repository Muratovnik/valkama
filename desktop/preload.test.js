'use strict'

const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

function loadBridge() {
  const calls = []
  const handlers = new Map()
  const sent = []
  let bridge = null
  const source = readFileSync(path.join(__dirname, 'preload.js'), 'utf8')
  vm.runInNewContext(source, {
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
          send(channel) {
            sent.push(channel)
          },
        },
      }
    },
  })
  return { bridge, calls, handlers, sent }
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
