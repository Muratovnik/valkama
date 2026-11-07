/**
 * The start of an agent's session where a card prints it, read off the built page in both
 * languages: in its talk's heads and in its system events.
 *
 * Under a start the time of an entry takes a line of its own on a phone, and the ring a key put
 * round the start's link crossed the tops of its digits by 2px at 320–430px: the ring stands on
 * the words there, clear of the line under it.
 *
 * The system events printed an author's session whole, 36 characters in the interface font,
 * where every other surface prints its start in the metadata font, the whole id in its tooltip
 * and a link where the server knows the session.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { launchedSessionId } from './executionFixtures.ts'
import { frames } from './frames.ts'
import { openQuestion } from './questionBackend.ts'
import { test } from './test.ts'
import { talkedOn } from './threadFixtures.ts'

type Locale = 'en' | 'ru'

/** A session the server does not know, as an agent writes it. */
const SESSION = '019a2b3c-4d5e-7f00-8a9b-0c1d2e3f4a5b'
/** A session the server knows, which a start links to. */
const KNOWN = launchedSessionId

async function setUp(page: Page, locale: Locale, width: number) {
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width, height: 900 })
}

/** The card's talk, its replies signed from the session the server knows. */
async function openTalk(page: Page, locale: Locale, width: number) {
  await setUp(page, locale, width)
  const opened = await openQuestion(page, [])
  opened.backend.item.comments.push(
    ...talkedOn().map((row) =>
      row.reply_to === null
        ? row
        : { ...row, author: row.author.replace(/\(session [^)]+\)/u, `(session ${KNOWN})`) },
    ),
  )
  await page.reload()
  const heads = opened.drawer
    .locator('.reply-meta')
    .filter({ has: page.locator('.meta-session a') })
  await expect(heads.first()).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await page.mouse.move(0, 0)
  await frames(opened.drawer)
  return heads
}

/**
 * Where a key's ring round the start's link ends below, and where the ink of the time's digits
 * starts, read off the time's own font: the top of its words' box, less what of it lies above
 * its digits' tops.
 */
const ringOverTime = (head: Locator) =>
  head.evaluate((root) => {
    const link = root.querySelector<HTMLElement>('.meta-session a')
    const time = root.querySelector<HTMLElement>('.meta-when')
    if (!link || !time?.firstChild) throw new Error('A linked start and a time')
    link.focus()
    const ring = getComputedStyle(link)
    const box = [...link.getClientRects()].at(-1)
    const range = document.createRange()
    range.selectNodeContents(time.firstChild)
    const words = range.getBoundingClientRect()
    const context = document.createElement('canvas').getContext('2d')
    if (!box || !context) throw new Error('A drawn link')
    context.font = getComputedStyle(time).font
    const drawn = context.measureText(time.textContent ?? '')
    return {
      ringBottom:
        box.bottom + Number.parseFloat(ring.outlineOffset) + Number.parseFloat(ring.outlineWidth),
      ringed: link.matches(':focus-visible'),
      inkTop: words.top + drawn.fontBoundingBoxAscent - drawn.actualBoundingBoxAscent,
      under: words.top >= box.bottom,
    }
  })

for (const locale of ['en', 'ru'] as const)
  for (const width of [320, 390])
    test(`${locale} at ${width}: the ring round a session's start stays off the time under it`, async ({
      page,
    }) => {
      const heads = await openTalk(page, locale, width)
      const drawn = []
      for (const head of await heads.all()) drawn.push(await ringOverTime(head))
      expect(
        drawn.map(({ ringed }) => ringed),
        `${locale} at ${width}: a key's ring`,
      ).not.toContain(false)
      // Each of them on a phone, the time under the start.
      const under = drawn.filter((head) => head.under)
      expect(under.length, `${locale} at ${width}: times under a start`).toBeGreaterThan(0)
      for (const { inkTop, ringBottom } of under)
        expect(ringBottom, `${locale} at ${width}: the ring over the digits`).toBeLessThanOrEqual(
          inkTop,
        )
    })

const EVENTS = { en: 'System events', ru: 'Системные события' } as const

/** A claim an agent's call made, signed with its session. */
const event = (author: string, at: string, session: string) => ({
  action: 'claimed' as const,
  detail: '',
  author,
  at,
  identity: { state: 'confirmed' as const, source: null, session_id: session, agent_id: null },
})

for (const locale of ['en', 'ru'] as const)
  test(`${locale}: a system event prints its author's session as its start, the whole id behind it`, async ({
    page,
  }) => {
    await setUp(page, locale, 1280)
    const opened = await openQuestion(page, [])
    opened.backend.item.events.push(
      event(`kolo (session ${KNOWN})`, '2026-10-24T10:00:00Z', KNOWN),
      event(`elko (session ${SESSION})`, '2026-10-24T09:00:00Z', SESSION),
    )
    await page.reload()
    await opened.drawer.getByRole('tab', { name: EVENTS[locale] }).click()
    const author = (name: string) =>
      opened.drawer.locator('.entry-author').filter({ hasText: name }).locator('.session-start')
    const mono = await page.evaluate(() => {
      const probe = document.body.appendChild(document.createElement('i'))
      probe.style.fontFamily = 'var(--font-family-mono)'
      const family = getComputedStyle(probe).fontFamily
      probe.remove()
      return family
    })
    for (const [name, whole] of [
      ['kolo', KNOWN],
      ['elko', SESSION],
    ] as const) {
      const start = author(name)
      await expect(start).toHaveText(whole.slice(0, 13))
      await expect(start).toHaveAttribute('title', whole)
      await expect(start).toHaveCSS('font-family', mono)
    }
    // A link only to a session the server knows, which says the whole id as well.
    await expect(author('kolo').getByRole('button')).toHaveAttribute(
      'title',
      new RegExp(KNOWN, 'u'),
    )
    await expect(author('elko').locator('a')).toHaveCount(0)
  })
