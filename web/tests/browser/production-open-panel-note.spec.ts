/**
 * The words the panel of a session says of what came of a step, on a phone's width, in both
 * languages: a line of them never ends the note with one word alone. «Now open the session in
 * it.» left «it.» a line of its own at 390, and «нём.» in Russian.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { enableExecutionTab } from './executionFixtures.ts'
import { frames } from './frames.ts'
import { heldCard, openPlanFor, threeAgents } from './openSessionFixtures.ts'
import { projectScope, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'
import { drawnLines } from './textLines.ts'

const CARD = serializePlatformRoute({
  module_id: 'planning',
  scope: projectScope,
  entity: planningWorkItemEntity(workItemRef),
})

const WORDS = {
  en: { title: 'Open session', first: 'Open the project window in VS Code' },
  ru: { title: 'Открыть сессию', first: 'Открыть окно проекта в VS Code' },
} as const

async function firstStepTaken(page: Page, locale: 'en' | 'ru', width: number) {
  await page.setViewportSize({ width, height: 900 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript((language) => localStorage.setItem('valkama-locale', language), locale)
  await enableExecutionTab(page)
  await installBackend(page, { agents: threeAgents, card: heldCard, openPlan: openPlanFor })
  await page.goto(CARD)
  await page.locator('.drawer .card-holder button.open-action').click()
  const panel = page.getByRole('dialog', { name: WORDS[locale].title })
  await panel.getByRole('button', { name: WORDS[locale].first }).click()
  const note = panel.locator('.open-panel-note')
  await expect(note).not.toBeEmpty()
  await page.evaluate(() => document.fonts.ready)
  await frames(note)
  return note
}

for (const locale of ['en', 'ru'] as const)
  for (const width of [320, 390, 430])
    test(`${locale} at ${width}: the note of what came of a step ends on more than one word`, async ({
      page,
    }) => {
      const note = await firstStepTaken(page, locale, width)
      const drawn = await drawnLines(note)
      const lines = drawn.map((line) => line.text)
      const where = `${locale} at ${width}: ${JSON.stringify(lines)}`
      expect(lines.length, where).toBeGreaterThan(0)
      expect(lines.at(-1)?.split(/\s+/u).length, where).toBeGreaterThan(1)
    })
