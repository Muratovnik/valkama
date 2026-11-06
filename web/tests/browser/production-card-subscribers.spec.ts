/**
 * The sessions that follow an item without holding it, in the built application's card: one
 * line under the holder's, labelled in the holder label's quiet ink, each session printed as
 * the card prints a holder, from the label the server gives it, which is the text a claim of
 * that session records. The line starts on the column the head's other lines start on, a name
 * moves to the next line whole rather than breaking inside itself, and nothing draws a plate or
 * an edge around the plain words. A card nobody follows, or only its holder, has no such line.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { IN_VSCODE, openPlanFor, shortHolderCard } from './openSessionFixtures.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { projectScope, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

const CARD = serializePlatformRoute({
  module_id: 'planning',
  scope: projectScope,
  entity: planningWorkItemEntity(workItemRef),
})

const LABEL = { en: 'Subscribed', ru: 'Подписаны' } as const
const ONE = '019a3c2e-5b7d-7c11-9e0f-2f4b6d8a1c3e'
const since = '2026-08-13T08:00:00Z'

/**
 * A session as the card's read lists it. `label` is written out as the server writes it, from
 * the channel that proved the session, so a test never derives it from the client's name.
 */
const follower = (
  session: string,
  label: string,
  client: string | null = 'codex',
  agent: string | null = null,
) => ({ session, client, agent, label, since })
const ONE_LABEL = `codex (session ${ONE})`

/**
 * Five subagents of Claude Code sessions, whose agent ids are 16 hex digits, so each name is
 * wider than half a phone's line: a phone's line holds one of them, a laptop's two.
 */
const FIVE = Array.from({ length: 5 }, (_, index) => {
  const session = `0f1e2d3c-4b5a-4968-8778-${String(index).padStart(12, '0')}`
  const agent = `a7f3c19e0b2d4e5${index}`
  return follower(session, `claude agent ${agent} (session ${session})`, 'claude-code', agent)
})
/** A Codex subagent, whose agent id is a whole UUID: wider than a phone's line on its own. */
const CODEX_ID = '019a3c2e-6c8e-7d22-8f1a-3b5c7d9e2f4a'
const CODEX_AGENT = follower(ONE, `codex agent ${CODEX_ID} (session ${ONE})`, 'codex', CODEX_ID)

async function openCard(page: Page, locale: 'en' | 'ru', width: number, followers: object[]) {
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width, height: 900 })
  await installBackend(page, {
    card: (read) => ({ ...shortHolderCard(read), subscribers: followers }),
    openPlan: openPlanFor,
  })
  await page.goto(CARD)
  const drawer = page.locator('.drawer')
  await expect(drawer.locator('.card-facts')).toBeVisible()
  await expect(drawer).toHaveCSS('transform', 'none')
  await page.evaluate(() => document.fonts.ready)
  await page.mouse.move(0, 0)
  // Two frames, so a measurement reads the state the line has come to rest in.
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  )
  return drawer
}

/** An element's box, which a test reads only once the element is laid out. */
async function box(target: Locator) {
  const bounds = await target.boundingBox()
  if (!bounds) throw new Error('not laid out')
  return { ...bounds, bottom: bounds.y + bounds.height, right: bounds.x + bounds.width }
}

/** Where each line of an element's words is drawn, by a Range over them, top to bottom. */
const drawnLines = (target: Locator) =>
  target.evaluate((node) => {
    const range = document.createRange()
    range.selectNodeContents(node)
    const rects = [...range.getClientRects()].filter((rect) => rect.width > 0)
    return rects.map(({ left, right, top, bottom }) => ({ left, right, top, bottom }))
  })

