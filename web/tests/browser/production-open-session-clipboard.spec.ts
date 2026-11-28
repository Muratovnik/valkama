/**
 * A session long silent, from a card: it warns first, and the command that resumes it reaches the
 * clipboard only on its own press. The clipboard is read back from the system's, which this spec
 * is granted (`clipboardSpecs.ts`); the rest of the way to a session is in
 * `production-open-session.spec.ts`.
 */
import { expect } from '@playwright/test'

import { CRASHED, FOLDER_LINK, RESUME_COMMAND, SESSION_LINK } from './openSessionFixtures.ts'
import { openCard, openedLinks } from './openSessionPage.ts'
import { test } from './test.ts'

test('a session long silent warns first, and resumes only on its own press', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await openCard(page)
  const fromStep = page.locator(`.step-holder button.open-action[aria-description*="${CRASHED}"]`)
  await fromStep.focus()
  await page.keyboard.press('Enter')
  const panel = page.getByRole('dialog', { name: 'The session is running' })
  await expect(panel).toContainText('Last sign of it:')
  await expect(panel).toContainText('It may have crashed')
  await expect(panel).toContainText('a second process would write to the same transcript')
  const resume = panel.getByRole('button', { name: 'Copy the command, if the window is closed' })
  await expect(resume).toBeVisible()
  // Focus stands on the way to look at it, and walking those steps never reaches the offer.
  await expect(
    panel.getByRole('button', { name: 'Open the project window in VS Code' }),
  ).toBeFocused()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await expect(panel).toBeHidden()
  await expect.poll(() => openedLinks(page)).toEqual([FOLDER_LINK, SESSION_LINK])
  expect(await page.evaluate(() => navigator.clipboard.readText())).not.toBe(RESUME_COMMAND)

  await fromStep.focus()
  await page.keyboard.press('Enter')
  await resume.click()
  await expect(panel).toBeHidden()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(RESUME_COMMAND)
  await expect(
    page.getByRole('status').filter({ hasText: /^Command for session .* copied/ }),
  ).toHaveCount(1)
})
