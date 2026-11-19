/**
 * The Analytics page walked by Tab: which of its controls Tab reaches, and which it never does.
 */
import type { Page } from '@playwright/test'

/**
 * What Tab stands on in the page, in order, until it leaves it: each control marked first, so
 * the walk names what it reached and what it never did. A group of radios is one stop, its
 * chosen option; the arrows move inside it.
 */
export async function tabWalk(page: Page) {
  const controls = await page.evaluate(() => {
    for (const marked of document.querySelectorAll<HTMLElement>('[data-stop]'))
      delete marked.dataset.stop
    const all = document.querySelectorAll<HTMLElement>(
      '.analytics-page :is(a[href], button, input, select, textarea, summary, [tabindex])',
    )
    const stops = [...all].filter(
      (element) =>
        element.tabIndex >= 0 &&
        !element.matches(':disabled') &&
        // Shown, and not in a closed disclosure, whose content the browser skips.
        element.checkVisibility({ visibilityProperty: true }),
    )
    for (const [index, element] of stops.entries()) element.dataset.stop = String(index)
    return stops.length
  })
  await page.locator('body').focus()
  const reached = new Set<string>()
  for (let press = 0; press < 200 && reached.size < controls; press += 1) {
    await page.keyboard.press('Tab')
    const stop = await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.dataset.stop ?? null,
    )
    if (stop !== null) reached.add(stop)
  }
  /** The controls Tab never stood on, by what they say, so a failure names them. */
  const missed = await page.evaluate(
    (seen) =>
      [...document.querySelectorAll<HTMLElement>('[data-stop]')]
        .filter((element) => !seen.includes(element.dataset.stop ?? ''))
        .map(
          (element) =>
            `${element.tagName.toLowerCase()}.${element.className} ${element.getAttribute('aria-label') ?? element.textContent?.trim().slice(0, 40) ?? ''}`,
        ),
    [...reached],
  )
  return { controls, reached: reached.size, missed }
}
