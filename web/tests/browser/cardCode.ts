import type { Page, Response } from '@playwright/test'

/** The card's code: the bundle's chunk of the card, which the board downloads once it stands. */
export const CARD_CHUNK = /\/assets\/WorkItemInspector-[\w-]+\.js$/

/**
 * Waits until the card's code is resident in the page: its chunk, `downloaded` (a
 * `page.waitForResponse(CARD_CHUNK)` made before the page opened), with every module it imports,
 * and the page's stylesheets, which the bundle waits for before it hands the card over.
 */
export async function cardCodeResident(page: Page, downloaded: Promise<Response>) {
  const response = await downloaded
  await page.evaluate(async (url) => {
    await import(url)
    const sheets = [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')]
    await Promise.all(
      sheets
        .filter((link) => link.sheet === null)
        .map(
          (link) =>
            new Promise((done) => {
              link.addEventListener('load', done, { once: true })
              link.addEventListener('error', done, { once: true })
            }),
        ),
    )
  }, response.url())
}
