/**
 * A control a write disables while it waits takes the focus back once the wait ends, outside a
 * dialog as in one (DESIGN.md, «Accessibility»): Chrome takes focus off a control disabled
 * under it, to the page, and a refused write left it there. It stays disabled while it waits,
 * so a second press sends nothing, and the next Tab goes where it went from it before.
 *
 * Read on a card — a step's box ticked with Space, refused and let through; a link's remove, an
 * attempt's Stop, a report made the outcome, a thread's mark taken off, a reply sent with Enter
 * from its mark and a knowledge search, each refused — and on Volumes, a commit's Attach
 * refused, at a desktop's two widths in both languages. Served by `discussionBackend.ts`'s
 * double and the shared backend, each wait held back by the test and answered as it says.
 */
import { expect } from '@playwright/test'
import type { Locator, Page, Route } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { volumesAnswer } from '../support/volumesDouble.ts'
import { installBackend } from './backend.ts'
import { openCard } from './editorPage.ts'
import { enableExecutionTab, executionHistory } from './executionFixtures.ts'
import { frames } from './frames.ts'
import {
  failRead,
  focusedByKey,
  heldWrites,
  onThePage,
  onwardFrom,
  pressHeld,
  REASON,
  refuse,
  tabGoesOn,
} from './heldWrite.ts'
import { blockedWorkItem, spaceRef, spaceScope } from './planningFixtures.ts'
import { test } from './test.ts'
import { talkedOn } from './threadFixtures.ts'

const STEP = 'Frontend contract'

const WORDS = {
  en: {
    discuss: `Discuss condition “${STEP}”`,
    unlink: `Remove link to ${blockedWorkItem.reference}`,
    relations: 'Relations',
    execution: 'Execution',
    stop: 'Stop',
    makeOutcome: 'Make task outcome',
    expand: 'Expand',
    reopen: 'Reopen',
    reply: 'Reply',
    replyField: 'Your reply',
    markWithReply: 'Mark the thread resolved',
    attachTo: 'Attach to a card',
    attach: 'Attach',
    memory: 'Memory',
    search: 'Search knowledge',
  },
  ru: {
    discuss: `Обсудить условие «${STEP}»`,
    unlink: `Удалить связь с ${blockedWorkItem.reference}`,
    relations: 'Связи',
    execution: 'Исполнение',
    stop: 'Остановить',
    makeOutcome: 'Сделать итогом задачи',
    expand: 'Развернуть',
    reopen: 'Снять отметку',
    reply: 'Ответить',
    replyField: 'Ваш ответ',
    markWithReply: 'Отметить ветку разобранной',
    attachTo: 'Прикрепить к карточке',
    attach: 'Прикрепить',
    memory: 'Память',
    search: 'Искать в знаниях',
  },
} as const

/** The card with its discussion, its threads in the double's record. */
async function cardWithThreads(page: Page) {
  const opened = await openCard(page)
  opened.backend.item.comments.push(...talkedOn())
  await page.reload()
  await expect(opened.drawer).toHaveCSS('transform', 'none')
  return opened
}

/** A step's box ticked with Space, its tick held, then refused or taken as the server does. */
async function tickHeld(page: Page, through: boolean) {
  const { backend, drawer } = await openCard(page)
  const take = (route: Route) => {
    const step = backend.item.checklist.find((one) => one.text === STEP)
    if (step) step.done = true
    backend.item.revision += 1
    return route.fulfill({ json: backend.item })
  }
  const held = await heldWrites(
    page,
    '/api/planning/work-item/checklist/tick',
    through ? take : refuse,
  )
  const box = drawer.getByRole('checkbox', { name: STEP, exact: true })
  await pressHeld(page, box, 'Space', held.sent)
  return { ...held, box, drawer }
}