/** What is drawn around an element itself: a ground, an edge, a ring or a shadow. */
const surround = (target: Locator) =>
  target.evaluate((node) => {
    const style = getComputedStyle(node)
    return {
      background: style.backgroundColor,
      border: ['Top', 'Right', 'Bottom', 'Left']
        .map((side) =>
          Number.parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`)),
        )
        .reduce((sum, width) => sum + width, 0),
      outline: style.outlineStyle,
      shadow: style.boxShadow,
    }
  })
const BARE = { background: 'rgba(0, 0, 0, 0)', border: 0, outline: 'none', shadow: 'none' }

for (const locale of ['ru', 'en'] as const)
  for (const width of [1280, 390]) {
    const at = `${locale} at ${width}`

    test(`${at}: one follower stands under the holder, its words on the head's left edge`, async ({
      page,
    }) => {
      const drawer = await openCard(page, locale, width, [follower(ONE, ONE_LABEL)])
      const line = drawer.locator('.card-subscribers')
      await expect(line).toBeVisible()
      const label = line.locator('.card-holder-label')
      await expect(label).toHaveText(LABEL[locale])
      const names = line.locator('.card-subscriber')
      // The holder's own spelling: the client, then the start of the session.
      await expect(names).toHaveText(['codex · 019a3c2e-5b7d'])
      await expect(names.first()).toHaveAttribute('title', ONE_LABEL)

      const block = await box(drawer.locator('.card-facts-block'))
      const [holderWords] = await drawnLines(drawer.locator('.card-holder .card-holder-label'))
      const [labelWords] = await drawnLines(label)
      // The drawn words, not the boxes: both lines start where the head's column starts.
      expect(labelWords.left, `${at}: the line against the holder's`).toBeCloseTo(
        holderWords.left,
        0,
      )
      expect(labelWords.left, `${at}: the line against the column`).toBeCloseTo(block.x, 0)
      // Under the holder's row, and before the labels' row.
      const holder = await box(drawer.locator('.card-holder'))
      const labels = await box(drawer.locator('.card-labels'))
      expect(labelWords.top).toBeGreaterThanOrEqual(holder.y + holder.height - 1)
      expect(labelWords.bottom).toBeLessThanOrEqual(labels.y)
      // The name and the label share their line, a word's room apart.
      const [nameWords] = await drawnLines(names.first())
      expect(Math.abs(nameWords.top - labelWords.top)).toBeLessThanOrEqual(1.5)
      expect(nameWords.left - labelWords.right).toBeCloseTo(8, 0)
      expect(await surround(line)).toEqual(BARE)
      expect(await surround(names.first())).toEqual(BARE)
    })

    test(`${at}: five long names wrap whole, each line from the head's left edge`, async ({
      page,
    }) => {
      const drawer = await openCard(page, locale, width, FIVE)
      const line = drawer.locator('.card-subscribers')
      const names = line.locator('.card-subscriber')
      await expect(names).toHaveCount(5)
      const block = await box(drawer.locator('.card-facts-block'))
      const [labelWords] = await drawnLines(line.locator('.card-holder-label'))
      const drawn = []
      for (const name of await names.all()) {
        const rects = await drawnLines(name)
        // One line each: a name never breaks inside itself.
        expect(new Set(rects.map((rect) => Math.round(rect.top))).size).toBe(1)
        // And whole: nothing of it given way to an ellipsis.
        expect(await name.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
        expect(rects[0].right).toBeLessThanOrEqual(block.x + block.width + 0.5)
        expect(await surround(name)).toEqual(BARE)
        drawn.push(rects[0])
      }
      // Each session's name, as the holder's label for it would print.
      await expect(names.first()).toHaveText('claude agent a7f3c19e0b2d4e50 · 0f1e2d3c-4b5a,')
      await expect(names.last()).not.toContainText(',')
      // The names take more lines than one, and every line after the first starts on the edge.
      const tops = [...new Set(drawn.map((rect) => Math.round(rect.top)))]
      expect(tops.length, `${at}: lines of names`).toBeGreaterThan(1)
      for (const top of tops.slice(1)) {
        const first = Math.min(
          ...drawn.filter((rect) => Math.round(rect.top) === top).map((rect) => rect.left),
        )
        expect(first, `${at}: the line at ${top}`).toBeCloseTo(labelWords.left, 0)
      }
      await expectNoSilentClipping(page, `${at}: five followers`)
    })

    // The holder following its own item is already named on the row above.
    for (const [who, followers] of [
      ['nobody follows', []],
      [
        'only the holder follows',
        [follower(IN_VSCODE, `claude (session ${IN_VSCODE})`, 'claude-code')],
      ],
    ] as const)
      test(`${at}: where ${who}, there is no line and no room for one`, async ({ page }) => {
        const drawer = await openCard(page, locale, width, [...followers])
        await expect(drawer.locator('.card-holder')).toBeVisible()
        await expect(drawer.locator('.card-subscribers')).toHaveCount(0)
        const holder = await box(drawer.locator('.card-holder'))
        const labels = await box(drawer.locator('.card-labels'))
        // The rows keep the head's own room between them, 12px, and nothing more.
        expect(labels.y - holder.bottom).toBeCloseTo(12, 0)
      })
  }

/**
 * The handshake names the client as it likes; the server labels a session by the channel that
 * proved it, and shortens an id a label cannot carry. The card reads the server's label, so the
 * holder following its own item, under a client name of its own, is still the holder.
 */
test('a subscriber is named by its label, and the holder among them by it too', async ({
  page,
}) => {
  const digest = 'codex agent 3f2a9c4e1b7d6a05 (session 0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e)'
  const drawer = await openCard(page, 'en', 1280, [
    follower(IN_VSCODE, `claude (session ${IN_VSCODE})`, 'gemini-cli'),
    follower(ONE, ONE_LABEL, 'gemini-cli'),
    follower('0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e', digest, 'codex', 'a'.repeat(60)),
  ])
  const names = drawer.locator('.card-subscribers .card-subscriber')
  await expect(names).toHaveText([
    'codex · 019a3c2e-5b7d,',
    'codex agent 3f2a9c4e1b7d6a05 · 0f1e2d3c-4b5a',
  ])
  await expect(names.first()).toHaveAttribute('title', ONE_LABEL)
  await expect(names.last()).toHaveAttribute('title', digest)
  await expect(drawer.locator('.card-subscribers')).not.toContainText('gemini')
})

test('on a phone a name wider than the line gives way and stays whole in its tooltip', async ({
  page,
}) => {
  const drawer = await openCard(page, 'ru', 390, [CODEX_AGENT, follower(ONE, ONE_LABEL)])
  const names = drawer.locator('.card-subscriber')
  await expect(names).toHaveCount(2)
  const long = names.first()
  await expect(long).toHaveCSS('text-overflow', 'ellipsis')
  expect(await long.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true)
  await expect(long).toHaveAttribute('title', CODEX_AGENT.label)
  const block = await box(drawer.locator('.card-facts-block'))
  const cut = await box(long)
  expect(cut.x + cut.width).toBeLessThanOrEqual(block.x + block.width + 0.5)
  // The short one after it stays whole, on a line of its own.
  expect(await names.last().evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
})
