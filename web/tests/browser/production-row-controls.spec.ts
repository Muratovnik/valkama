/**
 * The controls of one row stand at one height and on one top edge, measured in the built
 * application in both languages at a desktop's width and a phone's.
 *
 * Three rows held controls of different sizes. In the chain's heading the scope switch was
 * 36px and «На графе» beside it 28px; a label in the card was a face as tall as its words
 * beside a 28px «+»; and the new-task dialog's labels field grew from 40px to 52px once a
 * label was chosen, because the chip's remove button took the base rule's 40px, so the field
 * stood 12px taller than the epic beside it. The labels field's hint stood under one field of
 * its pair; it is the field's placeholder now.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { largeChainHere, serve } from './chainFixtures.ts'
import { projectScope, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

const BOARD = serializePlatformRoute({ module_id: 'planning', scope: projectScope })
const CARD = serializePlatformRoute({
  module_id: 'planning',
  scope: projectScope,
  entity: planningWorkItemEntity(workItemRef),
})

/** `--size-control-height`: a form's row. */
const FIELD = 40
/** `--size-control-height-compact`: what a section's heading gives its actions. */
const HEADER_ACTION = 36
/** `--size-control-inline`: a line of content, the labels row's «+» and its chips. */
const INLINE = 28

const WORDS = {
  en: {
    create: 'New work item',
    labels: 'Labels',
    epic: 'Epic',
    hint: 'pick one, or type a new one',
  },
  ru: { create: 'Новая работа', labels: 'Метки', epic: 'Эпик', hint: 'выберите или введите новую' },
} as const

type Locale = keyof typeof WORDS

interface Edge {
  height: number
  name: string
  top: number
}

/** Where each box stands: its top edge and its height, and what it is for a failure to name. */
function edges(boxes: Locator): Promise<Edge[]> {
  return boxes.evaluateAll((nodes) =>
    nodes.map((node) => {
      const { top, height } = node.getBoundingClientRect()
      const name = node.getAttribute('aria-label') ?? node.textContent?.trim() ?? node.className
      return { height, top, name: String(name) }
    }),
  )
}

/** One height, the expected one, and one top edge across a row's controls. */
function expectOneRow(row: Edge[], height: number, what: string) {
  expect(row.length, `${what}: controls found`).toBeGreaterThan(1)
  for (const control of row) {
    expect(control.height, `${what}: ${control.name} height`).toBeCloseTo(height, 1)
    expect(control.top, `${what}: ${control.name} top`).toBeCloseTo(row[0].top, 1)
  }
}

async function prepare(page: Page, width: number, locale: Locale) {
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  await page.setViewportSize({ width, height: 900 })
  await installBackend(page)
}

for (const width of [1280, 390])
  for (const locale of ['ru', 'en'] as const) {
    test(`a section heading's actions and the labels row stand at one height, ${locale} at ${width}px`, async ({
      page,
    }) => {
      await prepare(page, width, locale)
      await serve(page, largeChainHere())
      await page.goto(CARD)
      const drawer = page.locator('.drawer')
      await expect(drawer.locator('section.chain .section-header-actions')).toBeVisible()
      await expect(drawer).toHaveCSS('transform', 'none')

      // The chain's heading: the scope switch and «На графе», one compact height.
      expectOneRow(
        await edges(drawer.locator('section.chain .section-header-actions > *')),
        HEADER_ACTION,
        'chain heading',
      )
      // Every other heading of the card with an action gives it the same height.
      for (const tab of await drawer.locator('.inspector-tabs').getByRole('tab').all()) {
        await tab.click()
        for (const actions of await drawer.locator('.section-header-actions:visible').all())
          for (const action of await edges(actions.locator(':scope > *')))
            expect(action.height, `a heading's ${action.name}`).toBeCloseTo(HEADER_ACTION, 1)
      }
      await drawer.locator('.inspector-tabs').getByRole('tab').first().click()

      // The labels row: each chip's face as tall as the «+» after it, on its top edge.
      const labels = drawer.locator('.card-labels')
      expectOneRow(
        await edges(labels.locator('.label-chip, .chip-face, .item-labels-add > button')),
        INLINE,
        'labels row',
      )
    })

    test(`the new-task dialog's pairs stand at one height and on one edge, ${locale} at ${width}px`, async ({
      page,
    }) => {
      const words = WORDS[locale]
      await prepare(page, width, locale)
      await page.goto(BOARD)
      await page.getByRole('button', { name: words.create }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toHaveCSS('transform', 'none')

      expectOneRow(await edges(dialog.locator('.choice-trigger')), FIELD, 'type and priority')

      const labels = dialog.getByRole('combobox', { name: words.labels, exact: true })
      // The hint is the empty field's placeholder, not a line under one field of the pair.
      await expect(labels).toHaveAttribute('placeholder', words.hint)
      await expect(dialog.getByText(words.hint, { exact: true })).toHaveCount(0)
      await labels.click()
      await page.keyboard.type('platform')
      await page.keyboard.press('Enter')
      await page.keyboard.press('Escape')
      await expect(dialog.locator('.combo-chip')).toHaveCount(1)

      // A field with a chip in it keeps the field's height; side by side the two share a top.
      const fields = await edges(dialog.locator('.combo-box'))
      for (const field of fields) expect(field.height, 'labels and epic').toBeCloseTo(FIELD, 1)
      // Side by side on a desktop the two share a top edge; on a phone one stands under the other.
      expect(Math.abs(fields[1].top - fields[0].top) < 1).toBe(width >= 1280)
    })
  }
