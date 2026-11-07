/**
 * The forms under a thread, read off the built page in both languages at a laptop's width and a
 * phone's: the mark that goes with a reply answers a press across its whole line, at least the
 * 24px DESIGN.md sets as every target's floor, and the asking before written words are dropped
 * stands on the column's edge with its buttons at its end, in a reply and in the mark's form.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { expectStripOnColumn } from './confirmStrip.ts'
import { openCard } from './editorPage.ts'
import { launchedSessionId } from './executionFixtures.ts'
import { frames } from './frames.ts'
import { sessionHead } from './metaLine.ts'
import { asked, openQuestion } from './questionBackend.ts'
import { test } from './test.ts'
import { talkedOn } from './threadFixtures.ts'

const WORDS = {
  en: { mark: 'Mark the thread resolved', reply: 'Reply', resolve: 'Resolve' },
  ru: { mark: 'Отметить ветку разобранной', reply: 'Ответить', resolve: 'Разобрано' },
} as const
type Locale = keyof typeof WORDS
const FLOOR = 24

/** An agent's session as Claude and Codex write it: a UUID of 36 characters. */
const SESSION = '019a2b3c-4d5e-7f00-8a9b-0c1d2e3f4a5b'
/** What every surface prints of a session: its first two groups. */
const START = '019a2b3c-4d5e'
/** A session the server knows, which a head links to. */
const KNOWN = launchedSessionId
const KNOWN_START = '11111111-2222'
/** A link to the session drawn as the words it acts on, whose tooltip holds the whole id. */
const LINKED = { role: 'button', title: expect.stringContaining(KNOWN) }

/** Where a shot goes when a person asks for shots; a run without the setting takes none. */
async function shot(page: Page, name: string) {
  const folder = process.env.VALKAMA_SHOT_DIR
  if (folder) await page.screenshot({ path: `${folder}/${name}.png` })
}

async function setUp(page: Page, locale: Locale, width: number) {
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width, height: 900 })
}

/**
 * The card's talk with each agent's session written whole, as an agent sends it: a root's one
 * the server does not know, a reply's one it does.
 */
function talkedWith() {
  return talkedOn().map((row) => ({
    ...row,
    author: row.author.replace(
      /\(session [^)]+\)/u,
      `(session ${row.reply_to === null ? SESSION : KNOWN})`,
    ),
  }))
}

async function openThread(page: Page, locale: Locale, width: number) {
  await setUp(page, locale, width)
  const opened = await openCard(page)
  opened.backend.item.comments.push(...talkedOn())
  await page.reload()
  const thread = opened.drawer
    .locator('.thread-entry')
    .filter({ hasText: 'Should the second report' })
  await expect(thread).toBeVisible()
  await expect(opened.drawer).toHaveCSS('transform', 'none')
  return { ...opened, thread }
}

/** The box itself and the line that takes its press, as drawn, and what a press lands on at
 *  each inside edge of that line. */
const markTarget = (box: Locator) =>
  box.evaluate((input) => {
    const line = input.closest('label')
    if (!line) throw new Error('The box has no label around it')
    const own = input.getBoundingClientRect()
    const target = line.getBoundingClientRect()
    const inside = (x: number, y: number) => {
      const hit = document.elementFromPoint(x, y)
      return hit !== null && line.contains(hit)
    }
    const middle = { x: target.left + target.width / 2, y: target.top + target.height / 2 }
    return {
      box: { height: own.height, width: own.width },
      edges: [
        inside(target.left + 1, middle.y),
        inside(target.right - 1, middle.y),
        inside(middle.x, target.top + 1),
        inside(middle.x, target.bottom - 1),
      ],
      target: { height: target.height, width: target.width },
    }
  })

/** The middle of the label's words, by a Range over them, where a person presses. */
const wordsMiddle = (box: Locator) =>
  box.evaluate((input) => {
    const line = input.closest('label')
    const walker = line && document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
    let text = walker?.nextNode()
    while (text && !text.textContent?.trim()) text = walker?.nextNode()
    if (!text) throw new Error('The label has no words')
    const range = document.createRange()
    range.selectNodeContents(text)
    const { left, top, width, height } = range.getBoundingClientRect()
    return { x: left + width / 2, y: top + height / 2 }
  })

