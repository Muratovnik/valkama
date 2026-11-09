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
import type { Locator, Page } from '@playwright/test'

import { planningSpaceEntity, planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { busyFrame } from '../support/liveFrame.ts'
import { installBackend } from './backend.ts'
import { largeChainHere, serve as serveChain } from './chainFixtures.ts'
import { settled } from './documentBeside.ts'
import { installLiveStreams } from './liveWorkPage.ts'
import {
  planningReadModel,
  projectId,
  projectScope,
  spaceRef,
  workItemRef,
} from './planningFixtures.ts'
import { openReported, card as previewCard, reference as previewLink, rest } from './previewPage.ts'
import { test } from './test.ts'

const CARD = serializePlatformRoute({
  module_id: 'planning',
  scope: projectScope,
  entity: planningWorkItemEntity(workItemRef),
})

/** The room a sign may stand off the middle of the capitals of its line. */
const MIDDLE_ROOM = 0.5

interface Offset {
  label: string
  /** The sign's vertical middle less the capitals' middle: positive when the sign stands low. */
  offset: number
}

/**
 * Each sign in each of `rows`, against the first drawn words of its pair in the same row, in the
 * row's own pixels: a graph node zoomed out is drawn smaller, and its font's metrics are not. A
 * pair whose sign is not drawn measures nothing, so a caller says how many it expects.
 */
function signOffsets(rows: Locator, pairs: readonly (readonly [string, string])[]) {
  return rows.evaluateAll((elements, wanted) => {
    const canvas = document.createElement('canvas').getContext('2d')
    if (!canvas) throw new Error('no canvas')
    // This body is serialized and evaluated in the page, so a module-scope helper would not be
    // in scope here.
    // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
    const drawn = (node: Element) =>
      node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden'
    const capitalsMiddle = (words: Element, scale: number) => {
      const walker = document.createTreeWalker(words, NodeFilter.SHOW_TEXT)
      let node: Node | null = walker.nextNode()
      while (node && !node.textContent?.trim()) node = walker.nextNode()
      if (!node?.parentElement) throw new Error('no words')
      const range = document.createRange()
      range.selectNodeContents(node)
      const style = getComputedStyle(node.parentElement)
      canvas.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
      const capital = canvas.measureText('H')
      const above = capital.fontBoundingBoxAscent - capital.actualBoundingBoxAscent / 2
      return range.getBoundingClientRect().top + above * scale
    }
    return elements.flatMap((row) => {
      const scale = row.getBoundingClientRect().width / (row as HTMLElement).offsetWidth || 1
      return wanted.flatMap(([marks, words]) => {
        const text = [...row.querySelectorAll(words)].find((node) => drawn(node))
        if (!text) return []
        const middle = capitalsMiddle(text, scale)
        const signs = [...row.querySelectorAll(marks)].filter((node) => drawn(node))
        return signs.map((mark) => {
          const box = mark.getBoundingClientRect()
          return {
            label: `${marks} against “${text.textContent?.trim()}”`,
            offset: ((box.top + box.bottom) / 2 - middle) / scale,
          }
        })
      })
    })
  }, pairs)
}

function expectOnTheMiddle(offsets: Offset[], at: number) {
  expect(offsets.length, 'signs measured').toBeGreaterThanOrEqual(at)
  for (const { label, offset } of offsets)
    expect(Math.abs(offset), label).toBeLessThanOrEqual(MIDDLE_ROOM)
}

/** An item with a sign of each kind: a bug, high, held by a live session, with a step to do. */
const MARKED = {
  ...planningReadModel.work_items[1],
  work_item_id: '00000000-0000-4000-8000-000000000480',
  reference: 'MAIN-480',
  number: 480,
  title: 'Stand every sign on the middle of its line',
  kind: 'bug',
  priority: 'high',
  state: { ...planningReadModel.work_items[1].state, name: 'Review' },
  claim_ref: 'claude (session f5f838f4-74fc-4a1b-9c2d-0123456789ab)',
  claim_state: 'live',
  checklist: [
    {
      id: '00000000-0000-4000-8000-000000000481',
      text: 'Measure',
      done: false,
      claimed_by: '',
      done_by: '',
    },
  ],
}

const withMarked = (model: Record<string, unknown>) => ({
  ...model,
  work_items: [...(model.work_items as unknown[]), MARKED],
})

async function prepare(page: Page, locale: 'ru' | 'en', width: number) {
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  await page.setViewportSize({ width, height: 900 })
}

async function openView(page: Page, view: 'kanban' | 'list' | 'graph') {
  await installBackend(page, { space: withMarked })
  await page.goto(
    serializePlatformRoute({
      module_id: 'planning',
      scope: projectScope,
      entity: planningSpaceEntity(spaceRef),
      state: { view },
    }),
  )
}

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
