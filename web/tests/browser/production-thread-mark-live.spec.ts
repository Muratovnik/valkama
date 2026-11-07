/**
 * The waiting mark, «· пока без ответа», stays where its rule puts it while the card lives: after
 * the date where that costs the author none of its lines and the date stays on its line, and on
 * a line of its own otherwise. The rule is checked here against an oracle built from the line
 * itself, which lays a copy of it out three ways, without the mark, with the mark beside the date
 * and with the mark on its own line, and reads which place the rule asks for. The line is checked
 * after the author's name changes on a read, when no width changes, and at every step of a drawer
 * narrowed to a phone's and widened back, a few frames after each step.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { openCard } from './editorPage.ts'
import { test } from './test.ts'
import { reply, root } from './threadFixtures.ts'

const WORDS = {
  en: { reply: 'Reply', send: 'Send' },
  ru: { reply: 'Ответить', send: 'Отправить' },
} as const
type Locale = keyof typeof WORDS

const ASKER = 'codex (session 019a3c2e-5b7d-7c11-9e0f-2f4b6d8a1c3e)'
const OTHER = 'claude (session 0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e)'
const AGENT = 'claude agent a7f3c19e0b2d4e50 (session 0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e)'
const SHORT = 'codex'
const LONG_AT = '2026-08-13T09:31:00Z'
const SHORT_AT = '2026-08-13T09:38:00Z'
const REPLY_AT = '2026-08-13T10:37:00Z'

/** Questions by long and short authors, a reply that asks, and a thread to write in. */
const asked = () => [
  root(31, 'Which parser does the export use?', {
    author: ASKER,
    at: LONG_AT,
    awaits_reply: true,
    answered: false,
  }),
  root(36, 'Who owns the importer now?', { author: OTHER }),
  reply(37, 36, 'Not this session; does the command line own it?', {
    author: ASKER,
    at: REPLY_AT,
    awaits_reply: true,
    answered: false,
  }),
  root(38, 'Does the import keep the order?', {
    author: SHORT,
    at: SHORT_AT,
    awaits_reply: true,
    answered: false,
  }),
  root(39, 'A short note that asks nothing.', { author: SHORT, at: SHORT_AT }),
  root(51, 'Should the digest wait for the import?', {
    author: AGENT,
    at: LONG_AT,
    awaits_reply: true,
    answered: false,
  }),
]

const settle = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  )

async function openAsked(page: Page, locale: Locale, width: number) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  // A ResizeObserver loop is reported to the window, not thrown: collect it as well.
  await page.addInitScript(() => {
    const seen: string[] = []
    Object.assign(window, { seenErrors: seen })
    window.addEventListener('error', (event) => seen.push(String(event.message)))
  })
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
  await settle(page)
  const pageErrors = async () => [
    ...errors,
    ...(await page.evaluate(() => (window as unknown as { seenErrors: string[] }).seenErrors)),
  ]
  return { ...opened, thread, pageErrors }
}

interface Placement {
  authorLines: number
  authorLinesWithout: number
  dateTop: number
  dateTopWithout: number
  entry: string
  /** Where the rule puts it: beside the date unless that costs a line of the author or the date's line. */
  expected: boolean
  markLines: number
  /** The mark starts a line of its own, as drawn: its words below the date's line. */
  own: boolean
}

/**
 * Every line with a mark in the drawer, as drawn and as the oracle reads it. The oracle lays a
 * hidden copy of the line out at the same width without the mark, with it beside the date and
 * with it on its own line, and reads the author's lines and the date's line from Ranges.
 */
