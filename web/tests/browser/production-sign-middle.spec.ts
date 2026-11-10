/**
 * Every surface but the card's head that stands a sign beside words, measured in the built app: a
 * tile, a list row, a graph node's head and its state, the hover card, a result of Ctrl K, a row
 * of the work going on now and a member of a chain. Each sign stands its middle on the middle of
 * the capitals of the words on its line, within half a pixel, as the card's do
 * (`production-card-alignment.spec.ts`): these lines are a reference, a number or a word that
 * starts with a capital, and a sign on the middle of the lowercase letters stood a pixel and a
 * half low beside them.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { planningSpaceEntity, planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { busyFrame } from '../support/liveFrame.ts'
import { installBackend } from './backend.ts'
import { largeChainHere, serve as serveChain } from './chainFixtures.ts'
import { settled } from './documentBeside.ts'
import { installLiveStreams } from './liveWorkPage.ts'
import { projectId, projectScope, spaceRef, workItemRef } from './planningFixtures.ts'
import { openReported, card as previewCard, reference as previewLink, rest } from './previewPage.ts'
import {
  expectOnTheMiddle,
  MARKED,
  openView,
  prepare,
  signOffsets,
  withExecutors,
} from './signMeasures.ts'
import type { Offset } from './signMeasures.ts'
import { test } from './test.ts'

const CARD = serializePlatformRoute({
  module_id: 'planning',
  scope: projectScope,
  entity: planningWorkItemEntity(workItemRef),
})

/** The list of work going on now, on the rail or, on a phone, in the panel it opens. */
async function openWorkList(page: Page, width: number) {
  if (width >= 600) return page.locator('.nav-work-list')
  await page.locator('.nav-work-rail').click()
  await settled(page.getByRole('dialog'))
  return page.locator('.side-panel-body')
}

/** What Ctrl K finds: the marked item, with the marks a result row draws. */
const FOUND = {
  interface_version: 'valkama-planning-search',
  query: 'main',
  limit: 50,
  has_more: false,
  items: [
    {
      target: { project_id: projectId, space_ref: spaceRef, reference: 'MAIN-480', writable: true },
      item: {
        work_item_id: MARKED.work_item_id,
        planning_space_id: MARKED.planning_space_id,
        reference: 'MAIN-480',
        title: MARKED.title,
        kind: 'bug',
        priority: 'high',
        state: { name: 'Review', category: 'active' },
        claim_ref: '',
      },
    },
  ],
  coverage: [{ project_id: projectId, space_ref: spaceRef, status: 'searched', reason: null }],
}

