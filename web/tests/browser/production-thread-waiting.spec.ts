/**
 * A comment that asks and waits for a reply, in the built application's card: its meta line
 * says so in plain words after the time, «· ждёт ответа», in that line's own ink and with
 * nothing drawn around them, until another session or a person replies in its thread. The
 * words come last on the line and stay beside the time only where the author keeps the lines
 * it has without them; otherwise they start a line of their own, with no dot. Either way the
 * author and the date keep the places they have without the mark, at every width, and as the
 * width changes. A reply the person writes from the card takes the mark away with no reload.
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

/** When the long author asked, and when the short one did: each control is written then too. */
const LONG_AT = '2026-08-13T09:31:00Z'
const SHORT_AT = '2026-08-13T09:38:00Z'
const REPLY_AT = '2026-08-13T10:37:00Z'

/**
 * Questions by a long author and a short one, each beside a note by the same author at the
 * same time that asks nothing; one answered by another session; and a reply that asks under a
 * root that does not, beside a reply by the same author at the same time that asks nothing.
 */
const asked = () => [
  root(31, 'Which parser does the export use?', {
    author: ASKER,
    at: LONG_AT,
    awaits_reply: true,
    answered: false,
  }),
  root(33, 'Is the old field still read anywhere?', {
    author: ASKER,
    awaits_reply: true,
    answered: true,
  }),
  reply(34, 33, 'No, nothing reads it since the last release.', { author: OTHER }),
  root(35, 'A plain note on the export, which asks nothing.', { author: ASKER, at: LONG_AT }),
  root(36, 'Who owns the importer now?', { author: OTHER }),
  reply(37, 36, 'Not this session; does the command line own it?', {
    author: ASKER,
    at: REPLY_AT,
    awaits_reply: true,
    answered: false,
  }),
  reply(41, 36, 'And a note under it that asks nothing.', { author: ASKER, at: REPLY_AT }),
  root(38, 'Does the import keep the order?', {
    author: SHORT,
    at: SHORT_AT,
    awaits_reply: true,
    answered: false,
  }),
  root(39, 'A short note that asks nothing.', { author: SHORT, at: SHORT_AT }),
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

/** The room a text separator " · " takes in a meta line's font, the time to the next word. */
const SEPARATOR = 8

/**
 * A meta line as drawn, by Ranges over its text rather than by boxes: where the author's first
 * words start, how many lines the author takes, which line the date is on, and the mark's
 * lines, with whether the mark follows the date on its line, a separator's room after it, or
 * starts a line of its own under it, on the line's edge.
 */
const metaOf = (meta: Locator, separator: number) =>
  meta.evaluate((line, room) => {
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
      Math.abs(words.left - time.right - room) <= 1
    const startsLine =
      words !== undefined && words.top >= time.bottom - 1 && Math.abs(words.left - box.left) <= 1
    return {
      authorLeft: author.left - box.left,
      authorTop: author.top - box.top,
      authorLines: new Set(drawn(who).map((rect) => Math.round(rect.top))).size,
      timeTop: time.top - box.top,
      box: { left: box.left, right: box.right, top: box.top, bottom: box.bottom },
      marks: marks.map(({ left, right, top, bottom }) => ({ left, right, top, bottom })),
      placed: followsTime || startsLine,
      followsTime,
    }
  }, separator)

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

/** Every entry that waits, beside the entry by the same author at the same time that does not. */
const PAIRS = [
  ['a long author', 'Which parser', 'A plain note', '.thread-meta'],
  ['a short author', 'Does the import keep', 'A short note', '.thread-meta'],
  ['a reply', 'does the command line own it', 'And a note under it', '.reply-meta'],
] as const

/** The meta line of the entry that holds this text: a thread's root, or a reply in it. */
function metaLine(drawer: Locator, text: string, line: string) {
  const entry =
    line === '.reply-meta'
      ? drawer.locator('.reply').filter({ hasText: text })
      : drawer.locator('.thread-entry').filter({ hasText: text })
  return entry.locator(line).first()
}

/**
 * The mark costs the author nothing: the author starts where it starts, takes as many lines as
 * the same author's line without the mark does, and the date stays on its line; the mark is one
 * line inside the meta line, after the date or starting a line of its own.
 */
async function expectPlaced(drawer: Locator, at: string) {
  for (const [kind, asking, plain, line] of PAIRS) {
    const drawn = await metaOf(metaLine(drawer, asking, line), SEPARATOR)
    const control = await metaOf(metaLine(drawer, plain, line), SEPARATOR)
    const of = `${at}, ${kind}`
    expect(control.marks, of).toHaveLength(0)
    expect(drawn.authorLines, `${of}: the author's lines`).toBe(control.authorLines)
    expect(drawn.authorLeft, `${of}: the author's start`).toBeCloseTo(control.authorLeft, 0)
    expect(drawn.timeTop, `${of}: the date's line`).toBeCloseTo(control.timeTop, 0)
    expect(new Set(drawn.marks.map((rect) => Math.round(rect.top))).size, of).toBe(1)
    const [mark] = drawn.marks
    expect(mark.left, of).toBeGreaterThanOrEqual(drawn.box.left - 0.5)
    expect(mark.right, of).toBeLessThanOrEqual(drawn.box.right + 0.5)
    expect(mark.top, of).toBeGreaterThanOrEqual(drawn.box.top - 0.5)
    expect(mark.bottom, of).toBeLessThanOrEqual(drawn.box.bottom + 0.5)
    expect(drawn.placed, `${of}: the mark after the date or starting a line`).toBe(true)
  }
}

for (const locale of ['ru', 'en'] as const)
  for (const width of [320, 390, 760, 1280])
    test(`${locale} at ${width}: the mark leaves the author its lines and the date its line`, async ({
      page,
    }) => {
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      const { drawer } = await openAsked(page, locale, width)
      await expect(drawer.locator('.meta-after')).toHaveCount(3)
      await expectPlaced(drawer, `${locale} at ${width}`)
      expect(errors).toEqual([])
    })

test('as the drawer narrows and widens, the mark is placed again for its width', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const { drawer } = await openAsked(page, 'ru', 1280)
  const placements = new Set<boolean>()
  for (const width of [760, 390, 320, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    await settle(page)
    await expectPlaced(drawer, `resized to ${width}`)
    const long = await metaOf(metaLine(drawer, 'Which parser', '.thread-meta'), SEPARATOR)
    placements.add(long.followsTime)
  }
  // The long author's mark has stood both ways on the way, so each width placed it again.
  expect([...placements].sort()).toEqual([false, true])
  expect(errors).toEqual([])
})

for (const locale of ['ru', 'en'] as const)
  for (const width of [1280, 390]) {
    const at = `${locale} at ${width}`

    test(`${at}: a question still waiting says so in the plain words of its line`, async ({
      page,
    }) => {
      const { thread } = await openAsked(page, locale, width)
      for (const asking of ['Which parser', 'Does the import keep']) {
        const waiting = thread(asking).locator('.thread-meta')
        await expect(waiting.locator('.meta-after')).toHaveText(WORDS[locale].mark)
        // Plain words of that line: its ink and size, nothing drawn around them.
        expect(await markStyle(waiting)).toEqual({
          around: ['rgba(0, 0, 0, 0)', 0, 'none', 'none'],
          ink: true,
          size: true,
          weight: true,
        })
      }
    })

    test(`${at}: a short author keeps the date on the first line, the mark with it`, async ({
      page,
    }) => {
      const { thread } = await openAsked(page, locale, width)
      // The case a mark counted as the name's width would break: the date shares the line.
      const drawn = await metaOf(thread('Does the import keep').locator('.thread-meta'), SEPARATOR)
      expect(drawn.authorLines, at).toBe(1)
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
      const importer = thread('Who owns the importer')
      const asking = importer.locator('.reply').filter({ hasText: 'does the command line' })
      await expect(asking.locator('.reply-meta .meta-after')).toHaveText(WORDS[locale].mark)
      // The thread's root, and the reply beside it, which asked nothing, say nothing.
      await expect(importer.locator('.thread-meta .meta-after')).toHaveCount(0)
      await expect(importer.locator('.meta-after')).toHaveCount(1)
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
