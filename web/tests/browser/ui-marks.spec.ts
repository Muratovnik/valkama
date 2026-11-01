/**
 * Marks and control states in the browser: what a colour rule says, read back
 * as the colour the page actually paints.
 */
import { expect, test } from '@playwright/test'

test('a thrown switch is not painted the hue of finished work', async ({ page }) => {
  await page.goto('/tests/browser/harness.html?lang=en&surface=marks')
  const track = (which: string) =>
    page.locator(`[data-switch="${which}"] .toggle-track`).evaluate((node) => {
      const probe = document.createElement('i')
      document.body.append(probe)
      const paint = (token: string) => {
        probe.style.background = `var(${token})`
        return getComputedStyle(probe).backgroundColor
      }
      const result = {
        track: getComputedStyle(node).backgroundColor,
        meaning: ['--color-success', '--color-info', '--color-warning', '--color-danger'].map(
          (token) => paint(token),
        ),
        primary: paint('--color-action-primary'),
      }
      probe.remove()
      return result
    })
  const on = await track('on')
  const off = await track('off')
  // "On" says where a control stands, so it takes no meaning hue at all.
  expect(on.meaning).not.toContain(on.track)
  expect(on.track).toBe(on.primary)
  // And it still reads as different from "off".
  expect(on.track).not.toBe(off.track)
})

test('a facet mark paints its glyph in the tone the state owner gave it, and a kind in none', async ({
  page,
}) => {
  await page.goto('/tests/browser/harness.html?lang=ru&surface=marks')
  const card = page.locator('[data-harness="card"] [data-item="MAIN-1008"]')
  const paint = (selector: string) =>
    card
      .locator(selector)
      .first()
      .evaluate((node) => {
        const probe = document.createElement('i')
        document.body.append(probe)
        const token = (name: string) => {
          probe.style.color = `var(${name})`
          return getComputedStyle(probe).color
        }
        const result = {
          glyph: getComputedStyle(node).color,
          danger: token('--color-danger'),
          tertiary: token('--color-text-tertiary'),
        }
        probe.remove()
        return result
      })
  const urgent = await paint('[data-facet="priority"] .facet-glyph')
  expect(urgent.glyph).toBe(urgent.danger)
  const kind = await paint('[data-facet="kind"] .facet-glyph')
  expect(kind.glyph).toBe(kind.tertiary)
  // A label chip stands on its lifted face, not on a recess cut into the card.
  const chip = await card
    .locator('.label-chip .chip-face')
    .first()
    .evaluate((node) => {
      const probe = document.createElement('i')
      document.body.append(probe)
      probe.style.background = 'var(--color-chip-face)'
      const face = getComputedStyle(probe).backgroundColor
      probe.remove()
      return { fill: getComputedStyle(node).backgroundColor, face }
    })
  expect(chip.fill).toBe(chip.face)
})
