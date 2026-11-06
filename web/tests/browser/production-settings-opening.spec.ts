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
    'Every Codex session opens in a terminal',
  )
  await group.screenshot({ path: info.outputPath('opening-override.png') })

  await page.reload()
  await expect(page.getByRole('combobox', { name: 'Codex: Always open in' })).toContainText(
    'Terminal',
  )
})

test('a place that is not installed is not offered, and the command says what it takes', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 1800 })
  const group = await openSection(page, 'Opening sessions and files')
  await page.getByRole('combobox', { name: 'Editor for files' }).click()
  await expect(page.getByRole('option', { name: 'VS Code', exact: true })).toBeVisible()
  await expect(page.getByRole('option', { name: 'Cursor' })).toHaveCount(0)
  await page.keyboard.press('Escape')

  await page.getByRole('combobox', { name: 'Claude Code: Always open in' }).click()
  await page.getByRole('option', { name: 'Your own command' }).click()
  const command = group.getByRole('textbox', { name: 'Command' })
  await expect(command).toBeVisible()
  // The placeholders are named as they are typed, not filled in by the dictionary.
  await expect(group).toContainText('{session}, {cwd} and {session_cwd}')
  await expectNoSilentClipping(page, 'the command at 390px')
  await group.screenshot({ path: info.outputPath('opening-command.png') })
})

test('a command is asked for only once the field is left empty, and what holds is said', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 1400 })
  const group = await openSection(page, 'Opening sessions and files')
  const always = page.getByRole('combobox', { name: 'Claude Code: Always open in' })
  await always.click()
  await page.getByRole('option', { name: 'Your own command' }).click()
  const command = group.getByRole('textbox', { name: 'Command' })
  // Chosen and kept, with nothing to correct yet: what a press does until there is a command.
  await expect(always).toContainText('Your own command')
  await expect(command).not.toHaveAttribute('aria-invalid', 'true')
  await expect(group.locator('.field-error, [role="alert"]')).toHaveCount(0)
  await expect(group).toContainText('Until there is a command, these sessions do not open.')
  // Saved as chosen, with no command: the choice survives a reload, still with no error.
  await page.reload()
  await expect(always).toContainText('Your own command')
  await expect(command).not.toHaveAttribute('aria-invalid', 'true')

  await command.focus()
  await page.keyboard.press('Tab')
  await expect(command).toHaveAttribute('aria-invalid', 'true')
  await expect(command).toHaveAccessibleDescription(/Enter a command to open sessions with\./u)

  await command.fill('code {cwd}')
  await expect(command).not.toHaveAttribute('aria-invalid', 'true')
  await expect(group).not.toContainText('Enter a command to open sessions with.')
  await expect(group).not.toContainText('Until there is a command')

  await page.reload()
  await expect(group.getByRole('textbox', { name: 'Command' })).toHaveValue('code {cwd}')
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

// A forced palette paints the danger ink and the muted one alike, so a refused command has
// to read as refused by its shape: a mark beside its words, which the hint has not, and an
// edge on the field that its empty, untouched self has not.
test('a refused command is told from its hint without colour', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' })
  await page.setViewportSize({ width: 1280, height: 1400 })
  const group = await openSection(page, 'Opening sessions and files')
  await group.getByRole('combobox', { name: 'Claude Code: Always open in' }).click()
  await page.getByRole('option', { name: 'Your own command' }).click()
  const command = group.getByRole('textbox', { name: 'Command' })
  // Away from the field, so that neither look is its hover.
  await page.mouse.move(0, 0)
  const untouched = await command.screenshot()

  await command.focus()
  await page.keyboard.press('Tab')
  await expect(command).toHaveAttribute('aria-invalid', 'true')
  const refused = await command.screenshot()
  expect(refused.equals(untouched), 'the refused field looks untouched').toBe(false)
  // The field is described by the refusal and by its hint, each an element of its own.
  const describedBy = await command.getAttribute('aria-describedby')
  const ids = describedBy?.split(' ') ?? []
  const describers = page.locator(ids.map((id) => `[id="${id}"]`).join(', '))
  await expect(describers).toHaveCount(2)
  const message = describers.filter({ hasText: 'Enter a command to open sessions with.' })
  await expect(message).toHaveText('Enter a command to open sessions with.')
  await expect(message.locator('svg')).toHaveCount(1)
  const hint = describers.filter({ hasText: 'Runs instead of opening the session' })
  await expect(hint).toBeVisible()
  await expect(hint.locator('svg')).toHaveCount(0)
})
