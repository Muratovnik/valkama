/**
 * The hover card's browser-spec harness: a space holding the items a text refers
 * to, a card whose report names them, a server that answers the brief read, and the
 * pointer moves and readings the specs share.
 */
import { expect } from '@playwright/test'
import type { Locator, Page, Route } from '@playwright/test'

import type { WorkItem } from '@/shared/api/planningModel.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { asRoot } from '../support/threads.ts'
import { installBackend } from './backend.ts'
import { installDiscussionBackend } from './discussionBackend.ts'
import { now, spaceScope } from './planningFixtures.ts'
import { asked, installQuestions } from './questionBackend.ts'
import { SPACE, spaceModel } from './served/preview.ts'
import type { Brief } from './served/preview.ts'
import { briefAnswer } from './servedAnswers.ts'
import { installStreamDouble } from './streamDouble.ts'

/** A report on the card that names every item of the space, for the pointer to walk. */
const REPORT = [
  'See MAIN-12 for the read and MAIN-13 next to it, and MAIN-265 further on.',
  '',
  '- MAIN-14 first',
  '- MAIN-15 second',
  '- MAIN-16 third',
  '',
  'Nothing to hover on this line, and SHA-256 stays text.',
].join('\n')

/** The card `MAIN-264` open on `body`, with the space under it and the stream in the test's hand. */
export async function openReported(page: Page, body = REPORT, items: readonly Brief[] = SPACE) {
  const backend = await installDiscussionBackend(page)
  const stream = await installStreamDouble(page)
  await page.route('**/api/planning?*', (route) => route.fulfill({ json: spaceModel(items) }))
  backend.item.comments.push({
    id: 1,
    kind: 'comment',
    ...asRoot,
    report: null,
    body,
    author: 'agent',
    at: now,
    checklist_item_id: null,
    checklist_item_text: null,
  } as WorkItem['comments'][number])
  await page.goto(serializePlatformRoute({ module_id: 'planning', scope: spaceScope }))
  await page.locator('.work-item-tile').filter({ hasText: 'MAIN-264' }).first().click()
  const drawer = page.locator('.drawer')
  await expect(drawer).toHaveCSS('transform', 'none')
  const entry = drawer.locator('.thread-entry').first()
  await expect(entry).toBeVisible()
  return { backend, drawer, entry, stream }
}

export const CARD = '.reference-preview'
export const card = (page: Page) => page.locator(CARD)
export const reference = (scope: Locator, name: string) =>
  scope.getByRole('link', { name, exact: true })

/** The middle of an element, as the pointer would aim at it. */
export async function middle(locator: Locator) {
  const box = await locator.boundingBox()
  if (!box) throw new Error('Not on screen')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/** The pointer rests on a reference. Moved there, since a card opens only on a move. */
export async function rest(page: Page, link: Locator) {
  await link.scrollIntoViewIfNeeded()
  const { x, y } = await middle(link)
  await page.mouse.move(x, y, { steps: 3 })
}

export const pause = (ms: number) => new Promise((done) => setTimeout(done, ms))

/** How many cards show once the delay a card would take has passed: what never came. */
export async function cardsAfterTheDelay(page: Page) {
  await pause(800)
  return card(page).count()
}

/** Long enough off a reference that the next one waits its delay again. */
export const coolDown = () => pause(350)

/**
 * Milliseconds from now until a card is on the page, as the page itself counts them,
 * so a slow test process does not read as a slow card. Call it before the move.
 */
export function watchOpening(page: Page) {
  return page.evaluate(
    (selector) =>
      new Promise<number>((resolve) => {
        const start = performance.now()
        const seen = new MutationObserver(() => {
          if (!document.querySelector(selector)) return
          seen.disconnect()
          resolve(performance.now() - start)
        })
        seen.observe(document.body, { childList: true, subtree: true })
      }),
    CARD,
  )
}

export interface BriefReads {
  /** Every brief read the page made, oldest first: its reference and store. */
  asked: { reference: string; scope: string }[]
  /** Answer with this from now on: a status, the abort of a connection, or a delay. */
  answer: (next: (route: Route, reference: string) => Promise<void> | void) => void
}

export const refusal = (status: number) => ({ status, json: { error: { code: 'refused' } } })

/** Answer the brief read from `items`; a reference it does not hold is a 404. */
async function serveBrief(page: Page, items: readonly Brief[]): Promise<BriefReads> {
  const asked: BriefReads['asked'] = []
  let answer: Parameters<BriefReads['answer']>[0] = (route, wanted) => {
    const item = items.find((candidate) => candidate.reference === wanted)
    return route.fulfill(item ? briefAnswer(item) : refusal(404))
  }
  await page.route('**/api/modules/planning/work-item?*', (route) => {
    const query = new URL(route.request().url()).searchParams
    if (query.get('brief') !== 'true') return route.fallback()
    const wanted = query.get('reference') ?? ''
    asked.push({ reference: wanted, scope: query.get('data_scope_id') ?? '' })
    return answer(route, wanted)
  })
  return {
    asked,
    answer: (next) => {
      answer = next
    },
  }
}

export const HUB_PROMPT = 'Should MAIN-12 ship before MAIN-13 or MAIN-14?'

/** The list of everything waiting, on a question whose text names items of the space. */
export async function openHub(
  page: Page,
  items: readonly Brief[] = SPACE,
  backend: Parameters<typeof installBackend>[1] = {},
) {
  await installBackend(page, backend)
  await installQuestions(page, [asked({ prompt: HUB_PROMPT })])
  const reads = await serveBrief(page, items)
  await page.goto(serializePlatformRoute({ module_id: 'planning', scope: spaceScope }))
  await page.getByRole('button', { name: /^Needs my answer/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Needs my answer', exact: true })
  await expect(dialog).toHaveCSS('transform', 'none')
  await expect(reference(dialog, 'MAIN-12')).toBeVisible()
  return { dialog, reads }
}

export { held, SPACE, spaceModel } from './served/preview.ts'
export { briefAnswer } from './servedAnswers.ts'
