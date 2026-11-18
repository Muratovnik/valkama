import type { Page } from '@playwright/test'

/**
 * Where the words of each window's forecast line start against the line under it, the reset's,
 * and where the hatch's swatch hangs, for each window whose forecast line leads with one: the
 * swatch inside its account's card, and the swatch itself what stands at its centre, so no
 * ancestor clips it and nothing covers it.
 */
export const swatchLines = (page: Page) =>
  page
    .locator('[data-window]:has([data-fact="forecast"] [data-mark="hatch"])')
    .evaluateAll((windows) =>
      windows.map((window) => {
        /** Where a line's first words start, in pixels from the viewport's left. */
        const wordsStart = (line: Element | null) => {
          const walker = document.createTreeWalker(line ?? document.body, NodeFilter.SHOW_TEXT)
          for (let text = walker.nextNode(); text; text = walker.nextNode()) {
            if (!text.textContent?.trim()) continue
            const range = document.createRange()
            range.selectNodeContents(text)
            return range.getClientRects()[0]?.left ?? Number.NaN
          }
          return Number.NaN
        }
        const swatch = window.querySelector('[data-fact="forecast"] [data-mark="hatch"]')
        swatch?.scrollIntoView({ block: 'center' })
        const box = swatch?.getBoundingClientRect()
        const card = window.closest('[data-account]')?.getBoundingClientRect()
        const seen =
          box !== undefined &&
          document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) === swatch
        return {
          key: `${window.closest<HTMLElement>('[data-account]')?.dataset.account ?? ''} ${(window as HTMLElement).dataset.window ?? ''}`,
          forecast: wordsStart(window.querySelector('[data-fact="forecast"]')),
          reset: wordsStart(window.querySelector('[data-fact="reset"]')),
          swatch: box ? { left: box.left, right: box.right, width: box.width } : null,
          inCard:
            box !== undefined &&
            card !== undefined &&
            box.left >= card.left &&
            box.right <= card.right &&
            box.width > 0,
          seen,
        }
      }),
    )
