/**
 * The live-work list in the browser: an `EventSource` that counts what a tab opens and
 * delivers `event: live` frames to every stream that is open, the pin's route, and the
 * rail's rows as the specs read them.
 *
 * Installed after the backend, whose quiet stream it replaces.
 */
import type { Page } from '@playwright/test'

import type { LiveFrame } from '@/shared/api/liveFrameModel.ts'

export interface LiveStreams {
  /** Deliver a frame as `event: live` to every open stream. */
  live: (frame: LiveFrame) => Promise<void>
  /** The streams the page has made since it loaded, open or closed, by address. */
  made: () => Promise<string[]>
  /** The addresses of the streams open now. */
  open: () => Promise<string[]>
}

export async function installLiveStreams(page: Page): Promise<LiveStreams> {
  await page.addInitScript(() => {
    type Listener = (event: Event) => void
    const open: CountedEventSource[] = []
    const made: string[] = []
    class CountedEventSource {
      readonly url: string
      readonly readyState = 1
      readonly withCredentials = false
      private readonly listeners = new Map<string, Set<Listener>>()
      constructor(url: string | URL) {
        this.url = String(url)
        made.push(this.url)
        open.push(this)
      }
      addEventListener(type: string, listener: Listener) {
        const known = this.listeners.get(type) ?? new Set<Listener>()
        known.add(listener)
        this.listeners.set(type, known)
      }
      removeEventListener(type: string, listener: Listener) {
        this.listeners.get(type)?.delete(listener)
      }
      fire(event: Event) {
        for (const listener of this.listeners.get(event.type) ?? []) listener(event)
      }
      dispatchEvent() {
        return true
      }
      close() {
        const index = open.indexOf(this)
        if (index !== -1) open.splice(index, 1)
      }
    }
    Object.defineProperty(window, 'EventSource', {
      configurable: true,
      value: CountedEventSource,
    })
    Object.defineProperty(window, '__liveStreams', {
      configurable: true,
      value: {
        open: () => open.map((stream) => stream.url),
        made: () => [...made],
        live: (data: string) => {
          for (const stream of open) stream.fire(new MessageEvent('live', { data }))
        },
      },
    })
  })
  type Streams = { live: (data: string) => void; made: () => string[]; open: () => string[] }
  return {
    live: (frame) =>
      page.evaluate((data) => {
        ;(window as unknown as { __liveStreams: Streams }).__liveStreams.live(data)
      }, JSON.stringify(frame)),
    made: () =>
      page.evaluate(() => (window as unknown as { __liveStreams: Streams }).__liveStreams.made()),
    open: () =>
      page.evaluate(() => (window as unknown as { __liveStreams: Streams }).__liveStreams.open()),
  }
}

/** The pin's route: what it was sent, and the frame it answers with. */
export async function servePins(page: Page, answer: (body: unknown) => LiveFrame) {
  const sent: unknown[] = []
  await page.route('**/api/planning/work-item/pin', (route) => {
    const body = route.request().postDataJSON() as unknown
    sent.push(body)
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(answer(body)) })
  })
  return sent
}

/** Open every space's quiet rows in a list, so that every row of the frame stands in it. */
export async function openQuiet(page: Page, within: string) {
  for (const fold of await page.locator(`${within} .nav-quiet-fold`).all()) await fold.click()
  await page.mouse.move(0, 0)
}

/** The rail's row of an item, by its reference, in the list or in the phone's panel. */
export const liveRow = (page: Page, reference: string, within = '.nav-work-list') =>
  page.locator(`${within} .nav-row`, {
    has: page.locator(`.nav-row-link[aria-label^="${reference} "]`),
  })
