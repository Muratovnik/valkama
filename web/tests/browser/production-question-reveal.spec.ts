/**
 * An address that asks for a card's waiting question: a click on a Windows notification,
 * whichever way it reaches the page. The question stands in view under what the card keeps
 * over its top with the keyboard at its first field, as the mark in the head brings it; the
 * order leaves the address and is spent, and an address that does not ask moves nothing.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import type { InputRequestEntry } from '@/shared/api/inputRequestModel.ts'
import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { asRoot } from '../support/threads.ts'
import { installDiscussionBackend } from './discussionBackend.ts'
import { frames } from './frames.ts'
import {
  blockedWorkItem,
  identity,
  now,
  projectScope,
  spaceRef,
  workItemRef,
} from './planningFixtures.ts'
import { asked, installQuestions, QUESTION_ID } from './questionBackend.ts'
import { test } from './test.ts'

const ASKED = workItemRef.reference
const OTHER = blockedWorkItem.reference
const REVEAL = 'reveal=question'

const cardRoute = (reference: string) =>
  serializePlatformRoute({
    module_id: 'planning',
    scope: projectScope,
    entity: planningWorkItemEntity({ space_ref: spaceRef, reference }),
  })
const askingRoute = (reference: string) => `${cardRoute(reference)}&${REVEAL}`
const toastAddress = (reference: string) => `/open/${reference}?in=browser&${REVEAL}`

/** A card whose question stands well below its first screen, on a backend under the test. */
async function installLongCard(page: Page, entries: InputRequestEntry[]) {
  const backend = await installDiscussionBackend(page)
  backend.item.checklist = Array.from({ length: 40 }, (_, index) => ({
    id: identity(400 + index),
    text: `Step ${index + 1}`,
    done: false,
    claimed_by: '',
    done_by: '',
  }))
  const requests = await installQuestions(page, entries)
  // What the listener does with the short address: it keeps this one order and nothing else.
  await page.route(
    (url) => url.pathname.startsWith('/open/'),
    (route) => {
      const url = new URL(route.request().url())
      const reference = url.pathname.slice('/open/'.length)
      const asks = url.searchParams.getAll('reveal').join(',') === 'question'
      return route.fulfill({
        status: 302,
        headers: { Location: asks ? askingRoute(reference) : cardRoute(reference) },
      })
    },
  )
  return { backend, requests }
}

/** The page side of the desktop bridge, and a way to act as the main process handing over. */
async function asDesktop(page: Page) {
  await page.addInitScript(() => {
    const desktop = window as unknown as Window & { handOver: (route: string) => void }
    window.valkamaDesktop = {
      onOpenRoute(listener: (route: string) => void) {
        desktop.handOver = listener
      },
    } as unknown as typeof window.valkamaDesktop
  })
  const documents: string[] = []
  page.on('request', (request) => {
    if (request.resourceType() === 'document') documents.push(request.url())
  })
  return {
    documents,
    handOver: (route: string) =>
      page.evaluate((target) => {
        ;(window as unknown as { handOver: (route: string) => void }).handOver(target)
      }, route),
  }
}

const drawerOf = (page: Page) => page.locator('.drawer')
const cardOf = (page: Page) => drawerOf(page).locator('.request-card')
const scrollerOf = (page: Page) => drawerOf(page).locator('.drawer-frame-body')
const scrolled = (page: Page) => scrollerOf(page).evaluate((element) => element.scrollTop)

/** A read the server answers when the test says so. */
function answerLater() {
  const later: { promise?: Promise<void>; resolve?: () => void } = {}
  later.promise = new Promise<void>((done) => (later.resolve = done))
  return later
}

/** Whatever a read that has answered was going to do has been done and painted. */
const afterPaint = (page: Page) => frames(page.locator(':root'))

