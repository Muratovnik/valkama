import type { Page } from '@playwright/test'

/**
 * Keeps every error the page reports to its window from its first script on, and returns how to
 * read them. A ResizeObserver loop is reported there and not thrown, so `pageerror` never sees it.
 * Call it before the page opens.
 */
export async function keepWindowErrors(page: Page) {
  await page.addInitScript(() => {
    const seen: string[] = []
    Object.assign(window, { seenErrors: seen })
    window.addEventListener('error', (event) => seen.push(String(event.message)))
  })
  return () =>
    page.evaluate(() => (window as unknown as { seenErrors: string[] }).seenErrors.slice())
}