for (const locale of ['ru', 'en'] as const) {
  for (const width of [1280, 390]) {
    const at = `${locale} at ${width}px`

    test(`a tile's signs stand on the middle of its reference and its words, ${at}`, async ({
      page,
    }) => {
      await prepare(page, locale, width)
      await openView(page, 'kanban')
      const tiles = page.locator('.work-item-tile').filter({
        has: page.locator('.tile-reference').getByText(/^MAIN-(?:480|264)$/u),
      })
      await expect(tiles).toHaveCount(2)
      const offsets = await signOffsets(tiles, [
        ['.tile-line .facet-glyph', '.tile-reference'],
        ['.tile-facts .facet-glyph', '.tile-facts .facet-word:not(.facet-word-hidden)'],
      ])
      console.info(`tile ${at}`, JSON.stringify(offsets))
      // The kind, the priority and the blocker on the first lines; the holder and the steps.
      expectOnTheMiddle(offsets, 5)
    })

    test(`a tile draws its executor as the client and its session, on the middle of its words, ${at}`, async ({
      page,
    }) => {
      await prepare(page, locale, width)
      await openView(page, 'kanban', withExecutors)
      const tile = (number: number) =>
        page.locator('.work-item-tile').filter({
          has: page.locator('.tile-reference').getByText(`MAIN-${number}`, { exact: true }),
        })
      const holder = (number: number) => tile(number).locator('[data-facet="holder"]')
      for (const number of [490, 491, 492, 493, 494, 495]) await expect(tile(number)).toBeVisible()
      // No tile draws a person for a holder: a client's sign, or nothing.
      await expect(page.locator('.work-item-tile svg.lucide-user')).toHaveCount(0)
      // Each state draws the session's one sign, the side panel's and the graph's.
      for (const [number, sign] of [
        [490, 'working'],
        [491, 'held'],
        [492, 'waiting'],
        [495, 'asks'],
      ] as const) {
        await expect(holder(number)).toHaveAttribute('data-session', sign)
        await expect(holder(number).locator(`svg.facet-session.session-sign-${sign}`)).toHaveCount(
          1,
        )
      }
      await expect(holder(490).locator('svg.facet-glyph')).toHaveClass(/lucide-asterisk/u)
      await expect(holder(492).locator('svg.facet-glyph')).toHaveClass(/lucide-codex/u)
      await expect(page.locator('.work-item-tile .work-dots')).toHaveCount(0)
      // The hover and a screen reader say who and what the session is doing.
      await expect(holder(492).locator('.facet-word-hidden')).toHaveText(
        locale === 'ru'
          ? 'Держит codex · 019a2b3c-4d5e — ждёт человека'
          : 'Held by codex · 019a2b3c-4d5e — waiting for a person',
      )
      await expect(holder(495).locator('.facet-word-hidden')).toHaveText(
        locale === 'ru'
          ? 'Держит claude · 3c4d5e6f-7081 — спрашивает человека: ждёт разрешения или ответа'
          : 'Held by claude · 3c4d5e6f-7081 — asking a person for a permission or an answer',
      )
      // A claim no session proved, with no session at work on it, is no executor.
      await expect(holder(493)).toHaveCount(0)
      await expect(holder(494)).toHaveCount(0)
      const executors = tile(490).or(tile(491)).or(tile(492)).or(tile(495))
      const words = '.tile-facts .facet-word:not(.facet-word-hidden)'
      const offsets = await signOffsets(executors, [
        ['.tile-facts [data-facet="holder"] .facet-glyph', words],
        ['.tile-facts .facet-session', words],
      ])
      console.info(`executor ${at}`, JSON.stringify(offsets))
      expectOnTheMiddle(offsets, 8)
    })

    test(`a list row's signs and state dot stand on the middle of its words, ${at}`, async ({
      page,
    }) => {
      await prepare(page, locale, width)
      await openView(page, 'list')
      const row = page
        .locator('.list-row')
        .filter({ has: page.getByText('MAIN-480', { exact: true }) })
      await expect(row).toBeVisible()
      const offsets = await signOffsets(row, [
        ['.list-ref-cell .facet-glyph', '.list-open'],
        ['.state-dot', '.state-label'],
      ])
      console.info(`list ${at}`, JSON.stringify(offsets))
      expectOnTheMiddle(offsets, 2)
    })

    test(`a graph node's signs and state dot stand on the middle of its words, ${at}`, async ({
      page,
    }) => {
      await prepare(page, locale, width)
      await openView(page, 'graph')
      await expect(page.locator('.graph-canvas.settled')).toBeVisible()
      const node = page.locator('.flow-node-card').filter({
        has: page.locator('.flow-node-id').getByText('MAIN-480', { exact: true }),
      })
      await expect(node).toBeVisible()
      const offsets = await signOffsets(node, [
        ['.flow-node-head .facet-glyph', '.flow-node-id'],
        ['.flow-node-state .state-dot', '.flow-node-state .state-label'],
      ])
      console.info(`graph ${at}`, JSON.stringify(offsets))
      expectOnTheMiddle(offsets, 3)
      expect(offsets.some(({ label }) => label.startsWith('.flow-node-state'))).toBe(true)
    })

    test(`the hover card's signs and state dot stand on the middle of its words, ${at}`, async ({
      page,
    }) => {
      await prepare(page, locale, width)
      const { entry } = await openReported(page)
      const offsets: Offset[] = []
      const looks = [
        [
          'MAIN-16',
          [
            ['.preview-head .facet-glyph', '.preview-reference'],
            ['.preview-head .state-dot', '.preview-head .state-label'],
          ],
        ],
        [
          'MAIN-12',
          [['.preview-facts .facet-glyph', '.preview-facts .facet-word:not(.facet-word-hidden)']],
        ],
      ] as const
      for (const [name, pairs] of looks) {
        await rest(page, previewLink(entry, name))
        await expect(previewCard(page)).toBeVisible()
        offsets.push(...(await signOffsets(previewCard(page), pairs)))
        await page.mouse.move(0, 0)
        await expect(previewCard(page)).toHaveCount(0)
      }
      console.info(`preview ${at}`, JSON.stringify(offsets))
      expectOnTheMiddle(offsets, 5)
    })

    test(`a result of Ctrl K stands its signs on the middle of its words, ${at}`, async ({
      page,
    }) => {
      await prepare(page, locale, width)
      await installBackend(page)
      await page.route('**/api/modules/planning/search?*', (route) =>
        route.fulfill({ json: FOUND }),
      )
      await page.goto(
        serializePlatformRoute({
          module_id: 'planning',
          scope: projectScope,
          entity: planningSpaceEntity(spaceRef),
        }),
      )
      await expect(page.locator('.work-item-board')).toBeVisible()
      await page.keyboard.press('Control+k')
      await page.locator('.command-input').fill('main')
      const result = page.getByRole('option')
      await expect(result).toHaveCount(1)
      const offsets = await signOffsets(result, [
        ['.finder-slot .facet-glyph', '.command-reference'],
        ['.command-detail .facet-glyph', '.command-detail .state-label'],
        ['.command-detail .state-dot', '.command-detail .state-label'],
      ])
      console.info(`finder ${at}`, JSON.stringify(offsets))
      expectOnTheMiddle(offsets, 3)
    })

    test(`a row of the work going on now stands its sign on the middle of its number, ${at}`, async ({
      page,
    }) => {
      await prepare(page, locale, width)
      await installBackend(page)
      const streams = await installLiveStreams(page)
      await page.goto(serializePlatformRoute({ module_id: 'settings', scope: { kind: 'global' } }))
      await expect.poll(() => streams.open()).toHaveLength(1)
      await streams.live(busyFrame())
      const list = await openWorkList(page, width)
      const rows = list.locator('.nav-row').filter({ has: page.locator('.nav-row-sign') })
      await expect(rows.first()).toBeVisible()
      const offsets = await signOffsets(rows, [['.nav-row-sign > *', '.nav-row-number']])
      console.info(`nav ${at}`, JSON.stringify(offsets))
      // Working, held and waiting, and the epic at work.
      expectOnTheMiddle(offsets, 4)
    })

    test(`a member of a chain stands its sign on the middle of its words, ${at}`, async ({
      page,
    }) => {
      await prepare(page, locale, width)
      await installBackend(page)
      await serveChain(page, largeChainHere())
      await page.goto(CARD)
      // The chain stands under Relations.
      await page
        .locator('.drawer')
        .getByRole('tab', { name: /Relations|Связи/u })
        .click()
      const section = page.locator('.drawer section.chain')
      await expect(section).toBeVisible()
      const rows = section.locator('.chain-row').filter({ has: page.locator('.chain-row-glyph') })
      await expect(rows.first()).toBeVisible()
      const offsets = await signOffsets(rows, [['.chain-row-glyph', '.chain-row-waiting']])
      console.info(`chain ${at}`, JSON.stringify(offsets))
      expectOnTheMiddle(offsets, 1)
    })
  }
}