const placements = (page: Page) =>
  page.evaluate(() => {
    const drawn = (node: Element) => {
      const range = document.createRange()
      range.selectNodeContents(node)
      return [...range.getClientRects()].filter((rect) => rect.width > 0)
    }
    // A rect starts a line when it begins below the middle of the line before. An agent's
    // session, in the metadata font, stands a pixel lower than the name on the same line, and
    // counted by rounded tops a one-line name read as two, as long as a name that wrapped.
    const lines = (node: Element) => {
      let count = 0
      let middle = Number.NEGATIVE_INFINITY
      for (const rect of drawn(node).sort((one, other) => one.top - other.top))
        if (rect.top > middle) {
          count += 1
          middle = (rect.top + rect.bottom) / 2
        }
      return count
    }
    const read = (line: Element) => {
      const box = line.getBoundingClientRect()
      const who = line.querySelector('.meta-who')
      const when = line.querySelector('.meta-when')
      if (!who || !when) throw new Error('A name and a time')
      const [date] = drawn(when)
      const mark = line.querySelector('.meta-after')
      const words = mark ? drawn(mark) : []
      return {
        authorLines: lines(who),
        dateTop: date.top - box.top,
        markLines: new Set(words.map((rect) => Math.round(rect.top))).size,
        markBeside: words.length > 0 && Math.abs(words[0].top - date.top) < 2,
      }
    }
    const laidOut = (line: Element, mode: 'none' | 'beside' | 'own') => {
      const copy = line.cloneNode(true) as HTMLElement
      copy.removeAttribute('id')
      Object.assign(copy.style, {
        position: 'absolute',
        visibility: 'hidden',
        width: `${line.getBoundingClientRect().width}px`,
        boxSizing: 'border-box',
        left: '0px',
        top: '0px',
      })
      const mark = copy.querySelector('.meta-after')
      if (mark && mode === 'none') mark.remove()
      else mark?.classList.toggle('own-line', mode === 'own')
      line.parentElement?.append(copy)
      const found = read(copy)
      copy.remove()
      return found
    }
    return [...document.querySelectorAll('.drawer .meta-line')]
      .filter((line) => line.querySelector('.meta-after'))
      .map((line): Placement => {
        const entry = line.closest('.reply, .thread-entry')
        const text = entry?.querySelector('.reply-text, .thread-text')?.textContent ?? ''
        const actual = read(line)
        const without = laidOut(line, 'none')
        const beside = laidOut(line, 'beside')
        return {
          entry: text.trim().slice(0, 32),
          own: !actual.markBeside,
          expected: !(beside.markBeside && beside.authorLines === without.authorLines),
          authorLines: actual.authorLines,
          authorLinesWithout: without.authorLines,
          dateTop: actual.dateTop,
          dateTopWithout: without.dateTop,
          markLines: actual.markLines,
        }
      })
  })

/** The lines that stand off the rule, each with what is wrong. */
const offRule = (found: Placement[]) =>
  found.flatMap((row) => {
    const wrong = [
      row.own !== row.expected && `own line ${row.own}, the rule says ${row.expected}`,
      row.authorLines !== row.authorLinesWithout && 'the author lost a line',
      Math.abs(row.dateTop - row.dateTopWithout) >= 1 && 'the date left its line',
      row.markLines !== 1 && 'the mark broke',
    ].filter(Boolean)
    return wrong.length ? [`${row.entry}: ${wrong.join(', ')}`] : []
  })

/** A reply the person writes in another thread, so the card reads the item again. */
async function readAgain(
  page: Page,
  opened: Awaited<ReturnType<typeof openAsked>>,
  locale: Locale,
) {
  const target = opened.thread('A short note that asks nothing')
  await target.getByRole('button', { name: WORDS[locale].reply, exact: true }).click()
  await page.keyboard.insertText('A write so the card reads again.')
  await target.getByRole('button', { name: WORDS[locale].send, exact: true }).click()
  await expect(target.locator('.reply').filter({ hasText: 'A write so the card' })).toBeVisible()
  await page.mouse.move(0, 0)
  await settle(page)
  await settle(page)
}

const of = (found: Placement[], text: string) => found.find((row) => row.entry.includes(text))

for (const locale of ['ru', 'en'] as const)
  test(`${locale}: an author renamed on a read places the mark again, at the same width`, async ({
    page,
  }) => {
    const opened = await openAsked(page, locale, 1280)
    const before = await placements(page)
    expect(offRule(before), 'before the rename').toEqual([])
    // The head prints the start of a session, so a long author is one with a long name.
    expect(
      of(before, 'Should the digest')?.own,
      'the long author keeps the mark off its line',
    ).toBe(true)
    const comments = opened.backend.item.comments
    const at = (id: number) => comments.find((entry) => entry.id === id)
    // The long author shortened and the short one lengthened: the line keeps its width.
    Object.assign(at(51) ?? {}, { author: SHORT })
    Object.assign(at(38) ?? {}, { author: AGENT })
    await readAgain(page, opened, locale)
    await expect(opened.thread('Should the digest').locator('.meta-who')).toHaveText(SHORT)
    const after = await placements(page)
    expect(offRule(after), 'after the rename').toEqual([])
    // Renamed short, the author has room for the mark beside the date.
    expect(of(after, 'Should the digest')?.own, 'the mark beside the date').toBe(false)
    expect(await opened.pageErrors()).toEqual([])
  })

/** Narrowed to a phone's width and widened back, each step a few frames apart. */
const SWEEP = [
  1400, 1280, 1100, 900, 800, 700, 640, 560, 480, 430, 390, 360, 320, 360, 390, 430, 560, 760, 1000,
  1280,
]