for (const width of [1440, 1024] as const)
  for (const lang of ['en', 'ru'] as const)
    test.describe(`a write held from the keyboard at ${String(width)} in ${lang}`, () => {
      test.use({ locale: lang === 'ru' ? 'ru-RU' : 'en-US' })
      const words = WORDS[lang]

      test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width, height: 900 })
        await page.emulateMedia({ reducedMotion: 'reduce' })
      })

      /** The box has focus as a key put it, and the next Tab goes to the step's own action. */
      async function boxAgain(page: Page, box: Locator, drawer: Locator) {
        await frames(drawer)
        await focusedByKey(box)
        await page.keyboard.press('Tab')
        await expect(drawer.getByRole('button', { name: words.discuss, exact: true })).toBeFocused()
      }

      test('a step ticked with Space has the focus back once its tick is refused', async ({
        page,
      }) => {
        const { box, drawer, release, sent } = await tickHeld(page, false)
        release()
        await expect(drawer.getByText(REASON)).toBeVisible()
        await expect(box).toHaveAttribute('aria-checked', 'false')
        await boxAgain(page, box, drawer)
        expect(sent).toHaveLength(1)
      })

      test('a step ticked with Space has the focus back once its tick goes through', async ({
        page,
      }) => {
        const { box, drawer, release, sent } = await tickHeld(page, true)
        release()
        await expect(box).toHaveAttribute('aria-checked', 'true')
        await boxAgain(page, box, drawer)
        expect(sent).toHaveLength(1)
      })

      test('a link’s remove pressed with Enter has the focus back once refused', async ({
        page,
      }) => {
        const { drawer } = await openCard(page)
        await drawer.getByRole('tab', { name: words.relations, exact: true }).click()
        const { release, sent } = await heldWrites(page, '/api/planning/work-item/link')
        const remove = drawer.getByRole('button', { name: words.unlink, exact: true })
        const onward = await pressHeld(page, remove, 'Enter', sent)

        release()
        await expect(drawer.getByText(REASON)).toBeVisible()
        await frames(drawer)
        await focusedByKey(remove)
        await tabGoesOn(page, onward)
        expect(sent).toHaveLength(1)
      })

      test('Stop pressed with Enter has the focus back once refused', async ({ page }) => {
        await enableExecutionTab(page)
        const live = {
          ...structuredClone(executionHistory),
          executions: executionHistory.executions.map((attempt) => ({
            ...attempt,
            status: 'running',
            presence: 'live',
            outcome: '',
            exit_code: null,
            result: null,
          })),
        }
        const { drawer } = await openCard(page, () =>
          page.route('**/api/execution/history*', (route) => route.fulfill({ json: live })),
        )
        await drawer.getByRole('tab', { name: words.execution, exact: true }).click()
        const { release, sent } = await heldWrites(page, '/api/execution/stop', failRead)
        const stop = drawer.getByRole('button', { name: words.stop, exact: true })
        await pressHeld(page, stop, 'Enter', sent)

        release()
        await expect(drawer.getByText(REASON)).toBeVisible()
        await frames(drawer)
        await focusedByKey(stop)
        // The refusal's words stand where the attempts' list stood, so what follows Stop is not
        // what followed it before; a Tab and a Shift+Tab come back to it, from wherever it went.
        await page.keyboard.press('Tab')
        await page.keyboard.press('Shift+Tab')
        await expect(stop).toBeFocused()
        expect(sent).toHaveLength(1)
      })

      test('a report made the outcome with Enter has the focus back once refused', async ({
        page,
      }) => {
        const { drawer } = await cardWithThreads(page)
        const { release, sent } = await heldWrites(page, '/api/planning/work-item/summary/select')
        const make = drawer.getByRole('button', { name: words.makeOutcome, exact: true })
        const onward = await pressHeld(page, make, 'Enter', sent)

        release()
        await expect(drawer.getByText(REASON)).toBeVisible()
        await frames(drawer)
        await focusedByKey(make)
        await tabGoesOn(page, onward)
        expect(sent).toHaveLength(1)
      })

      test('a thread’s mark taken off with Enter has the focus back once refused', async ({
        page,
      }) => {
        const { drawer } = await cardWithThreads(page)
        const thread = drawer.locator('.thread-entry').filter({ hasText: 'step claims' })
        await thread.getByRole('button', { name: words.expand, exact: true }).click()
        const { release, sent } = await heldWrites(page, '/api/planning/work-item/comment/resolve')
        const reopen = thread.getByRole('button', { name: words.reopen, exact: true })
        const onward = await pressHeld(page, reopen, 'Enter', sent)

        release()
        await expect(thread.getByRole('alert')).toContainText(REASON)
        await frames(drawer)
        await focusedByKey(reopen)
        await tabGoesOn(page, onward)
        expect(sent).toHaveLength(1)
      })

      test('a reply sent with Enter from its mark has the focus back on the mark once refused', async ({
        page,
      }) => {
        const { drawer } = await cardWithThreads(page)
        const thread = drawer
          .locator('.thread-entry')
          .filter({ hasText: 'Should the second report' })
        await thread.getByRole('button', { name: words.reply, exact: true }).first().click()
        await thread.getByRole('textbox', { name: words.replyField }).fill('Beside it, then.')
        const { release, sent } = await heldWrites(page, '/api/planning/work-item/comment')
        const mark = thread.getByRole('checkbox', { name: words.markWithReply })
        const onward = await pressHeld(page, mark, 'Enter', sent)

        release()
        await expect(thread.getByText(REASON)).toBeVisible()
        await frames(drawer)
        await focusedByKey(mark)
        await expect(thread.getByRole('textbox', { name: words.replyField })).toHaveValue(
          'Beside it, then.',
        )
        await tabGoesOn(page, onward)
        expect(sent).toHaveLength(1)
      })

      test('a knowledge search sent with Enter has the focus back in its field once it fails', async ({
        page,
      }) => {
        const { drawer } = await openCard(page)
        await drawer.getByRole('tab', { name: words.memory, exact: true }).click()
        const field = drawer.getByRole('textbox', { name: words.search })
        await field.fill('ratchet')
        const { release, sent } = await heldWrites(page, '/api/memory/search?*', failRead, true)
        const onward = await pressHeld(page, field, 'Enter', sent)

        release()
        await expect(drawer.getByRole('alert')).toBeVisible()
        await frames(drawer)
        await expect(field).toBeFocused()
        await expect(field).toHaveValue('ratchet')
        await tabGoesOn(page, onward)
        expect(sent).toHaveLength(1)
      })

      test('a commit’s Attach pressed with Enter has the focus back once refused', async ({
        page,
      }) => {
        await installBackend(page)
        await page.route('**/api/planning/volumes?*', (route) =>
          route.fulfill({ json: volumesAnswer({ unattached: 1 }) }),
        )
        await routeCommitSearch(page)
        await page.goto(
          serializePlatformRoute({ module_id: 'volumes', scope: spaceScope, state: {} }),
        )
        await page.locator('[data-number="commits"]').click()
        const row = page.locator('[data-commit="abcdef0123"]')
        await row.getByRole('button', { name: words.attachTo }).click()
        await row.getByRole('combobox').fill('volumes')
        await page.getByRole('option', { name: /MAIN-41/u }).click()
        const { release, sent } = await heldWrites(page, '/api/planning/work-item/commit')
        const attach = row.getByRole('button', { name: words.attach, exact: true })
        const onward = await onwardFrom(page, attach)
        await attach.focus()
        await page.keyboard.press('Enter')
        // The button says it is attaching while it waits, under the same element.
        const waiting = row.locator('button[type="submit"]')
        await expect(waiting).toBeDisabled()
        await onThePage(page)
        await page.keyboard.press('Enter')
        expect(sent).toHaveLength(1)

        release()
        await expect(row.getByText(REASON)).toBeVisible()
        await frames(row)
        await focusedByKey(attach)
        await tabGoesOn(page, onward)
        expect(sent).toHaveLength(1)
      })
    })

