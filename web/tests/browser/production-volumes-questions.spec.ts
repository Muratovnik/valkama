/**
 * «Waiting for me» on the Volumes page of a space, or of a project of it, opens the questions
 * window narrowed to that scope, in the real app at 1280px and at 390px, in English and in
 * Russian. The oracle is DESIGN.md («Volumes» and «Questions waiting for an answer»): the window
 * lists the questions the number counts, read with the server's narrowing as the space's board
 * holds it (`other_spaces=true`, and `project_id` from a project), and under the page's kind
 * and label the tasks they keep (`task_kind`, `task_label`). It names the space, the project by
 * the name the context bar gives it, the kind and the label in a chip and says them in its
 * subtitle, and removing the chip lists every space's questions again; the rail's count stays
 * every space's. Nothing runs past the window's width. Each run prints what it measured and
 * keeps a picture.
 */
import { expect } from '@playwright/test'
import type { Route } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { requestEntry, requestList } from '../support/inputRequests.ts'
import { volumesAnswer } from '../support/volumesDouble.ts'
import { record, shortfalls } from './analyticsPage.ts'
import { installBackend } from './backend.ts'
import { projectId, spaceRef, spaceScope } from './planningFixtures.ts'
import { test } from './test.ts'

const SIZES = [
  { lang: 'en', width: 1280, height: 800 },
  { lang: 'en', width: 390, height: 844 },
  { lang: 'ru', width: 1280, height: 800 },
  { lang: 'ru', width: 390, height: 844 },
] as const

const WORDS = {
  en: {
    title: 'Needs my answer',
    space: 'Main',
    all: 'Show every space’s questions, not only those of Main',
    narrowed: 'On the board of Main',
    project: 'On the board of Main, project Example Project',
    filtered: 'On the board of Main, only on tasks of kind Bug with the label ui',
    bug: 'Bug',
  },
  ru: {
    title: 'Ждут моего ответа',
    space: 'Main',
    all: 'Показать вопросы всех пространств, а не только Main',
    narrowed: 'На доске пространства Main',
    project: 'На доске пространства Main, проект Example Project',
    filtered: 'На доске пространства Main, только на задачах вида «Дефект» с меткой «ui»',
    bug: 'Дефект',
  },
} as const

/** A question on a card of this space, and one on a card of another that the board does not hold. */
function questions() {
  const here = requestEntry()
  here.target = { space_ref: spaceRef, reference: 'MAIN-7', writable: true }
  here.request = { ...here.request, reference: 'MAIN-7', title: 'Confirm the release' }
  const away = requestEntry()
  away.target = {
    space_ref: { data_scope_id: spaceRef.data_scope_id, space_key: 'AWAY' },
    reference: 'AWAY-3',
    writable: true,
  }
  away.request = {
    ...away.request,
    request_id: '44444444-4444-4444-8444-444444444444',
    work_item_id: '55555555-5555-4555-8555-555555555555',
    reference: 'AWAY-3',
    title: 'Pick a region',
  }
  return { here, away }
}

const READY = {
  categories: {
    triage: 1,
    deferred: 0,
    ready: 1,
    active: 1,
    review: 0,
    completed: 0,
    cancelled: 0,
  },
  waiting: 1,
  unattached: 0,
  outside: { byProject: [], byLabel: [] },
}

