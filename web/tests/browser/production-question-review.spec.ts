/**
 * The real 25-field review answered in a card's thread, on the built app: nothing scrolls
 * sideways at a laptop's width or a phone's, no label shows its backticks, the form's head and
 * foot stay in sight while it scrolls and never cover what has focus, and one press of Accept
 * recommended and Send posts the flat answer the contract shows.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { recommendedAnswer, REVIEW_PROMPT, reviewFields } from '../support/reviewQuestion.ts'
import { box } from './editorPage.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { asked, openQuestion, send } from './questionBackend.ts'
import { test } from './test.ts'

// Playwright hides scrollbars, and one that arrives narrows what it scrolls on a real screen.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } })

const WIDTHS = [1280, 390] as const

async function openReview(page: Page, width: number) {
  await page.setViewportSize({ width, height: 844 })
  const opened = await openQuestion(page, [
    asked({ prompt: REVIEW_PROMPT, fields: reviewFields, title: 'Review of the checks' }),
  ])
  const { drawer, card } = opened
  const scroller = drawer.locator('.drawer-frame-body')
  const head = card.locator('.request-review-head')
  const foot = card.locator('footer.request-foot')
  await expect(card.locator('.request-point')).toHaveCount(18)
  return { ...opened, foot, head, scroller }
}

/**
 * What the element with focus is covered by, read in the page: the form's head or foot when
 * focus is in the card, outside both, and its box shares area with theirs. Empty otherwise.
 */
const coveredBy = (card: Locator) =>
  card.evaluate((root) => {
    const active = document.activeElement
    if (!(active instanceof HTMLElement) || !root.contains(active)) return []
    const a = active.getBoundingClientRect()
    return [...root.querySelectorAll<HTMLElement>('[data-stuck-edge]')]
      .filter((edge) => !edge.contains(active))
      .filter((edge) => {
        const b = edge.getBoundingClientRect()
        return a.top < b.bottom && b.top < a.bottom && a.left < b.right && b.left < a.right
      })
      .map((edge) => edge.dataset.stuckEdge ?? '')
  })

for (const width of WIDTHS) {
  test(`the review scrolls nothing sideways and shows no backticks, at ${width}`, async ({
    page,
  }) => {
    const { card, scroller } = await openReview(page, width)
    await card.getByRole('button', { name: 'Accept recommended', exact: true }).click()
    await expect(card.locator('.request-review-head')).toContainText('Decided 18 of 18')
    expect(
      await scroller.evaluate((node) => node.scrollWidth - node.clientWidth),
    ).toBeLessThanOrEqual(0)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(0)
    await expectNoSilentClipping(page, `review at ${width}`, '.request-card')
    const labels = card.locator('.request-point-label, .request-option-label')
    expect(await labels.count()).toBeGreaterThan(40)
    for (const text of await labels.allTextContents()) expect(text).not.toContain('`')
    await expect(card.locator('.request-point-label code').first()).toBeVisible()
  })

  test(`the head and the foot stay in sight while the form scrolls, at ${width}`, async ({
    page,
  }) => {
    const { foot, head, scroller } = await openReview(page, width)
    const panel = await box(scroller)
    for (const share of [0.3, 0.6]) {
      await scroller.evaluate((node, part) => {
        node.scrollTop = node.scrollHeight * part
      }, share)
      await expect(head).toBeInViewport()
      await expect(foot).toBeInViewport()
      const top = await box(head)
      const bottom = await box(foot)
      expect(top.y).toBeGreaterThanOrEqual(panel.y)
      expect(top.y).toBeLessThan(panel.y + panel.height / 3)
      expect(bottom.y + bottom.height).toBeCloseTo(panel.y + panel.height, -1)
      await expect(foot.getByRole('button', { name: 'Send', exact: true })).toBeInViewport()
    }
  })

  test(`what has focus is never under the head or the foot, at ${width}`, async ({ page }) => {
    const { card } = await openReview(page, width)
    await card.getByRole('button', { name: 'Accept recommended', exact: true }).focus()
    await expect(card.locator('[data-stuck-edge]')).toHaveCount(2)
    const covered: string[] = []
    for (const key of [
      ...Array.from({ length: 40 }, () => 'Tab'),
      ...Array.from({ length: 40 }, () => 'Shift+Tab'),
    ]) {
      await page.keyboard.press(key)
      const edges = await coveredBy(card)
      covered.push(...edges.map((edge) => `${key} under the ${edge}`))
    }
    expect(covered).toEqual([])
  })
}

test.describe('in Russian, whose words are the longest the form carries', () => {
  test.use({ locale: 'ru-RU' })

  for (const width of WIDTHS) {
    test(`the review scrolls nothing sideways, at ${width}`, async ({ page }) => {
      const { card, scroller } = await openReview(page, width)
      await card.getByRole('button', { name: 'Принять рекомендованное', exact: true }).click()
      await expect(card.locator('.request-review-head')).toContainText('Решено 18 из 18')
      expect(
        await scroller.evaluate((node) => node.scrollWidth - node.clientWidth),
      ).toBeLessThanOrEqual(0)
      await expectNoSilentClipping(page, `review in Russian at ${width}`, '.request-card')
      for (const point of await card.locator('.request-point').all()) {
        const outer = await box(point)
        for (const control of await point.locator('button').all()) {
          const inner = await box(control)
          expect(inner.x + inner.width).toBeLessThanOrEqual(outer.x + outer.width + 0.5)
        }
      }
    })
  }
})

test('Accept recommended and Send post the flat answer the contract shows', async ({ page }) => {
  const { card, requests } = await openReview(page, 1280)
  await card.getByRole('button', { name: 'Accept recommended', exact: true }).click()
  await expect(card.getByRole('status').filter({ hasText: 'Filled' })).toHaveText(
    'Filled from the recommendation: 18 rows',
  )
  await send(card).click()
  await expect.poll(() => requests.writes.length).toBe(1)
  const [write] = requests.writes
  expect(write?.action).toBe('answer')
  expect(write?.body.answers).toEqual(recommendedAnswer)
  expect(write?.body).not.toHaveProperty('own.p4-steps')
  await expect(card.locator('.request-state')).toContainText('You answered')
})
