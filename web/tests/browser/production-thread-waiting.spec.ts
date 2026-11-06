/**
 * A comment that asks and waits for a reply, in the built application's card: its meta line
 * says so in plain words after the time, «· ждёт ответа», in that line's own ink and with
 * nothing drawn around them, until another session or a person replies in its thread. The
 * words come last on the line, so where the line is full they move to the next one and the
 * author and the date keep the places they have without them; a line they start has no dot.
 * A reply the person writes from the card takes the mark away with no reload.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { openCard } from './editorPage.ts'
import { test } from './test.ts'
import { reply, root } from './threadFixtures.ts'

const WORDS = {
  en: { mark: 'waiting for a reply', reply: 'Reply', send: 'Send' },
  ru: { mark: 'ждёт ответа', reply: 'Ответить', send: 'Отправить' },
} as const
type Locale = keyof typeof WORDS

const ASKER = 'codex (session 019a3c2e-5b7d-7c11-9e0f-2f4b6d8a1c3e)'
const OTHER = 'claude (session 0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e)'
/** An author shorter than the 14ch a name keeps beside the date, as an agent may sign. */
const SHORT = 'codex'

/**
 * Questions by a long author and a short one, each beside a note by the same author that asks
 * nothing; one answered by another session; and a reply that asks under a root that does not.
 */
const asked = () => [
  root(31, 'Which parser does the export use?', {
    author: ASKER,
    awaits_reply: true,
    answered: false,
  }),
  root(33, 'Is the old field still read anywhere?', {
    author: ASKER,
    awaits_reply: true,
    answered: true,
  }),
  reply(34, 33, 'No, nothing reads it since the last release.', { author: OTHER }),
  root(35, 'A plain note on the export, which asks nothing.', { author: ASKER }),
  root(36, 'Who owns the importer now?', { author: OTHER }),
  reply(37, 36, 'Not this session; does the command line own it?', {
    author: ASKER,
    awaits_reply: true,
    answered: false,
  }),
  root(38, 'Does the import keep the order?', {
    author: SHORT,
    awaits_reply: true,
    answered: false,
  }),
  root(39, 'A short note that asks nothing.', { author: SHORT }),
]

async function openAsked(page: Page, locale: Locale, width: number) {
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width, height: 900 })
  const opened = await openCard(page)
  opened.backend.item.comments.push(...asked())
  await page.reload()
  const thread = (text: string) => opened.drawer.locator('.thread-entry').filter({ hasText: text })
  await expect(thread('Which parser')).toBeVisible()
  await expect(opened.drawer).toHaveCSS('transform', 'none')
  await page.evaluate(() => document.fonts.ready)
  await page.mouse.move(0, 0)
  await settle(page)
  return { ...opened, thread }
}

/** Two frames, so a measurement reads the state the page has come to rest in. */
const settle = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  )

/**
 * A meta line as drawn, by Ranges over its text rather than by boxes: where the author's first
 * words and the date stand, and the mark's lines, with whether the mark follows the date on its
 * line, a dot's room after it, or starts a line of its own under it, on the line's edge.
 */
const metaOf = (meta: Locator) =>
  meta.evaluate((line) => {
    const who = line.querySelector('.meta-who')
    const when = line.querySelector('.meta-when')
    if (!who || !when) throw new Error('A name and a time')
    const range = document.createRange()
    const walker = document.createTreeWalker(who, NodeFilter.SHOW_TEXT)
    let first = walker.nextNode()
    while (first && !first.textContent?.trim()) first = walker.nextNode()
    if (!first) throw new Error('No author')
    const drawn = (node: Node) => {
      range.selectNodeContents(node)
      return [...range.getClientRects()].filter((rect) => rect.width > 0)
    }
    const [author] = drawn(first)
    const [time] = drawn(when)
    const mark = line.querySelector('.meta-after')
    const marks = mark ? drawn(mark) : []
    const box = line.getBoundingClientRect()
    const [words] = marks
    const followsTime =
      words !== undefined &&
      Math.abs(words.top - time.top) <= 2 &&
      Math.abs(words.left - time.right - 8) <= 1.5
    const startsLine =
      words !== undefined && words.top >= time.bottom - 1 && Math.abs(words.left - box.left) <= 1
    return {
      authorLeft: author.left - box.left,
      authorTop: author.top - box.top,
      timeTop: time.top - box.top,
      box: { left: box.left, right: box.right, top: box.top, bottom: box.bottom },
      marks: marks.map(({ left, right, top, bottom }) => ({ left, right, top, bottom })),
      placed: followsTime || startsLine,
    }
  })

/** What is drawn around the mark itself, and the ink and size of its words beside its line's. */
const markStyle = (meta: Locator) =>
  meta.evaluate((line) => {
    const mark = line.querySelector('.meta-after')
    if (!mark) throw new Error('No mark')
    const own = getComputedStyle(mark)
    const theirs = getComputedStyle(line)
    const edges = ['top', 'right', 'bottom', 'left'].map((side) =>
      Number.parseFloat(own.getPropertyValue(`border-${side}-width`)),
    )
    return {
      around: [own.backgroundColor, Math.max(...edges), own.outlineStyle, own.boxShadow],
      ink: own.color === theirs.color,
      size: own.fontSize === theirs.fontSize,
      weight: own.fontWeight === theirs.fontWeight,
    }
  })

