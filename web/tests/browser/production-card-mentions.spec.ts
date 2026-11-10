/**
 * Where another item's text named this one, its discussion shows the record as a quiet line
 * among the threads (`InspectorMentionLine`): by its time in the order the threads take, its
 * item's number the link to that item, its words on one line with the whole of them in the
 * hint, and the threads around it where they stood without it. A card read with more records
 * than it brings says how many older ones it leaves out.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { blockedWorkItem, projectScope, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'
import { drawnLines, expectUnitHeld } from './textLines.ts'
import { root } from './threadFixtures.ts'

type Locale = 'en' | 'ru'

const CARD = serializePlatformRoute({
  module_id: 'planning',
  scope: projectScope,
  entity: planningWorkItemEntity(workItemRef),
})

const SOURCE = blockedWorkItem.reference
const QUOTE =
  `${workItemRef.reference} decides what the export keeps, so the step claims wait for it; ` +
  'the rest of this comment runs on well past one line of the discussion at any width.'

/** Three threads two hours apart, and the records standing between them and above them. */
const comments = [
  root(1, 'The oldest thread.', { at: '2026-08-13T09:00:00Z' }),
  root(2, 'The middle thread.', { at: '2026-08-13T11:00:00Z' }),
  root(3, 'The newest thread.', { at: '2026-08-13T13:00:00Z' }),
]
const records = [
  {
    in: 'comment',
    comment_id: 41,
    from: SOURCE,
    at: '2026-08-13T10:00:00Z',
    by_person: false,
    author: 'kolo (session 019a2b3c-4d5e)',
    quote: QUOTE,
  },
  {
    in: 'report',
    comment_id: 42,
    from: SOURCE,
    at: '2026-08-13T12:00:00Z',
    by_person: true,
    author: 'user',
    quote: 'Shipped the **export**.',
  },
  {
    in: 'comment',
    comment_id: 43,
    from: null,
    at: '2026-08-13T14:00:00Z',
    by_person: false,
    author: 'elko',
    quote: null,
  },
]

const WORDS = {
  en: {
    comment: `Mentioned in a comment on ${SOURCE}`,
    report: `Mentioned in a work report on ${SOURCE}`,
    deleted: 'Mentioned in a deleted work item',
    older: '2 older mentions not shown',
  },
  ru: {
    comment: `Упомянута в комментарии ${SOURCE}`,
    report: `Упомянута в отчёте о работе ${SOURCE}`,
    deleted: 'Упомянута в удалённой задаче',
    older: 'Ещё 2 более ранних упоминания не показаны',
  },
} as const

type Mentions = { mentions?: unknown[]; mentions_total?: number }

async function openCard(page: Page, locale: Locale, width: number, mentions: Mentions) {
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  await page.setViewportSize({ width, height: 900 })
  // The hint's delay runs on this clock.
  await page.clock.install()
  await installBackend(page, {
    comments,
    card: (read) => (read.reference === workItemRef.reference ? { ...read, ...mentions } : read),
  })
  await page.goto(CARD)
  const drawer = page.locator('.drawer')
  await expect(drawer.locator('.thread-entry')).toHaveCount(3)
  await expect(drawer).toHaveCSS('transform', 'none')
  return drawer
}

/** Each thread's box, by its first words, read from the page in one pass. */
async function threadBoxes(drawer: Locator) {
  return drawer.locator('.thread-entry').evaluateAll((entries) =>
    entries.map((entry) => {
      const { x, y, width, height } = entry.getBoundingClientRect()
      return { text: entry.querySelector('.thread-text')?.textContent?.trim(), x, y, width, height }
    }),
  )
}

