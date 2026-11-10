/**
 * The card's head in the built app, opened with the facts a test gives it, and the measures its
 * alignment is read by: each text's baseline and the middle of its capitals, each mark's middle,
 * and how far apart they stand (`production-card-alignment.spec.ts`,
 * `production-card-signs.spec.ts`).
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { openPlanFor, shortHolderCard } from './openSessionFixtures.ts'
import { blockedWorkItem, projectScope, workItem, workItemRef } from './planningFixtures.ts'
import { asked, installQuestions } from './questionBackend.ts'

const CARD = serializePlatformRoute({
  module_id: 'planning',
  scope: projectScope,
  entity: planningWorkItemEntity(workItemRef),
})

/** The room two texts of one line may stand apart from one baseline. */
const TOLERANCE = 1
/** The room a sign may stand off the middle of the capitals of its line, on every surface. */
const MIDDLE_ROOM = 0.5
/** Under half a pixel, so that two words of one line never round to two rows of pixels. */
export const BASELINE_ROOM = 0.25

interface TextMeasure {
  /** The text's baseline, from the top of its own run plus the font's ascent. */
  baseline: number
  /** The middle of its capitals: the baseline less half the height of an `H`. */
  capCentre: number
  text: string
}

export interface Measured {
  /** Each mark's vertical middle. */
  marks: Record<string, number>
  texts: Record<string, TextMeasure>
}

export interface Spec {
  marks: Record<string, string>
  root: string
  texts: Record<string, string>
}

export function measure(page: Page, spec: Spec): Promise<Measured> {
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
      const capCentre = baseline - canvas.measureText('H').actualBoundingBoxAscent / 2
      texts[name] = { baseline, capCentre, text: node.textContent?.trim() ?? '' }
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

/** What a head holds beyond the state: each fact that prints a word beside its glyph. */
export interface Head {
  asking?: boolean
  /** The reference of the item's parent, which is a link among the facts. */
  epic?: string
  /** A session of Claude's holds it, opening in VS Code: the holder is that session's button. */
  held?: boolean
  kind?: string
  /** The parent's own kind, which its sign is drawn by; the fixture's is a plain task. */
  parentKind?: string
  priority?: string
  /** The name of the state the item stands in. */
  state?: string
}

export const FULL_HEAD: Head = { asking: true, epic: 'MAIN-12', kind: 'epic', priority: 'high' }

/**
 * The item under its parent: the card's read says the id, the space's whose reference and kind
 * that is.
 */
function inEpic(model: Record<string, unknown>, reference: string, kind?: string) {
  const items = model.work_items as { reference: string; work_item_id: string }[]
  return {
    ...model,
    work_items: items.map((item) => {
      if (item.work_item_id === workItem.work_item_id)
        return { ...item, parent_id: blockedWorkItem.work_item_id }
      return item.work_item_id === blockedWorkItem.work_item_id
        ? { ...item, reference, ...(kind ? { kind } : {}) }
        : item
    }),
  }
}

/** The head of a card in the built app, on a state that moves, with the facts it is given. */
export async function openCard(page: Page, locale: 'ru' | 'en', width: number, head: Head = {}) {
  const { asking, epic, held, kind, parentKind, priority, state = 'Review' } = head
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  await page.setViewportSize({ width, height: 900 })
  await installBackend(page, {
    openPlan: openPlanFor,
    card: (read) => ({
      ...(held ? shortHolderCard(read) : read),
      state: { ...(read.state as object), key: 'review', name: state, category: 'review' },
      ...(kind ? { kind } : {}),
      ...(priority ? { priority } : {}),
      ...(epic ? { parent_id: blockedWorkItem.work_item_id } : {}),
    }),
    ...(epic ? { space: (model) => inEpic(model, epic, parentKind) } : {}),
  })
  if (asking) await installQuestions(page, [asked()])
  await page.goto(CARD)
  const drawer = page.locator('.drawer')
  await expect(drawer.locator('.card-facts')).toBeVisible()
  await expect(drawer.locator('.card-identity')).toBeVisible()
  await expect(drawer).toHaveCSS('transform', 'none')
  if (asking) await expect(drawer.locator('.card-question')).toBeVisible()
  if (epic) await expect(drawer.getByText(epic, { exact: true }).first()).toBeVisible()
  return drawer
}

/**
 * Every text of the line shares the first one's baseline, and each mark stands on the middle of
 * the capitals of the text it is paired with.
 */
export function alignmentGaps(measured: Measured, pairs: [string, string][]) {
  const [first, ...rest] = Object.values(measured.texts)
  const baselines = rest.map((other) => ({
    gap: Math.abs(other.baseline - first.baseline),
    label: `baseline of “${other.text}” against “${first.text}”`,
    room: TOLERANCE,
  }))
  const marks = pairs.map(([mark, text]) => {
    const target = measured.texts[text]
    return {
      gap: Math.abs(measured.marks[mark] - target.capCentre),
      label: `${mark} against the middle of “${target.text}”`,
      room: MIDDLE_ROOM,
    }
  })
  return [...baselines, ...marks]
}
