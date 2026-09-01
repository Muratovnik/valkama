import type { Page } from '@playwright/test'

export async function installBrowserDoubles(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class QuietEventSource {
      readonly url: string
      readonly readyState = 1
      readonly withCredentials = false
      onopen: ((event: Event) => void) | null = null
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: ((event: Event) => void) | null = null
      constructor(url: string | URL) {
        this.url = String(url)
        setTimeout(() => this.onopen?.(new Event('open')), 0)
      }
      addEventListener() {}
      removeEventListener() {}
      dispatchEvent() {
        return true
      }
      close() {
        ;(window as unknown as { __closedStreams: string[] }).__closedStreams ??= []
        ;(window as unknown as { __closedStreams: string[] }).__closedStreams.push(this.url)
      }
    }
    Object.defineProperty(window, 'EventSource', { configurable: true, value: QuietEventSource })
    Object.defineProperty(window, 'open', {
      configurable: true,
      value: (uri: string) => {
        ;(window as unknown as { __opened: string[] }).__opened ??= []
        ;(window as unknown as { __opened: string[] }).__opened.push(uri)
        return window
      },
    })
  })
}
