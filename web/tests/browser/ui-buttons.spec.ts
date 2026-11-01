import { expect, test } from '@playwright/test'

import { buttonStateFailures } from './buttonStates.ts'
import type { ButtonLooks } from './buttonStates.ts'
import { drawnColours } from './contrast.ts'

/**
 * A button's states read as one weight: hover is the same variant one step
 * stronger, never a step toward unavailable, and unavailable is a look of its
 * own. A state rule of the base once outranked the variant's fill, so a hovered
 * primary went dark under its dark label — which is how a disabled button looks.
 * Computed colours need a real engine, so this reads them from one.
 */
test('every button weight keeps its label legible at rest, hovered and disabled, and hover never reads as disabled', async ({
  page,
}) => {
  await page.goto('/tests/browser/harness.html?lang=ru&surface=buttons')
  const buttons = page.locator('[data-case]')
  await expect(buttons).toHaveCount(32)
  const looks: ButtonLooks[] = []
  for (const button of await buttons.all()) {
    await page.mouse.move(0, 0)
    const rest = await button.evaluate(drawnColours, 'own')
    // A disabled button refuses actionability, so the pointer goes to its box.
    const box = await button.boundingBox()
    await page.mouse.move((box?.x ?? 0) + 4, (box?.y ?? 0) + 4)
    const hover = await button.evaluate(drawnColours, 'own')
    looks.push({ hover, name: (await button.getAttribute('data-case')) ?? '', rest })
  }
  expect(buttonStateFailures(looks)).toEqual([])
})
