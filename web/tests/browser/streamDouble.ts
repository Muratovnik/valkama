import type { Page } from '@playwright/test'

/**
 * An `EventSource` the test drives: it drops every open stream or delivers a
 * frame to it on request, the way a server going away and coming back does.
 *
 * It replaces the quiet stream the backend installs, so it is installed after
 * the backend.
 */
export async function installStreamDouble(page: Page): Promise<{
  deliver: (data: string) => Promise<void>
  drop: () => Promise<void>
}> {
  await page.addInitScript(() => {
    type Listener = (event: Event) => void
    const streams: DrivenEventSource[] = []
    class DrivenEventSource {
      readonly url: string
      readonly readyState = 1
      readonly withCredentials = false
      private readonly listeners = new Map<string, Set<Listener>>()
      constructor(url: string | URL) {
        this.url = String(url)
        streams.push(this)
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
        streams.splice(streams.indexOf(this), 1)
      }
    }
    Object.defineProperty(window, 'EventSource', { configurable: true, value: DrivenEventSource })
    Object.defineProperty(window, '__streams', { configurable: true, value: streams })
  })
  type Driven = { fire: (event: Event) => void }
  return {
    drop: () =>
      page.evaluate(() => {
        for (const stream of (window as unknown as { __streams: Driven[] }).__streams)
          stream.fire(new Event('error'))
      }),
    deliver: (data: string) =>
      page.evaluate((frame) => {
        for (const stream of (window as unknown as { __streams: Driven[] }).__streams)
          stream.fire(new MessageEvent('message', { data: frame }))
      }, data),
  }
}
