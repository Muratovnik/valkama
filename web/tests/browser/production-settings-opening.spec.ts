import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installAlerts } from './alertsFixtures.ts'
import { installBackend } from './backend.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { projectScope } from './planningFixtures.ts'
import { test } from './test.ts'

const SETTINGS = serializePlatformRoute({ module_id: 'settings', scope: projectScope })

const section = (page: Page, title: string) =>
  page.locator('.settings-group').filter({ has: page.getByRole('heading', { name: title }) })

async function openSection(page: Page, title: string) {
  await installBackend(page)
  await installAlerts(page)
  await page.goto(SETTINGS)
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  return section(page, title)
}

for (const { locale, title } of [
  { locale: 'en', title: 'Opening sessions and files' },
  { locale: 'ru', title: 'Открытие сессий и файлов' },
] as const)
  test(`the opening section reads whole at both widths in ${locale}`, async ({ page }, info) => {
    await page.addInitScript((value) => localStorage.setItem('valkama-locale', value), locale)
    await page.setViewportSize({ width: 1280, height: 1400 })
    const group = await openSection(page, title)
    // Two places for each family Valkama resumes, the command for the rest, the editor.
    await expect(group.getByRole('combobox')).toHaveCount(6)
    await expectNoSilentClipping(page, `opening section at 1280px in ${locale}`)
    await group.screenshot({ path: info.outputPath(`opening-${locale}-1280.png`) })

    await page.setViewportSize({ width: 390, height: 1600 })
    await expectNoSilentClipping(page, `opening section at 390px in ${locale}`)
    await group.screenshot({ path: info.outputPath(`opening-${locale}-390.png`) })
  })

test('"always open in" is chosen from the keyboard, said beside the family and kept', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1280, height: 1400 })
  const group = await openSection(page, 'Opening sessions and files')
  const always = page.getByRole('combobox', { name: 'Codex: Always open in' })
  await always.focus()
  await page.keyboard.press('Enter')
  await page.getByRole('option', { name: 'Terminal' }).press('Enter')
  await expect(always).toBeFocused()
  await expect(group.locator('.settings-opening-note')).toContainText(
    'Every Codex session opens in Terminal',
  )
  await group.screenshot({ path: info.outputPath('opening-override.png') })

  await page.reload()
  await expect(page.getByRole('combobox', { name: 'Codex: Always open in' })).toContainText(
    'Terminal',
  )
})

test('the section keeps its edges and its words in a forced palette', async ({ page }, info) => {
  await page.emulateMedia({ forcedColors: 'active' })
  await page.setViewportSize({ width: 1280, height: 1400 })
  const group = await openSection(page, 'Opening sessions and files')
  const trigger = group.getByRole('combobox', { name: 'Editor for files' })
  await trigger.focus()
  expect(await trigger.evaluate((node) => getComputedStyle(node).outlineStyle)).toBe('solid')
  await group.screenshot({ path: info.outputPath('opening-forced.png') })
})