/** The first line of the question stands in view, under the tabs, with the keyboard on its field. */
async function expectBroughtToQuestion(page: Page) {
  await expect(cardOf(page).getByRole('radio').first()).toBeFocused()
  await expect
    .poll(async () => {
      const [card, tabs, body] = await Promise.all([
        cardOf(page).evaluate((element) => element.getBoundingClientRect().toJSON()),
        drawerOf(page)
          .locator('.drawer-frame-tabs')
          .evaluate((element) => element.getBoundingClientRect().toJSON()),
        scrollerOf(page).evaluate((element) => element.getBoundingClientRect().toJSON()),
      ])
      return card.top >= tabs.bottom - 1 && card.top + 40 <= body.bottom
    })
    .toBe(true)
  await expect(cardOf(page).locator('.request-meta')).toBeInViewport({ ratio: 1 })
  expect(await scrolled(page)).toBeGreaterThan(0)
  // Scrolled while it slid in, the drawer must still end up where it belongs.
  await expect(drawerOf(page)).toHaveCSS('transform', 'none')
  const right = await drawerOf(page).evaluate((element) => element.getBoundingClientRect().right)
  expect(right).toBe(page.viewportSize()?.width)
}

/** The card is open at its top, with its question read and nothing done about it. */
async function expectLeftAtItsTop(page: Page) {
  await expect(cardOf(page)).toBeAttached()
  await afterPaint(page)
  expect(await scrolled(page)).toBe(0)
  await expect(cardOf(page)).not.toBeInViewport()
  expect(await cardOf(page).evaluate((card) => card.contains(document.activeElement))).toBe(false)
}