for (const size of SIZES) {
  const words = WORDS[size.lang]
  const tag = `${size.lang} ${size.width}`

  test.describe(`The questions window from Volumes, ${size.lang} at ${size.width}px`, () => {
    test.use({ locale: size.lang === 'ru' ? 'ru-RU' : 'en-US' })

    test('opens on the space’s own questions and the chip brings every space’s back', async ({
      page,
    }, info) => {
      await page.setViewportSize({ width: size.width, height: size.height })
      await installBackend(page)
      const { here, away } = questions()
      const asked: string[] = []
      // Routed after the backend's own, so these answer the reads.
      await page.route('**/api/modules/planning/requests?*', (route: Route) => {
        const query = new URL(route.request().url()).searchParams
        const scope = query.get('scope_kind') ?? ''
        asked.push(scope === 'space' ? `space:${query}` : scope)
        return route.fulfill({
          json: { ...requestList(scope === 'space' ? [here] : [here, away]), coverage: [] },
        })
      })
      await page.route('**/api/planning/volumes?*', (route) =>
        route.fulfill({ json: volumesAnswer({ ...READY, goals: [] }) }),
      )
      await page.goto(serializePlatformRoute({ module_id: 'volumes', scope: spaceScope }))
      await expect(page.locator('.volumes-page')).toBeVisible()

      await page.locator('[data-number="waiting"]').click()
      const dialog = page.getByRole('dialog', { name: words.title, exact: true })
      await expect(dialog).toBeVisible()
      const chip = dialog.locator('[data-part="scope"]')
      await expect(chip).toHaveText(words.space)
      await expect(chip).toHaveAccessibleName(words.all)
      await expect(dialog).toContainText(words.narrowed)
      const cards = dialog.locator('[data-request-waiting]')
      await expect(cards).toHaveCount(1)
      await expect(cards).toContainText('Confirm the release')
      expect(asked.find((read) => read.startsWith('space:'))).toContain(
        'space_key=MAIN&other_spaces=true',
      )
      expect(asked).toContain('global')

      const parts = await shortfalls(page, '[role="dialog"] [data-part="scope"]')
      expect(parts.filter((part) => part.short > 0.5)).toEqual([])
      const sideways = await dialog.evaluate((frame) => frame.scrollWidth - frame.clientWidth)
      expect(sideways).toBeLessThanOrEqual(0)
      await page.screenshot({
        path: info.outputPath(`questions-scoped-${tag}.png`),
        animations: 'disabled',
      })

      await chip.click()
      await expect(chip).toHaveCount(0)
      await expect(cards).toHaveCount(2)
      await expect(dialog).toContainText('Pick a region')
      // Every space's questions are what the window lists unless told otherwise: no line says so.
      await expect(dialog).not.toContainText(words.narrowed)
      await page.screenshot({
        path: info.outputPath(`questions-all-${tag}.png`),
        animations: 'disabled',
      })
      await record(info, `questions ${tag}`, { asked, parts, sideways })
    })

    test('opens on a project’s questions from the Volumes page of the project', async ({
      page,
    }, info) => {
      await page.setViewportSize({ width: size.width, height: size.height })
      await installBackend(page)
      const { here, away } = questions()
      const narrowed: string[] = []
      await page.route('**/api/modules/planning/requests?*', (route: Route) => {
        const query = new URL(route.request().url()).searchParams
        const scoped = query.get('scope_kind') === 'space'
        if (scoped) narrowed.push(String(query))
        return route.fulfill({
          json: { ...requestList(scoped ? [here] : [here, away]), coverage: [] },
        })
      })
      await page.route('**/api/planning/volumes?*', (route) =>
        route.fulfill({ json: volumesAnswer({ ...READY, goals: [] }) }),
      )
      const project = { ...spaceScope, project_ref: { project_id: projectId } }
      await page.goto(serializePlatformRoute({ module_id: 'volumes', scope: project }))
      await expect(page.locator('.volumes-page')).toBeVisible()

      await page.locator('[data-number="waiting"]').click()
      const dialog = page.getByRole('dialog', { name: words.title, exact: true })
      const chip = dialog.locator('[data-part="scope"]')
      // The project by the name the context bar gives it, not by its id.
      await expect(chip).toHaveText(`${words.space} · Example Project`)
      await expect(dialog).toContainText(words.project)
      await expect(dialog.locator('[data-request-waiting]')).toHaveCount(1)
      expect(narrowed[0]).toContain(`other_spaces=true&project_id=${projectId}`)
      const parts = await shortfalls(page, '[role="dialog"] [data-part="scope"]')
      expect(parts.filter((part) => part.short > 0.5)).toEqual([])
      const sideways = await dialog.evaluate((frame) => frame.scrollWidth - frame.clientWidth)
      expect(sideways).toBeLessThanOrEqual(0)
      await page.screenshot({
        path: info.outputPath(`questions-project-${tag}.png`),
        animations: 'disabled',
      })
      await record(info, `questions project ${tag}`, { narrowed, parts, sideways })
    })

    test('reads the page’s kind and label and says them in the chip and the subtitle', async ({
      page,
    }, info) => {
      await page.setViewportSize({ width: size.width, height: size.height })
      await installBackend(page)
      const { here, away } = questions()
      const narrowed: string[] = []
      await page.route('**/api/modules/planning/requests?*', (route: Route) => {
        const query = new URL(route.request().url()).searchParams
        const scoped = query.get('scope_kind') === 'space'
        if (scoped) narrowed.push(String(query))
        return route.fulfill({
          json: { ...requestList(scoped ? [here] : [here, away]), coverage: [] },
        })
      })
      await page.route('**/api/planning/volumes?*', (route) =>
        route.fulfill({
          json: volumesAnswer({ ...READY, goals: [], filter: { kinds: ['bug'], labels: ['ui'] } }),
        }),
      )
      await page.goto(
        serializePlatformRoute({
          module_id: 'volumes',
          scope: spaceScope,
          state: { kind: 'bug', label: 'ui' },
        }),
      )
      await expect(page.locator('.volumes-page')).toBeVisible()

      await page.locator('[data-number="waiting"]').click()
      const dialog = page.getByRole('dialog', { name: words.title, exact: true })
      const chip = dialog.locator('[data-part="scope"]')
      await expect(chip).toHaveText(`${words.space} · ${words.bug} · ui`)
      await expect(dialog).toContainText(words.filtered)
      await expect(dialog.locator('[data-request-waiting]')).toHaveCount(1)
      expect(narrowed[0]).toContain('other_spaces=true&task_kind=bug&task_label=ui')
      const parts = await shortfalls(page, '[role="dialog"] [data-part="scope"]')
      expect(parts.filter((part) => part.short > 0.5)).toEqual([])
      const sideways = await dialog.evaluate((frame) => frame.scrollWidth - frame.clientWidth)
      expect(sideways).toBeLessThanOrEqual(0)
      await page.screenshot({
        path: info.outputPath(`questions-filtered-${tag}.png`),
        animations: 'disabled',
      })

      await chip.click()
      await expect(chip).toHaveCount(0)
      await expect(dialog.locator('[data-request-waiting]')).toHaveCount(2)
      // Every space's questions are what the window lists unless told otherwise: no line says so.
      await expect(dialog).not.toContainText(words.narrowed)
      await record(info, `questions filtered ${tag}`, { narrowed, parts, sideways })
    })
  })
}