for (const locale of ['ru', 'en'] as const)
  for (const width of [1280, 390]) {
    const at = `${locale} at ${width}`

    for (const [kind, asking, plain] of [
      ['a long author', 'Which parser', 'A plain note'],
      ['a short author', 'Does the import keep', 'A short note'],
    ] as const)
      test(`${at}: a question by ${kind} still waiting says so, and the date keeps its place`, async ({
        page,
      }) => {
        const { thread } = await openAsked(page, locale, width)
        const waiting = thread(asking).locator('.thread-meta')
        await expect(waiting.locator('.meta-after')).toHaveText(WORDS[locale].mark)
        const drawn = await metaOf(waiting)
        // A note by the same author at the same time of day, which asks nothing: the control.
        const control = await metaOf(thread(plain).locator('.thread-meta'))
        expect(control.marks).toHaveLength(0)
        // The author still starts the line, and the date stands where it stands without the mark.
        expect(drawn.authorTop, `${at}: the author's line`).toBeCloseTo(control.authorTop, 0)
        expect(drawn.authorLeft, `${at}: the author's start`).toBeCloseTo(control.authorLeft, 0)
        expect(drawn.timeTop, `${at}: the date's line`).toBeCloseTo(control.timeTop, 0)
        // The mark is one line of the meta line's words, inside it, after the date or under it.
        expect(new Set(drawn.marks.map((rect) => Math.round(rect.top))).size, at).toBe(1)
        const [mark] = drawn.marks
        expect(mark.left).toBeGreaterThanOrEqual(drawn.box.left - 0.5)
        expect(mark.right).toBeLessThanOrEqual(drawn.box.right + 0.5)
        expect(mark.top).toBeGreaterThanOrEqual(drawn.box.top - 0.5)
        expect(mark.bottom).toBeLessThanOrEqual(drawn.box.bottom + 0.5)
        expect(drawn.placed, `${at}: the mark after the date or starting a line`).toBe(true)
        // Plain words of that line: its ink and size, nothing drawn around them.
        expect(await markStyle(waiting)).toEqual({
          around: ['rgba(0, 0, 0, 0)', 0, 'none', 'none'],
          ink: true,
          size: true,
          weight: true,
        })
      })

    test(`${at}: a short author keeps the date on the first line, the mark with it`, async ({
      page,
    }) => {
      const { thread } = await openAsked(page, locale, width)
      // The case a mark counted as the name's width would break: the date shares the line.
      const drawn = await metaOf(thread('Does the import keep').locator('.thread-meta'))
      expect(Math.abs(drawn.timeTop - drawn.authorTop), at).toBeLessThanOrEqual(2)
      expect(drawn.marks).toHaveLength(1)
    })

    test(`${at}: an answered question has no mark, and a reply that asks has one`, async ({
      page,
    }) => {
      const { thread } = await openAsked(page, locale, width)
      const answered = thread('Is the old field')
      await expect(answered.getByText('nothing reads it')).toBeVisible()
      await expect(answered.locator('.meta-after')).toHaveCount(0)
      await expect(thread('A plain note').locator('.meta-after')).toHaveCount(0)
      const asking = thread('Who owns the importer').locator('.reply')
      await expect(asking.locator('.reply-meta .meta-after')).toHaveText(WORDS[locale].mark)
      // The thread's root, which asked nothing, says nothing.
      await expect(thread('Who owns the importer').locator('.thread-meta .meta-after')).toHaveCount(
        0,
      )
      const drawn = await metaOf(asking.locator('.reply-meta'))
      expect(new Set(drawn.marks.map((rect) => Math.round(rect.top))).size).toBe(1)
      expect(drawn.marks[0].right).toBeLessThanOrEqual(drawn.box.right + 0.5)
      expect(drawn.placed, `${at}: the reply's mark after the date or starting a line`).toBe(true)
    })

    test(`${at}: a reply written from the card takes the mark away with no reload`, async ({
      page,
    }) => {
      const { thread } = await openAsked(page, locale, width)
      const waiting = thread('Which parser')
      await expect(waiting.locator('.meta-after')).toBeVisible()
      // Survives only as long as the page does: a reload would drop it.
      await page.evaluate(() => Object.assign(window, { sameDocument: true }))
      await waiting.getByRole('button', { name: WORDS[locale].reply, exact: true }).click()
      await page.keyboard.insertText('The streaming one, since the last release.')
      await waiting.getByRole('button', { name: WORDS[locale].send, exact: true }).click()
      await expect(waiting.locator('.reply').filter({ hasText: 'The streaming one' })).toBeVisible()
      await expect(waiting.locator('.meta-after')).toHaveCount(0)
      expect(await page.evaluate(() => 'sameDocument' in window)).toBe(true)
      // The question that still waits in another thread keeps its mark.
      await expect(thread('Who owns the importer').locator('.meta-after')).toHaveCount(1)
    })
  }