for (const width of [1280, 390] as const)
  for (const locale of ['en', 'ru'] as const) {
    test(`mention lines stand among the threads by time at ${width}px, ${locale}`, async ({
      page,
    }) => {
      const drawer = await openCard(page, locale, width, {
        mentions: records,
        mentions_total: 5,
      })
      const words = WORDS[locale]
      const rows = drawer.locator('.thread > li')
      // Newest first, a line between the two threads its time falls between.
      await expect(rows).toHaveText([
        new RegExp(`^${words.deleted}`, 'u'),
        /The newest thread\./u,
        new RegExp(`^${words.report}`, 'u'),
        /The middle thread\./u,
        new RegExp(`^${words.comment}`, 'u'),
        /The oldest thread\./u,
      ])
      // Not a thread: no sheet, no action, and the heading counts the threads alone.
      const lines = drawer.locator('.mention')
      await expect(lines).toHaveCount(3)
      await expect(lines.locator('button')).toHaveCount(0)
      await expect(lines.first()).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
      await expect(drawer.locator('.discussion .section-header-count')).toHaveText('3')
      await expect(drawer.locator('.discussion')).toContainText(words.older)

      const commentLine = lines.nth(2)
      const reportLine = lines.nth(1)
      const deletedLine = lines.nth(0)
      // Who wrote it, as a comment's head says it, and its words without their markup.
      await expect(commentLine.locator('.meta-who')).toContainText('kolo')
      await expect(commentLine.locator('.meta-session')).toBeVisible()
      await expect(reportLine.locator('.meta-who')).toContainText(locale === 'en' ? 'you' : 'вы')
      await expect(reportLine.locator('.mention-quote')).toHaveText('Shipped the export.')
      // Who and when are one unit, as on a comment's head.
      const heads = await lines.locator('.mention-head').all()
      for (const [index, head] of heads.entries())
        await expectUnitHeld(head, `Mention ${index} at ${width}px, ${locale}`)
      // The item's number is drawn whole on one line: held to the author, it broke at its
      // hyphen at 390px, «MAIN-» over «265».
      for (const linked of [commentLine, reportLine])
        expect(await drawnLines(linked, '.mention-where a')).toHaveLength(1)
      // A deleted item: no link and no words.
      await expect(deletedLine.locator('a')).toHaveCount(0)
      await expect(deletedLine.locator('.mention-quote')).toHaveCount(0)

      // The words take one line, inside their line and under its head, never on it.
      const quote = commentLine.locator('.mention-quote')
      await expect(quote).toBeVisible()
      const geometry = await commentLine.evaluate((line) => {
        const words = line.querySelector('.mention-quote') as HTMLElement
        const head = line.querySelector('.mention-head') as HTMLElement
        return {
          line: line.getBoundingClientRect().toJSON() as DOMRect,
          head: head.getBoundingClientRect().toJSON() as DOMRect,
          words: words.getBoundingClientRect().toJSON() as DOMRect,
          lineHeight: Number.parseFloat(getComputedStyle(words).lineHeight),
          cut: words.scrollWidth > words.clientWidth,
        }
      })
      const { line, head, words: said } = geometry
      expect(said.top).toBeGreaterThanOrEqual(head.bottom - 0.5)
      expect(said.left).toBeGreaterThanOrEqual(line.left - 0.5)
      expect(said.right).toBeLessThanOrEqual(line.right + 0.5)
      expect(said.bottom).toBeLessThanOrEqual(line.bottom + 0.5)
      expect(said.height).toBeLessThanOrEqual(geometry.lineHeight + 1)
      // Cut words say so: the line ends in an ellipsis and its hint holds them whole.
      expect(geometry.cut).toBe(true)
      await expect(quote).toHaveCSS('text-overflow', 'ellipsis')
      await quote.scrollIntoViewIfNeeded()
      await quote.hover()
      await page.clock.runFor(1000)
      await expect(page.locator('.tooltip-hint')).toContainText(QUOTE)
      // No row of the list stands over another.
      const boxes = await rows.evaluateAll((items) =>
        items.map((item) => item.getBoundingClientRect()),
      )
      for (const [index, box] of boxes.slice(1).entries())
        expect(box.top).toBeGreaterThanOrEqual(boxes[index].bottom - 0.5)
      await expectNoSilentClipping(page, `Mention lines at ${width}px, ${locale}`, '.discussion')

      // The keys reach the item's number, with the ring every link shows.
      const link = commentLine.locator('.mention-where a')
      await expect(link).toHaveText(SOURCE)
      // The last control of the thread over it, then one Tab.
      await drawer.locator('#work-report-2 button').last().focus()
      await page.keyboard.press('Tab')
      await expect(link).toBeFocused()
      const ring = await link.evaluate((node) => {
        const style = getComputedStyle(node)
        return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) }
      })
      expect(ring.style).not.toBe('none')
      expect(ring.width).toBeGreaterThan(0)
      // Pressing it opens the item the words stand on.
      await page.keyboard.press('Enter')
      await expect(drawer.locator('.card-identity')).toContainText(SOURCE)
    })

    test(`mention lines move no thread at ${width}px, ${locale}`, async ({ context, page }) => {
      const none = await openCard(page, locale, width, {})
      const before = await threadBoxes(none)
      // A read with no records draws the discussion as one without the field.
      const empty = await openCard(await context.newPage(), locale, width, {
        mentions: [],
        mentions_total: 0,
      })
      expect(await threadBoxes(empty)).toEqual(before)
      await expect(empty.locator('.mention')).toHaveCount(0)
      // With records, each thread keeps its column and its height; only lines come between.
      const told = await openCard(await context.newPage(), locale, width, {
        mentions: records,
        mentions_total: 3,
      })
      await expect(told.locator('.mention')).toHaveCount(3)
      const after = await threadBoxes(told)
      expect(after.map(({ text, x, width: wide, height }) => ({ text, x, wide, height }))).toEqual(
        before.map(({ text, x, width: wide, height }) => ({ text, x, wide, height })),
      )
      await expect(told.locator('.discussion')).not.toContainText(WORDS[locale].older)
    })
  }
