/**
 * The harness draws its surfaces in the interface font the app draws them in, so a spec here
 * measures text as a reader sees it. In a checkout whose `node_modules` is a link to another
 * one's, the dev server refused the font's file, and the harness had never asked for it: every
 * spec here measured Onest, the stack's second font.
 *
 * The font is read off the surface once it is drawn, and read again until it holds: the dev
 * server may load the page a second time when it rebuilds its dependencies, and a read taken
 * in the new page before its styles came in found no font named, under load on a cold server.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { test } from './test.ts'

/** The interface font as the page names it, the faces it declares, and each script in it. */
const fontOf = (page: Page) =>
  page.evaluate(async () => {
    await document.fonts.ready
    const family = getComputedStyle(document.body)
      .getPropertyValue('--font-family-interface')
      .split(',')[0]
      ?.trim()
      .replaceAll(/["']/gu, '')
    const faces = async (text: string) => {
      try {
        const loaded = await document.fonts.load(`400 16px "${family}"`, text)
        return loaded.map((face) => face.status)
      } catch (error) {
        return [String(error)]
      }
    }
    return {
      family,
      declared: [...document.fonts].filter((face) => face.family === family).length,
      latin: await faces('Valkama'),
      cyrillic: await faces('Валкама'),
    }
  })

test('the harness draws in the interface font, Latin and Cyrillic loaded', async ({ page }) => {
  const refused: string[] = []
  page.on('response', (response) => {
    if (response.status() >= 400 && /\.woff2?$/u.test(response.url()))
      refused.push(`${response.status()} ${response.url()}`)
  })
  await page.goto('/tests/browser/harness.html?lang=ru&surface=buttons')
  await expect(page.locator('[data-case]').first()).toBeVisible()
  await expect(async () => {
    const drawn = await fontOf(page)
    expect(drawn.family, 'the interface font, named first').toBe('Inter Variable')
    expect(drawn.declared, 'the harness declares the interface font').toBeGreaterThan(0)
    expect(drawn, 'each script loaded in it').toMatchObject({
      latin: ['loaded'],
      cyrillic: ['loaded'],
    })
  }).toPass({ timeout: 10_000 })
  expect(refused, 'no font file refused').toEqual([])
})
