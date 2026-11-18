import type { Page } from '@playwright/test'

/**
 * Where each window's forecast line stands against the line under it, the reset's (`QuotaWindow`,
 * `data-fact`): where the words of each start, and the leftmost box of anything the forecast line
 * draws — itself, every element in it and every run of its text — so nothing of it can hang left
 * of the column its words start in, as a key once hung in the card's inset before them. Run in
 * the page, so it carries everything it calls.
 */
function linesOf(windows: Element[]) {
  return windows.map((window) => {
    /** The boxes of every run of a line's text, in pixels from the viewport's left. */
    // This body is serialized and evaluated in the page, so a module-scope
    // helper would not be in scope here.
    // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
    const runs = (line: Element | null) => {
      const boxes: DOMRect[] = []
      if (!line) return boxes
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
      for (let text = walker.nextNode(); text; text = walker.nextNode()) {
        if (!text.textContent?.trim()) continue
        const range = document.createRange()
        range.selectNodeContents(text)
        boxes.push(...range.getClientRects())
      }
      return boxes
    }
    const forecast = window.querySelector('[data-fact="forecast"]')
    const reset = window.querySelector('[data-fact="reset"]')
    const drawn = forecast
      ? [forecast, ...forecast.querySelectorAll('*')]
          .map((element) => element.getBoundingClientRect())
          .filter((box) => box.width > 0 || box.height > 0)
      : []
    const lefts = [...drawn, ...runs(forecast)].map((box) => box.left)
    return {
      key: `${window.closest<HTMLElement>('[data-account]')?.dataset.account ?? ''} ${(window as HTMLElement).dataset.window ?? ''}`,
      forecast: Math.min(...runs(forecast).map((box) => box.left)),
      reset: Math.min(...runs(reset).map((box) => box.left)),
      leftmost: lefts.length ? Math.min(...lefts) : Number.NaN,
      /** How many elements the line draws besides its words. */
      marks: forecast?.querySelectorAll('*').length ?? -1,
    }
  })
}

export const forecastLines = (page: Page) =>
  page.locator('[data-window]:has([data-fact="forecast"])').evaluateAll(linesOf)