for (const locale of ['en', 'ru'] as const)
  for (const width of [1280, 390]) {
    const at = `${locale} at ${width}`

    test(`${at}: the mark with a reply answers a press across a line of at least ${FLOOR}px`, async ({
      page,
    }) => {
      const { thread } = await openThread(page, locale, width)
      await thread.getByRole('button', { name: WORDS[locale].reply, exact: true }).first().click()
      const box = thread.getByRole('checkbox', { name: WORDS[locale].mark })
      await expect(box).toBeVisible()
      // In the middle of the view, where a person brings it before pressing.
      await box.evaluate((node) => node.scrollIntoView({ behavior: 'instant', block: 'center' }))
      const drawn = await markTarget(box)
      // The box alone is drawn smaller than the floor, so the line around it is the target.
      expect(drawn.box.height).toBeLessThan(FLOOR)
      expect(drawn.target.height, `${at}: the line's height`).toBeGreaterThanOrEqual(FLOOR)
      expect(drawn.target.width, `${at}: the line's width`).toBeGreaterThanOrEqual(FLOOR)
      expect(drawn.edges, `${at}: each edge of the line takes the press`).toEqual([
        true,
        true,
        true,
        true,
      ])
      // And a press on the words ticks the box, which is what makes the line its target.
      const middle = await wordsMiddle(box)
      await page.mouse.click(middle.x, middle.y)
      await expect(box).toBeChecked()
    })

    test(`${at}: the asking before a reply is dropped stands on the column, its buttons at its end`, async ({
      page,
    }) => {
      const { thread } = await openThread(page, locale, width)
      await thread.getByRole('button', { name: WORDS[locale].reply, exact: true }).first().click()
      await page.keyboard.insertText('Words to keep')
      await page.keyboard.press('Escape')
      const form = thread.locator('form.reply-composer')
      await expect(form.locator('.confirm-strip')).toBeVisible()
      await expectStripOnColumn(form.locator('.confirm-strip'), form, `${at} reply`)
    })

    test(`${at}: the asking before a decision is dropped stands on the column, its buttons at its end`, async ({
      page,
    }) => {
      const { thread } = await openThread(page, locale, width)
      await thread.getByRole('button', { name: WORDS[locale].resolve, exact: true }).click()
      await page.keyboard.insertText('A decision')
      await page.keyboard.press('Escape')
      const form = thread.locator('form.resolve-form')
      await expect(form.locator('.confirm-strip')).toBeVisible()
      await expectStripOnColumn(form.locator('.confirm-strip'), form, `${at} decision`)
    })
  }

/**
 * The card's talk, a question over it and the heads to read: a thread's root, its two replies
 * shown and the question, each from an agent, and a person's reply, which names no session.
 */
async function openHeads(page: Page, locale: Locale, width: number) {
  await setUp(page, locale, width)
  const opened = await openQuestion(page, [asked({ author: `kolo (session ${SESSION})` })])
  opened.backend.item.comments.push(...talkedWith())
  await page.reload()
  const { drawer, card } = opened
  const thread = drawer.locator('.thread-entry').filter({ hasText: 'Four replies below' })
  const person = drawer.locator('.thread-entry').filter({ hasText: 'Should the second report' })
  await expect(thread.locator('.reply')).toHaveCount(2)
  await expect(card.locator('.request-meta')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await thread.evaluate((node) => node.scrollIntoView({ block: 'start' }))
  await page.mouse.move(0, 0)
  await frames(page.locator(':root'))
  const replies = await thread.locator('.reply-meta').all()
  return {
    card,
    thread,
    heads: [
      { head: thread.locator('.thread-meta'), whole: SESSION, start: START, link: null },
      ...replies.map((head) => ({ head, whole: KNOWN, start: KNOWN_START, link: LINKED })),
      { head: card.locator('.request-meta'), whole: SESSION, start: START, link: null },
    ],
    person: person.locator('.reply-meta'),
  }
}

for (const locale of ['en', 'ru'] as const)
  for (const width of [1280, 390, 320]) {
    const at = `${locale} at ${width}`

    // A whole id is 36 characters, 274px in the metadata font, and a head's column on a phone is
    // 147–265px: it broke inside itself on two lines of its own under the name. Every surface
    // prints the start of a session, the whole of it in a tooltip, and a link where the server
    // knows the session, as an id in prose is.
    test(`${at}: an entry's head prints the start of its session whole on one line, the whole id behind it`, async ({
      page,
    }) => {
      const { card, heads, thread } = await openHeads(page, locale, width)
      const mono = await page.evaluate(() => {
        const probe = document.body.appendChild(document.createElement('i'))
        probe.style.fontFamily = 'var(--font-family-mono)'
        const family = getComputedStyle(probe).fontFamily
        probe.remove()
        return family
      })
      await shot(page, `session-head-${locale}-${width}`)
      expect(heads).toHaveLength(4)
      for (const { head, whole, start, link } of heads) {
        const drawn = await sessionHead(head)
        const label = `${at}: ${await head.textContent()}`
        expect(drawn.overflow, `${label}: past the head`).toBeLessThanOrEqual(0)
        expect(drawn.drawn, label).toBe(start)
        expect(drawn.lines, `${label}: the start's lines`).toBe(1)
        expect(drawn.inside, `${label}: inside the head`).toBe(true)
        expect(drawn.font, label).toBe(mono)
        expect(drawn.title, `${label}: the tooltip`).toBe(whole)
        // A link only to a session the server knows, which says the whole id as well.
        expect(drawn.link, `${label}: the link to the session`).toEqual(link)
      }
      await card.evaluate((node) => node.scrollIntoView({ block: 'start' }))
      await page.mouse.move(0, 0)
      await shot(page, `session-question-${locale}-${width}`)
      // The start reached under a finger opens the session, which says its whole id.
      await thread.locator('.reply-meta').first().getByRole('button', { name: KNOWN_START }).click()
      await expect(page.getByRole('dialog').filter({ hasText: KNOWN })).toBeVisible()
    })

    // The id is set in the metadata font, whose ascent the browser rounds to 12px at 13px
    // against the interface font's 13: a line holding it stood 17.9px against 16.9px.
    test(`${at}: a head's line with a session stands as tall as one without`, async ({ page }) => {
      const { heads, person } = await openHeads(page, locale, width)
      const without = await sessionHead(person.first())
      expect(without.drawn, 'a person names no session').toBe('')
      for (const { head } of heads) {
        const drawn = await sessionHead(head)
        expect(
          Math.abs(drawn.lineHeight - without.lineHeight),
          `${at}: ${await head.textContent()}: ${drawn.lineHeight}px against ${without.lineHeight}px`,
        ).toBeLessThanOrEqual(0.1)
      }
    })
  }
