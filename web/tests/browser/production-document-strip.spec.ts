import { expect } from '@playwright/test'

import { aCardAsking, LINK } from './documentBackend.ts'
import { settled, WINDOW } from './documentBeside.ts'
import { test } from './test.ts'

/**
 * A document beside a card, folded away, leaves a strip with the document's name on it. A
 * voice command says what it sees, so the strip is named by those words, as a window
 * splitter is named by the pane it sizes; that it sizes the document is its description,
 * and that it is folded its value. The strip stands only where the document stands beside
 * the card, so the window is wide.
 */

const WORDS = {
  'en-US': {
    name: 'Document: The migration plan',
    purpose: 'Document width',
    state: 'Folded. Enter or a click shows the document again',
  },
  'ru-RU': {
    name: 'Документ: The migration plan',
    purpose: 'Ширина документа',
    state: 'Свёрнут — Enter или щелчок снова покажут документ',
  },
} as const

for (const [locale, words] of Object.entries(WORDS))
  test.describe(`in ${locale}`, () => {
    test.use({ locale })

    test('the folded strip is named by the words it shows', async ({ page }) => {
      await page.setViewportSize(WINDOW)
      const { drawer } = await aCardAsking(page, `Read \`${LINK}\` first.`)
      await drawer.getByRole('link', { name: new RegExp(`${LINK}$`, 'u') }).click()
      const edge = page.locator('.overlay-pane [data-overlay-resizer]')
      await expect(edge).toHaveAccessibleName(words.purpose)
      await edge.focus()
      await page.keyboard.press('Enter')
      await settled(drawer)

      const shown = edge.locator('.overlay-resizer-name')
      await expect(shown).toHaveText(words.name)
      await expect(edge).toHaveRole('separator')
      await expect(edge).toHaveAccessibleName(words.name)
      await expect(edge).toHaveAccessibleDescription(words.purpose)
      await expect(edge).toHaveAttribute('aria-valuetext', words.state)

      // Unfolded, nothing is written on it, and it is named for what it does.
      await page.keyboard.press('Enter')
      await expect(edge).toHaveAccessibleName(words.purpose)
      await expect(edge).not.toHaveAttribute('aria-describedby')
    })
  })
