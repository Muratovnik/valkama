/**
 * The live-work list in the browser: an `EventSource` that counts what a tab opens and
 * delivers `event: live` frames as the server does, the pin's route, and the rail's rows as
 * the specs read them.
 *
 * The server sends a stream the current frame when it opens and every later one to each
 * stream that is open. Here the current frame is the last one a spec delivered or the pin
 * answered with; until a spec delivers one there is none, as if the server had not yet
 * computed it, so a spec decides when the first frame lands. A tab briefly holds two
 * streams at its start, and the shell closes its own once the space's stream has delivered:
 * a frame sent at open is what ends that, as it does against the server.
 *
 * Installed after the backend, whose quiet stream it replaces.
 */
import type { Page } from '@playwright/test'

import type { LiveFrame } from '@/shared/api/liveFrameModel.ts'

export interface LiveStreams {
  /** Make this the current frame and deliver it as `event: live` to every open stream. */
  live: (frame: LiveFrame) => Promise<void>
  /** The streams the page has made since it loaded, open or closed, by address. */
  made: () => Promise<string[]>
  /** The addresses of the streams open now. */
  open: () => Promise<string[]>
}

type Streams = {
  current: (data: string) => void
  live: (data: string) => void
  made: () => string[]
  open: () => string[]
}

export async function installLiveStreams(
  page: Page,
  options: {
    /**
     * A stream that opens is sent the current frame, as the server sends it. Off, a frame
     * reaches only the streams open when a spec delivers it, so a spec can hold a stream
     * without its first frame for as long as it needs.
     */
    sendOnOpen?: boolean
  } = {},
): Promise<LiveStreams> {
  await page.addInitScript((sendOnOpen: boolean) => {
    type Listener = (event: Event) => void
    const open: CountedEventSource[] = []
    const made: string[] = []
    let current: string | null = null
    class CountedEventSource {
      readonly url: string
      readonly readyState = 1
      readonly withCredentials = false
      private readonly listeners = new Map<string, Set<Listener>>()
      constructor(url: string | URL) {
        this.url = String(url)
        made.push(this.url)
        open.push(this)
        // After the caller has added its listeners, as a frame comes over the network.
        if (sendOnOpen)
          setTimeout(() => {
            if (current !== null && open.includes(this))
              this.fire(new MessageEvent('live', { data: current }))
          }, 0)
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
        current: (data: string) => {
          current = data
        },
        open: () => open.map((stream) => stream.url),
        made: () => [...made],
        live: (data: string) => {
          current = data
          for (const stream of open) stream.fire(new MessageEvent('live', { data }))
        },
      } satisfies Streams,
    })
  }, options.sendOnOpen ?? true)
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

/**
 * The pin's route: what it was sent, and the frame it answers with. That frame is the
 * server's current one from then on, so a stream opened later is sent it.
 */
export async function servePins(page: Page, answer: (body: unknown) => LiveFrame) {
  const sent: unknown[] = []
  await page.route('**/api/planning/work-item/pin', async (route) => {
    const body = route.request().postDataJSON() as unknown
    sent.push(body)
    const frame = JSON.stringify(answer(body))
    await page.evaluate((data) => {
      ;(window as unknown as { __liveStreams?: Streams }).__liveStreams?.current(data)
    }, frame)
    return route.fulfill({ contentType: 'application/json', body: frame })
  })
  return sent
}

/** Open every fold of a list, so that every row of the frame stands in it. */
export async function openFolds(page: Page, within: string) {
  for (const fold of await page.locator(`${within} .nav-fold-toggle`).all()) await fold.click()
  await page.mouse.move(0, 0)
}

/** The rail's row of an item, by its reference, in the list or in the phone's panel. */
export const liveRow = (page: Page, reference: string, within = '.nav-work-list') =>
  page.locator(`${within} .nav-row`, {
    has: page.locator(`.nav-row-link[aria-label^="${reference} "]`),
  })