/** Each mark in the drawer as drawn in each of `count` frames: off its date's line, and where. */
const framesOfMarks = (page: Page, count: number) =>
  page.evaluate(
    (frames) =>
      new Promise<{ left: number; own: boolean }[][]>((done) => {
        const seen: { left: number; own: boolean }[][] = []
        const range = document.createRange()
        const first = (node: Element) => {
          range.selectNodeContents(node)
          return [...range.getClientRects()].find((rect) => rect.width > 0)
        }
        const tick = () => {
          seen.push(
            [...document.querySelectorAll('.drawer .meta-line')].flatMap((line) => {
              const mark = line.querySelector('.meta-after')
              const when = line.querySelector('.meta-when')
              const [words, date] = [mark && first(mark), when && first(when)]
              return words && date
                ? [
                    {
                      left: Math.round(words.left * 4) / 4,
                      own: Math.abs(words.top - date.top) >= 2,
                    },
                  ]
                : []
            }),
          )
          if (seen.length < frames) requestAnimationFrame(tick)
          else done(seen)
        }
        requestAnimationFrame(tick)
      }),
    count,
  )

/**
 * The frames in which the marks stood anywhere but at rest where the rule puts them: off the
 * rule's line, or moved along it since an earlier frame.
 */
const unsettled = (frames: { left: number; own: boolean }[][], rule: boolean[], at: string) =>
  frames.flatMap((marks, frame) => {
    const own = marks.map((mark) => mark.own)
    const moved = marks.some((mark, index) => mark.left !== frames[0][index]?.left)
    const drawn = marks.map((mark) => [Number(mark.own), mark.left].join('@')).join(' ')
    return JSON.stringify(own) === JSON.stringify(rule) && !moved
      ? []
      : [`${at}, frame ${frame}: ${drawn}`]
  })

for (const locale of ['ru', 'en'] as const)
  test(`${locale}: at every step of a live resize the mark comes to rest where the rule puts it`, async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const opened = await openAsked(page, locale, 1400)
    const wrong: string[] = []
    for (const [step, width] of SWEEP.entries()) {
      await page.setViewportSize({ width, height: 900 })
      await settle(page)
      await settle(page)
      // At rest: the same place in each of the next eight frames, and the rule's.
      const frames = await framesOfMarks(page, 8)
      const found = await placements(page)
      const rule = found.map((row) => row.expected)
      const at = `${step}@${width}`
      wrong.push(...unsettled(frames, rule, at), ...offRule(found).map((line) => `${at}: ${line}`))
    }
    expect(wrong).toEqual([])
    expect(await opened.pageErrors()).toEqual([])
  })

/** Counts the layout reads made of a line with a mark, or of its parts, from the page's start. */
const countMarkReads = (page: Page) =>
  page.addInitScript(() => {
    const counter = { reads: 0 }
    Object.assign(window, { markReads: counter })
    const proto = Element.prototype
    const read = Object.getOwnPropertyDescriptor(proto, 'getBoundingClientRect')?.value as (
      this: Element,
    ) => DOMRect
    proto.getBoundingClientRect = function (this: Element) {
      if (this.closest('.meta-line')?.querySelector('.meta-after')) counter.reads += 1
      return read.call(this)
    }
  })
const markReads = (page: Page, reset = false) =>
  page.evaluate((zero) => {
    const counter = (window as unknown as { markReads: { reads: number } }).markReads
    const reads = counter.reads
    if (zero) counter.reads = 0
    return reads
  }, reset)

for (const locale of ['ru', 'en'] as const)
  test(`${locale}: typing a reply lays out no mark whose line it leaves alone`, async ({
    page,
  }) => {
    await countMarkReads(page)
    const opened = await openAsked(page, locale, 1280)
    // The thread whose reply carries a mark: its replies render again with the draft.
    const thread = opened.thread('Who owns the importer now?')
    await thread.getByRole('button', { name: WORDS[locale].reply, exact: true }).first().click()
    await settle(page)
    await settle(page)
    expect(
      await markReads(page, true),
      'the marks were placed when the card opened',
    ).toBeGreaterThan(0)
    const typed = 'a reply typed key by key'
    await page.keyboard.type(typed, { delay: 10 })
    await expect(thread.getByRole('textbox')).toHaveValue(typed)
    await settle(page)
    await settle(page)
    expect(await markReads(page), 'layout reads of a marked line while typing').toBe(0)
    expect(offRule(await placements(page)), 'after typing').toEqual([])
    expect(await opened.pageErrors()).toEqual([])
  })
