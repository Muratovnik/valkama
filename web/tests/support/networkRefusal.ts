import { afterAll, afterEach, expect } from 'vitest'

// A test reaches the network only through a double it installs itself. Without one, happy-dom
// resolves a relative address against its default origin and the request leaves the machine, and
// the test passes on whatever error branch the refused connection happens to take.
//
// Each door is replaced here by a refusal, assigned rather than stubbed: `vi.stubGlobal` in a spec
// still covers it, and `vi.unstubAllGlobals` (or a spec restoring what it saved) brings the refusal
// back, not the real door. The code under test may catch the refusal, so the test that made it is
// failed after it runs, by name and address.
//
// Doors: `fetch` and `EventSource`, which the app uses; `WebSocket`, which both environments give,
// and `XMLHttpRequest`, which happy-dom gives, for a dependency that reaches for them. Neither
// environment has an `EventSource`, so without this an unstubbed stream failed as a
// ReferenceError the caller may swallow.

interface Refusal {
  readonly request: string
  readonly test: string | undefined
}

const refusals: Refusal[] = []

function refuse(request: string): Error {
  refusals.push({ test: expect.getState().currentTestName, request })
  return new Error(`network refused in tests: ${request}; stub it in the spec`)
}

function addressOf(input: unknown): string {
  if (input instanceof URL) return input.href
  if (typeof input === 'object' && input !== null && 'url' in input) return String(input.url)
  return String(input)
}

function reportRefusals(): void {
  const made = refusals.splice(0)
  if (made.length === 0) return
  const lines = made.map(({ request, test = '(outside any test)' }) => `  ${test}: ${request}`)
  throw new Error(`unstubbed network request:\n${lines.join('\n')}`)
}

globalThis.fetch = ((input: unknown, init?: { method?: string }) => {
  const method =
    init?.method ??
    (typeof input === 'object' && input !== null && 'method' in input
      ? String(input.method)
      : 'GET')
  return Promise.reject(refuse(`fetch ${method} ${addressOf(input)}`))
}) as typeof fetch

class RefusedEventSource {
  constructor(address: string | URL) {
    throw refuse(`EventSource ${addressOf(address)}`)
  }
}
globalThis.EventSource = RefusedEventSource as unknown as typeof EventSource

class RefusedWebSocket {
  constructor(address: string | URL) {
    throw refuse(`WebSocket ${addressOf(address)}`)
  }
}
globalThis.WebSocket = RefusedWebSocket as unknown as typeof WebSocket

if (typeof globalThis.XMLHttpRequest === 'function') {
  globalThis.XMLHttpRequest = class extends globalThis.XMLHttpRequest {
    override open(method: string, address: string | URL): void {
      throw refuse(`XMLHttpRequest ${method} ${addressOf(address)}`)
    }
  }
}

afterEach(reportRefusals)
afterAll(reportRefusals)