/** The one commit on no card, and the card the search finds for it. */
async function routeCommitSearch(page: Page) {
  const commit = {
    repository: 'alpha',
    display_name: 'Alpha',
    hash: 'abcdef0123',
    subject: 'Fix the parser of the volumes read',
    committed_at: '2026-03-02T10:00:00Z',
    session: 'c0ffee00-1111-4222-8333-444455556666',
    agent: null,
    client: 'claude',
    reported_at: '2026-03-02T10:00:05Z',
  }
  await page.route('**/api/planning/commits/unattached?*', (route) =>
    route.fulfill({ json: { total: 1, items: [commit] } }),
  )
  await page.route('**/api/modules/planning/search?*', (route) =>
    route.fulfill({
      json: {
        interface_version: 'valkama-planning-search',
        query: new URL(route.request().url()).searchParams.get('q'),
        limit: 50,
        has_more: false,
        items: [
          {
            target: { space_ref: spaceRef, reference: 'MAIN-41', writable: true },
            item: {
              work_item_id: '00000000-0000-4000-8000-000000000041',
              planning_space_id: '00000000-0000-4000-8000-000000000001',
              reference: 'MAIN-41',
              title: 'Read the volumes',
              state: { name: 'Done' },
              open: false,
              container_state: null,
              claim_ref: '',
            },
          },
        ],
        coverage: [],
      },
    }),
  )
}
