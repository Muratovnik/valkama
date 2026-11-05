/**
 * The identity line over a card's title and the state button in its facts, measured in the
 * built app. The texts of one line share a baseline, and each icon or dot stands on the middle
 * of the lowercase letters beside it, within a pixel.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { openPlanFor } from './openSessionFixtures.ts'
import { projectScope, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

const CARD = serializePlatformRoute({
  module_id: 'planning',
  scope: projectScope,
  entity: planningWorkItemEntity(workItemRef),
})

/** The room a mark may stand off the middle of the letters beside it. */
const TOLERANCE = 1

interface TextMeasure {
  /** The text's baseline, from the top of its own run plus the font's ascent. */
  baseline: number
  text: string
  /** The middle of its lowercase letters: the baseline less half the height of an `x`. */
  xCentre: number
}

interface Measured {
  /** Each mark's vertical middle. */
  marks: Record<string, number>
  texts: Record<string, TextMeasure>
}

interface Spec {
  marks: Record<string, string>
  root: string
  texts: Record<string, string>
}

function measure(page: Page, spec: Spec): Promise<Measured> {
  return page.evaluate((input) => {
    const root = document.querySelector(input.root)
    if (!root) throw new Error(`no ${input.root}`)
    const canvas = document.createElement('canvas').getContext('2d')
    if (!canvas) throw new Error('no canvas')
    const texts: Record<string, TextMeasure> = {}
    for (const [name, selector] of Object.entries(input.texts)) {
      const element = root.querySelector(selector)
      if (!element) throw new Error(`no text ${selector}`)
      // A text the line has stepped aside is not drawn, so it has no line to measure.
      if (element.getClientRects().length === 0) continue
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
      let node: Node | null = walker.nextNode()
      while (node && !node.textContent?.trim()) node = walker.nextNode()
      if (!node) throw new Error(`no words in ${selector}`)
      const range = document.createRange()
      range.selectNodeContents(node)
      const box = range.getBoundingClientRect()
      const style = getComputedStyle(element)
      canvas.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
      const baseline = box.top + canvas.measureText('H').fontBoundingBoxAscent
      const xCentre = baseline - canvas.measureText('x').actualBoundingBoxAscent / 2
      texts[name] = { baseline, xCentre, text: node.textContent?.trim() ?? '' }
    }
    const marks: Record<string, number> = {}
    for (const [name, selector] of Object.entries(input.marks)) {
      const element = root.querySelector(selector)
      if (!element) throw new Error(`no mark ${selector}`)
      const box = element.getBoundingClientRect()
      marks[name] = (box.top + box.bottom) / 2
    }
    return { texts, marks }
  }, spec)
}

/** The head of a card in the built app, with its state named as the owner's screenshot shows it. */
async function openCard(page: Page, locale: 'ru' | 'en', width: number) {
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  await page.setViewportSize({ width, height: 900 })
  await installBackend(page, {
    openPlan: openPlanFor,
    card: (read) => ({
      ...read,
      state: { ...(read.state as object), key: 'review', name: 'Review', category: 'review' },
    }),
  })
  await page.goto(CARD)
  const drawer = page.locator('.drawer')
  await expect(drawer.locator('.card-facts')).toBeVisible()
  await expect(drawer.locator('.card-identity')).toBeVisible()
  return drawer
}

/**
 * Every text of the line shares the first one's baseline, and each mark stands on the lowercase
 * middle of the text it is paired with.
 */
function alignmentGaps(measured: Measured, pairs: [string, string][]) {
  const [first, ...rest] = Object.values(measured.texts)
  const baselines = rest.map((other) => ({
    gap: Math.abs(other.baseline - first.baseline),
    label: `baseline of “${other.text}” against “${first.text}”`,
  }))
  const marks = pairs.map(([mark, text]) => {
    const target = measured.texts[text]
    return {
      gap: Math.abs(measured.marks[mark] - target.xCentre),
      label: `${mark} against the middle of “${target.text}”`,
    }
  })
  return [...baselines, ...marks]
}

const IDENTITY: Spec = {
  root: '.card-identity',
  texts: {
    kind: '.identity-kind',
    reference: '.head-reference',
    updated: '.identity-updated',
  },
  marks: {
    link: '.identity-link svg',
    source: '.identity-source svg',
  },
}

const STATE: Spec = {
  root: '.card-state',
  texts: { label: '.state-label' },
  marks: { dot: '.state-dot', chevron: '.choice-chevron' },
}

for (const locale of ['ru', 'en'] as const) {
  for (const width of [1280, 390]) {
    test(`the identity line shares one baseline, and its marks centre on the letters, ${locale} at ${width}px`, async ({
      page,
    }) => {
      await openCard(page, locale, width)
      const line = await measure(page, { ...IDENTITY, root: '.drawer .card-identity' })
      console.info(`identity ${locale} ${width}px`, JSON.stringify(line))
      // The date steps aside on a phone; the plan anchor then stands after the reference.
      const gaps = alignmentGaps(line, [
        ['link', 'reference'],
        ['source', line.texts.updated ? 'updated' : 'reference'],
      ])
      for (const { gap, label } of gaps) expect(gap, label).toBeLessThanOrEqual(TOLERANCE)
    })

    test(`the state button's dot and chevron centre on its label, ${locale} at ${width}px`, async ({
      page,
    }) => {
      await openCard(page, locale, width)
      const state = await measure(page, { ...STATE, root: '.drawer .card-state' })
      console.info(`state ${locale} ${width}px`, JSON.stringify(state))
      const gaps = alignmentGaps(state, [
        ['dot', 'label'],
        ['chevron', 'label'],
      ])
      for (const { gap, label } of gaps) expect(gap, label).toBeLessThanOrEqual(TOLERANCE)
    })
  }
}

test('the state word is cut short sideways only, so its trimmed box cuts no letter', async ({
  page,
}) => {
  await openCard(page, 'ru', 1280)
  const label = page.locator('.drawer .card-state .state-label')
  const box = await label.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      // Trimmed to the letters, so capitals and descenders stand outside the box.
      trimmed: element.getBoundingClientRect().height < Number.parseFloat(style.lineHeight),
      overflowY: style.overflowY,
      textOverflow: style.textOverflow,
    }
  })
  expect(box).toEqual({ trimmed: true, overflowY: 'visible', textOverflow: 'ellipsis' })
})

test.describe('enlarged crops for the owner to see', () => {
  test.use({ deviceScaleFactor: 3 })

  for (const width of [1280, 390]) {
    test(`crops the identity line and the state button at ${width}px`, async ({ page }, info) => {
      const drawer = await openCard(page, 'ru', width)
      await expect(drawer.locator('.card-state')).toBeVisible()
      await drawer.screenshot({ path: info.outputPath(`card-${width}.png`) })
      await drawer.locator('.card-identity').screenshot({
        path: info.outputPath(`identity-${width}.png`),
      })
      await drawer.locator('.card-state').screenshot({
        path: info.outputPath(`state-${width}.png`),
      })
    })
  }
})
