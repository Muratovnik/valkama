/**
 * What the specs that measure a sign beside its words share: where a sign stands against the
 * capitals of its line (`signOffsets`), its box beside the glyph it follows (`signBoxes`), and the
 * space they are measured in — an item with a sign of each kind, and items held by a session in
 * each state its sign draws.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { planningSpaceEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { planningReadModel, projectScope, spaceRef } from './planningFixtures.ts'

/** The room a sign may stand off the middle of the capitals of its line. */
export const MIDDLE_ROOM = 0.5

export interface Offset {
  label: string
  /** The sign's vertical middle less the capitals' middle: positive when the sign stands low. */
  offset: number
}

/**
 * Each sign in each of `rows`, against the first drawn words of its pair in the same row, in the
 * row's own pixels: a graph node zoomed out is drawn smaller, and its font's metrics are not. A
 * pair whose sign is not drawn measures nothing, so a caller says how many it expects.
 */
export function signOffsets(rows: Locator, pairs: readonly (readonly [string, string])[]) {
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

export function expectOnTheMiddle(offsets: Offset[], at: number) {
  expect(offsets.length, 'signs measured').toBeGreaterThanOrEqual(at)
  for (const { label, offset } of offsets)
    expect(Math.abs(offset), label).toBeLessThanOrEqual(MIDDLE_ROOM)
}

/** An item with a sign of each kind: a bug, high, held by a live session, with a step to do. */
export const MARKED = {
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

export async function prepare(page: Page, locale: 'ru' | 'en', width: number) {
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  await page.setViewportSize({ width, height: 900 })
}

/**
 * Tiles held by the client of a session at work on the item, at work on other items,
 * waiting for a person and asking one in the middle of a turn, and two whose claim no session
 * proved: one nobody's session is at and one whose session went quiet.
 */
const EXECUTORS = [
  [490, 'claude (session 1a2b3c4d-5e6f-4a1b-9c2d-0123456789ab)', 'live', { state: 'working' }],
  [491, 'claude (session 2b3c4d5e-6f70-4a1b-9c2d-0123456789ab)', 'live', { state: 'held' }],
  [
    492,
    'codex (session 019a2b3c-4d5e-7f00-8000-0123456789ab)',
    'live',
    { state: 'waiting', long: false, asks: false },
  ],
  [493, 'claude', 'unconfirmed', null],
  [494, 'claude', 'unconfirmed', { state: 'quiet', quiet_since: '2026-11-01T10:00:00Z' }],
  [
    495,
    'claude (session 3c4d5e6f-7081-4a1b-9c2d-0123456789ab)',
    'live',
    { state: 'waiting', long: false, asks: true },
  ],
] as const

/**
 * Each sign in `rows` with the glyph before it, as boxes in the row's own pixels, held at the
 * start of any turn: a square turned 45° spans 1.4 times its side, while the ring it draws spans
 * the same at every angle.
 */
export function signBoxes(rows: Locator, sign: string, glyph: string) {
  return rows.evaluateAll(
    (elements, [signs, glyphs]) =>
      elements.flatMap((row) => {
        const scale = row.getBoundingClientRect().width / (row as HTMLElement).offsetWidth || 1
        const mark = row.querySelector(signs)
        if (!mark) return []
        for (const animation of mark.getAnimations()) {
          animation.pause()
          animation.currentTime = 0
        }
        const box = mark.getBoundingClientRect()
        const beside = row.querySelector(glyphs)?.getBoundingClientRect()
        // Evaluated in the page, where a module-scope helper is not in scope.
        // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
        const middle = (rect: DOMRect) => (rect.top + rect.bottom) / 2
        return [
          {
            sign: [...mark.classList].find((name) => name.startsWith('session-sign-')) ?? '',
            width: box.width / scale,
            height: box.height / scale,
            glyph: beside ? [beside.width / scale, beside.height / scale] : null,
            offFromGlyph: beside ? (middle(box) - middle(beside)) / scale : null,
            turns: mark.getAnimations().length > 0,
          },
        ]
      }),
    [sign, glyph],
  )
}

export const withExecutors = (model: Record<string, unknown>) => {
  const items = EXECUTORS.map(([number, holder, claim]) => ({
    ...MARKED,
    work_item_id: `00000000-0000-4000-8000-000000000${number}`,
    reference: `MAIN-${number}`,
    number,
    claim_ref: holder,
    claim_state: claim,
    checklist: [{ ...MARKED.checklist[0], id: `00000000-0000-4000-8000-000000001${number}` }],
  }))
  const live = Object.fromEntries(
    EXECUTORS.flatMap((executor) =>
      executor[3] ? [[`00000000-0000-4000-8000-000000000${executor[0]}`, executor[3]]] : [],
    ),
  )
  return {
    ...model,
    work_items: [...(model.work_items as unknown[]), ...items],
    live_work: { ...(model.live_work as object | undefined), ...live },
  }
}

export async function openView(
  page: Page,
  view: 'kanban' | 'list' | 'graph',
  space: typeof withMarked = withMarked,
) {
  await installBackend(page, { space })
  await page.goto(
    serializePlatformRoute({
      module_id: 'planning',
      scope: projectScope,
      entity: planningSpaceEntity(spaceRef),
      state: { view },
    }),
  )
}