for (const [width, height] of [
  [1280, 720],
  [390, 844],
] as const) {
  test(`an address that asks brings the question from below the first screen, at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height })
    await installLongCard(page, [asked()])
    await page.goto(askingRoute(ASKED))
    await expectBroughtToQuestion(page)
    // The order is out of the address, and no part of it reads as a dropped query.
    await expect(page).toHaveURL(cardRoute(ASKED))
    await expect(page.getByText('Part of the address', { exact: false })).toHaveCount(0)
    await page.reload()
    await expect(page).toHaveURL(cardRoute(ASKED))
    await expectLeftAtItsTop(page)
  })
}

test('the short address means the same in a browser, and Back does not ask again', async ({
  page,
}) => {
  await installLongCard(page, [asked()])
  await page.goto(toastAddress(ASKED))
  await expectBroughtToQuestion(page)
  await expect(page).toHaveURL(cardRoute(ASKED))

  await drawerOf(page).getByRole('button', { name: 'Close' }).first().click()
  await expect(cardOf(page)).toHaveCount(0)
  await page.goBack()
  await expect(page).toHaveURL(cardRoute(ASKED))
  await expectLeftAtItsTop(page)
})

test('an address that does not ask moves nothing', async ({ page }) => {
  await installLongCard(page, [asked()])
  await page.goto(cardRoute(ASKED))
  await expectLeftAtItsTop(page)
  await page.goto(`/open/${ASKED}?in=browser`)
  await expect(page).toHaveURL(cardRoute(ASKED))
  await expectLeftAtItsTop(page)
  await page.goto(`/open/${ASKED}?in=browser&reveal=other`)
  await expect(page).toHaveURL(cardRoute(ASKED))
  await expectLeftAtItsTop(page)
})

test('a row of the board opens the card at its top, after a toast has been followed', async ({
  page,
}) => {
  await installLongCard(page, [asked()])
  await page.goto(askingRoute(ASKED))
  await expectBroughtToQuestion(page)
  await drawerOf(page).getByRole('button', { name: 'Close' }).first().click()
  await expect(cardOf(page)).toHaveCount(0)
  await page.locator(`.work-item-column .work-item-tile`).filter({ hasText: ASKED }).first().click()
  await expectLeftAtItsTop(page)
})

test.describe('a page that is up', () => {
  test('with the card closed, the toast opens it at the question without reloading', async ({
    page,
  }) => {
    const app = await asDesktop(page)
    await installLongCard(page, [asked()])
    await page.goto(serializePlatformRoute({ module_id: 'planning', scope: projectScope }))
    await expect(page.locator('.work-item-tile').first()).toBeVisible()
    await app.handOver(toastAddress(ASKED))
    await expectBroughtToQuestion(page)
    await expect(page).toHaveURL(cardRoute(ASKED))
    expect(app.documents).toHaveLength(1)
  })

  test('with another card open, the toast moves to this one and to its question', async ({
    page,
  }) => {
    const app = await asDesktop(page)
    await installLongCard(page, [asked()])
    await page.goto(cardRoute(OTHER))
    await expect(drawerOf(page).locator('.head-reference')).toHaveText(OTHER)
    await app.handOver(toastAddress(ASKED))
    await expect(drawerOf(page).locator('.head-reference')).toHaveText(ASKED)
    await expectBroughtToQuestion(page)
    expect(app.documents).toHaveLength(1)
  })

  test('with this card open, the toast goes to the question though the address stays', async ({
    page,
  }) => {
    const app = await asDesktop(page)
    await installLongCard(page, [asked()])
    await page.goto(cardRoute(ASKED))
    await expectLeftAtItsTop(page)

    await app.handOver(toastAddress(ASKED))
    await expectBroughtToQuestion(page)
    await expect(page).toHaveURL(cardRoute(ASKED))

    // And every time: the reader went away from it and another toast came.
    await scrollerOf(page).evaluate((element) => element.scrollTo({ top: 0 }))
    await drawerOf(page).locator('.drawer-frame-close').focus()
    await app.handOver(askingRoute(ASKED))
    await expectBroughtToQuestion(page)
    await expect(page).toHaveURL(cardRoute(ASKED))
    expect(app.documents).toHaveLength(1)
  })

  test('with another section chosen, the toast comes back to the discussion', async ({ page }) => {
    const app = await asDesktop(page)
    await installLongCard(page, [asked()])
    await page.goto(cardRoute(ASKED))
    const relations = drawerOf(page).getByRole('tab', { name: 'Relations', exact: true })
    await relations.click()
    await expect(cardOf(page)).toBeHidden()
    await app.handOver(toastAddress(ASKED))
    await expectBroughtToQuestion(page)
    await expect(relations).toHaveAttribute('aria-selected', 'false')
  })

  test('with the panel of questions open, the toast closes it and reaches the question', async ({
    page,
  }) => {
    const app = await asDesktop(page)
    await installLongCard(page, [asked()])
    await page.goto(serializePlatformRoute({ module_id: 'planning', scope: projectScope }))
    await page.getByRole('button', { name: /^Needs my answer/u }).click()
    const hub = page.getByRole('dialog', { name: 'Needs my answer' })
    await expect(hub).toBeVisible()
    await app.handOver(toastAddress(ASKED))
    await expect(hub).toHaveCount(0)
    await expectBroughtToQuestion(page)
  })

  test('over a draft on another card, the leave check asks and the order waits for it', async ({
    page,
  }) => {
    const app = await asDesktop(page)
    await installLongCard(page, [asked()])
    await page.goto(cardRoute(OTHER))
    const strip = drawerOf(page).locator('.confirm-strip')
    const comment = drawerOf(page).getByRole('textbox', { name: 'Comment', exact: true })
    await comment.fill('Half a thought')

    // Kept: the order is over, and opening the card later is an ordinary opening.
    await app.handOver(toastAddress(ASKED))
    await expect(strip).toContainText('Unsaved changes will be lost: comment')
    await strip.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(comment).toHaveValue('Half a thought')
    await app.handOver(cardRoute(ASKED))
    await strip.getByRole('button', { name: 'Discard', exact: true }).click()
    await expect(drawerOf(page).locator('.head-reference')).toHaveText(ASKED)
    await expectLeftAtItsTop(page)

    // Discarded: the move goes on, and so does the order.
    await app.handOver(cardRoute(OTHER))
    await expect(drawerOf(page).locator('.head-reference')).toHaveText(OTHER)
    await comment.fill('Half a thought')
    await app.handOver(toastAddress(ASKED))
    await strip.getByRole('button', { name: 'Discard', exact: true }).click()
    await expect(drawerOf(page).locator('.head-reference')).toHaveText(ASKED)
    await expectBroughtToQuestion(page)
  })
})

test('the unresolved view keeps the question, and the order finds it there', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('valkama-thread-filter', 'unresolved'))
  const { backend } = await installLongCard(page, [asked()])
  backend.item.comments = [
    {
      id: 1,
      kind: 'comment',
      author: 'codex',
      at: now,
      ...asRoot,
      report: null,
      body: 'Settled long ago.',
      resolution: { at: now, by: 'user', by_person: true, text: 'Done.' },
    },
    { id: 2, kind: 'comment', author: 'codex', at: now, ...asRoot, report: null, body: 'Open.' },
  ]
  await page.goto(askingRoute(ASKED))
  await expect(drawerOf(page).getByRole('radio', { name: /^Unresolved/u })).toBeChecked()
  await expect(drawerOf(page).getByText('Settled long ago.')).toHaveCount(0)
  await expectBroughtToQuestion(page)
})

test('while the card is still loading the order waits, and lands once all of it is there', async ({
  page,
}) => {
  await installLongCard(page, [asked()])
  const chain = answerLater()
  const questions = answerLater()
  await page.route('**/api/planning/work-item/chain**', async (route) => {
    await chain.promise
    return route.fallback()
  })
  await page.route('**/api/modules/planning/requests**', async (route) => {
    await questions.promise
    return route.fallback()
  })

  await page.goto(askingRoute(ASKED))
  await expect(drawerOf(page).locator('.head-reference')).toHaveText(ASKED)
  // The order has left the address before anything it depends on has answered.
  await expect(page).toHaveURL(cardRoute(ASKED))
  questions.resolve?.()
  await expect(cardOf(page)).toBeAttached()
  await afterPaint(page)
  expect(await scrolled(page)).toBe(0)

  chain.resolve?.()
  await expectBroughtToQuestion(page)
})

test.describe('a question that no longer waits', () => {
  const ended = [
    ['answered', { status: 'answered', answers: { route: 'keep' } }],
    ['declined', { status: 'declined', resolved_at: now }],
    ['expired', { status: 'expired', resolved_at: now }],
  ] as const

  for (const [name, change] of ended) {
    test(`${name} before the click: the card simply opens at its top`, async ({ page }) => {
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await installLongCard(page, [asked(change)])
      await page.goto(askingRoute(ASKED))
      await expect(page).toHaveURL(cardRoute(ASKED))
      await expectLeftAtItsTop(page)
      await expect(drawerOf(page).getByRole('alert')).toHaveCount(0)
      expect(errors).toEqual([])
    })
  }

  test('answered elsewhere while the card stood open: nothing moves, not even for a frame', async ({
    page,
  }) => {
    const app = await asDesktop(page)
    const { requests } = await installLongCard(page, [asked()])
    await page.goto(cardRoute(ASKED))
    await expectLeftAtItsTop(page)
    const relations = drawerOf(page).getByRole('tab', { name: 'Relations', exact: true })
    await relations.click()
    await scrollerOf(page).evaluate((element) => {
      const seen = window as unknown as { scrolledAtAll?: boolean }
      element.addEventListener('scroll', () => (seen.scrolledAtAll = true))
    })

    // The card still believes it waits: only a read can tell, and the order asks first.
    requests.settle(QUESTION_ID, { status: 'answered', answers: { route: 'keep' } })
    const reads = requests.reads.length
    await app.handOver(toastAddress(ASKED))
    await expect.poll(() => requests.reads.length).toBeGreaterThan(reads)
    await afterPaint(page)
    await expect(relations).toHaveAttribute('aria-selected', 'true')
    expect(
      await page.evaluate(
        () => (window as unknown as { scrolledAtAll?: boolean }).scrolledAtAll === true,
      ),
    ).toBe(false)
  })
})
