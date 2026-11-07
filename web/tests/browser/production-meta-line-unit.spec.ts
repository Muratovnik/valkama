/**
 * An agent's name and the start of its session are one unit in an entry's head, read off the
 * built page in both languages from a phone's width to a laptop's: in a thread's roots, its
 * replies, a root still waiting for its reply and a question. The start ends the name's last
 * line; the date shares that line where the pair fits beside it and otherwise takes its own
 * line under the name. Beside the date the pair broke between its halves: at ru 390 in a reply
 * and a question, at ru 430 in a root, and at en 430 and 320 under a long name, the start
 * stood alone under the name.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { launchedSessionId } from './executionFixtures.ts'
import { expectSessionWithName } from './metaLine.ts'
import { asked, openQuestion } from './questionBackend.ts'
import { test } from './test.ts'
import { reply, root, talkedOn } from './threadFixtures.ts'

/** A session the server does not know, written whole as an agent sends it. */
const UNKNOWN = '019a2b3c-4d5e-7f00-8a9b-0c1d2e3f4a5b'
/** One the server knows, whose start is a link. */
const KNOWN = launchedSessionId
/** A long agent name, one hyphen in it, that fits a phone's line alone but not with a date. */
const LONG = 'retrospective-reviewer'

/** The card's talk with a session behind every agent, a long name in a reply, a report and a
 *  root, and a root that still waits for its reply. Beside a root's two icons at 390 and a
 *  report's three at 430 the long name and its start are wider than the head's column, its
 *  last word and the start are not: the line breaks inside the name, and a start held by an
 *  ordinary space broke off under the whole name there. */
function talk() {
  const authors: Record<number, string> = {
    3: `elko (session ${UNKNOWN})`,
    5: `elko (session ${KNOWN})`,
    8: `kolo (session ${UNKNOWN})`,
    9: `${LONG} (session ${UNKNOWN})`,
    10: `${LONG} (session ${KNOWN})`,
  }
  const rows = talkedOn().map((row) =>
    row.id in authors ? { ...row, author: authors[row.id] } : row,
  )
  return [
    ...rows,
    root(11, 'A root with a reply from a session the server knows.', {
      author: `mira (session ${UNKNOWN})`,
    }),
    reply(12, 11, 'A reply under it.', { author: `kolo (session ${KNOWN})` }),
    root(13, 'Does the import keep the order?', {
      author: `kolo (session ${KNOWN})`,
      awaits_reply: true,
      answered: false,
    }),
    root(14, 'A root under a long name.', { author: `${LONG} (session ${KNOWN})` }),
  ]
}

const settle = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  )

async function openHeads(page: Page, locale: 'en' | 'ru', width: number) {
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width, height: 900 })
  const opened = await openQuestion(page, [asked({ author: `kolo (session ${UNKNOWN})` })])
  opened.backend.item.comments.push(...talk())
  await page.reload()
  const { drawer, card } = opened
  const thread = (text: string) => drawer.locator('.thread-entry').filter({ hasText: text })
  await expect(thread('Four replies below').locator('.reply')).toHaveCount(2)
  await expect(thread('Does the import keep').locator('.meta-after')).toBeVisible()
  await expect(card.locator('.request-meta')).toBeVisible()
  await expect(drawer).toHaveCSS('transform', 'none')
  await page.evaluate(() => document.fonts.ready)
  await page.mouse.move(0, 0)
  await settle(page)
  return { card, drawer, thread }
}

/** Where a shot goes when a person asks for shots; a run without the setting takes none. */
async function shot(page: Page, name: string) {
  const folder = process.env.VALKAMA_SHOT_DIR
  if (folder) await page.screenshot({ path: `${folder}/${name}.png` })
}

for (const locale of ['en', 'ru'] as const)
  for (const width of [320, 390, 430, 1280]) {
    const at = `${locale} at ${width}`

    test(`${at}: an agent's session start stands right after its name, the date beside the pair or under it`, async ({
      page,
    }) => {
      const { card, drawer, thread } = await openHeads(page, locale, width)
      const named = [
        ['the question', card.locator('.request-meta')],
        ['a root', thread('Four replies below').locator('.thread-meta')],
        ['a short reply', thread('Four replies below').locator('.reply-meta').first()],
        ['a long reply', thread('Four replies below').locator('.reply-meta').last()],
        ['a root over a person', thread('Should the second report').locator('.thread-meta')],
        ['a known reply', thread('A root with a reply').locator('.reply-meta')],
        ['a waiting root', thread('Does the import keep').locator('.thread-meta')],
      ] as const
      const places: string[] = []
      for (const [name, head] of named) {
        const where = `${at}, ${name}`
        await expect(head.locator('.meta-session'), where).toBeVisible()
        const placed = await expectSessionWithName(head, where)
        // Each of these has the room for its name's last line and the start on one line.
        expect.soft(placed.start, where).toBe('after the name')
        places.push(`${name}: date on ${placed.date}`)
      }
      // Every other head with a session on the card holds the same, whatever its entry; a start
      // under its name only where the head's column is narrower than the two.
      const heads = drawer
        .locator('.meta-line')
        .filter({ has: page.locator('.meta-session'), visible: true })
      expect(await heads.count(), at).toBeGreaterThanOrEqual(named.length)
      for (const head of await heads.all()) {
        const where = `${at}, ${await head.textContent()}`
        await expectSessionWithName(head, where)
      }
      test.info().annotations.push({ type: 'places', description: places.join('; ') })
      await thread('Four replies below').evaluate((node) => node.scrollIntoView({ block: 'start' }))
      await shot(page, `thread-${locale}-${width}`)
      await thread('Does the import keep').evaluate((node) =>
        node.scrollIntoView({ block: 'start' }),
      )
      await shot(page, `waiting-${locale}-${width}`)
      await card.evaluate((node) => node.scrollIntoView({ block: 'start' }))
      await shot(page, `question-${locale}-${width}`)
    })
  }

// A laptop's drawer has room for every pair and its date on one line: the date leaves the line
// only for a pair it does not fit beside.
for (const locale of ['en', 'ru'] as const)
  test(`${locale} at 1280: every date stays on the line of its name and session`, async ({
    page,
  }) => {
    const { drawer } = await openHeads(page, locale, 1280)
    const heads = drawer
      .locator('.meta-line')
      .filter({ has: page.locator('.meta-session'), visible: true })
    expect(await heads.count()).toBeGreaterThanOrEqual(7)
    for (const head of await heads.all()) {
      const where = `${locale} at 1280, ${await head.textContent()}`
      expect(await expectSessionWithName(head, where), where).toEqual({
        date: 'its line',
        start: 'after the name',
      })
    }
  })
