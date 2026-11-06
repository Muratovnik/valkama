/**
 * The sessions that follow an item without holding it, in the built application's card: one
 * line under the holder's, labelled in the holder label's quiet ink, each session printed as
 * the card prints a holder, from the label the server gives it, which is the text a claim of
 * that session records. The line starts on the column the head's other lines start on, a name
 * moves to the next line whole rather than breaking inside itself, one wider than the line wraps
 * between its words and is read whole, and nothing draws a plate or an edge around the words. A card nobody follows, or only its holder, has no such line.
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
const TWO = '019a3c2e-8888-7c11-9e0f-2f4b6d8a1c3e'
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
 * wider than half the drawer's line, a phone's and a laptop's alike: a line holds one of them.
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

/**
 * How a name is drawn, character by character: how many lines it takes, whether every break
 * between them falls at a space, where each line starts, and the widths it would have on one
 * line and its first and widest word, measured by a copy of its words in its own font outside
 * any line.
 */
const nameLayout = (name: Locator) =>
  name.evaluate((node) => {
    const range = document.createRange()
    const chars: { blank: boolean; left: number; right: number; top: number }[] = []
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      const data = text.textContent ?? ''
      for (const [at, char] of [...data].entries()) {
        range.setStart(text, at)
        range.setEnd(text, at + 1)
        const rect = [...range.getClientRects()].find((found) => found.width > 0)
        const blank = char === ' ' || rect === undefined
        chars.push({ blank, left: rect?.left ?? 0, right: rect?.right ?? 0, top: rect?.top ?? 0 })
      }
    }
    let breaksAtSpaces = true
    let previous = -1
    for (const [at, char] of chars.entries()) {
      if (char.blank) continue
      const broke = previous >= 0 && char.top > chars[previous].top + 2
      if (broke && !chars.slice(previous + 1, at).some((between) => between.blank))
        breaksAtSpaces = false
      previous = at
    }
    const drawn = chars.filter((char) => !char.blank)
    const tops = [...new Set(drawn.map((char) => Math.round(char.top)))]
    const words = (node.textContent ?? '').split(' ')
    const probe = document.createElement('span')
    probe.style.cssText = 'position: absolute; visibility: hidden; white-space: pre'
    node.append(probe)
    const width = (text: string) => {
      probe.textContent = text
      return probe.getBoundingClientRect().width
    }
    const measured = {
      oneLine: width(node.textContent ?? ''),
      firstWord: width(words[0]),
      widestWord: Math.max(...words.map((word) => width(word))),
    }
    probe.remove()
    const [first] = drawn
    const last = drawn.at(-1) ?? first
    return {
      ...measured,
      breaksAtSpaces,
      lines: tops.length,
      lineStarts: tops.map((top) =>
        Math.min(...drawn.filter((char) => Math.round(char.top) === top).map((char) => char.left)),
      ),
      right: Math.max(...drawn.map((char) => char.right)),
      firstTop: first.top,
      lastRight: last.right,
      lastTop: last.top,
      cut: node.scrollWidth > node.clientWidth,
    }
  })

/**
 * Every name of the line, each judged against the line it stands in: whole when it fits a line
 * and on more lines only when it does not, broken only between its words while each word fits,
 * every line it starts begun where the label begins, and whether it moved on although its first
 * word had room where the line before it ended, the case a name that broke inside itself shows.
 */
async function namesOf(line: Locator) {
  const room = await box(line)
  const [label] = await drawnLines(line.locator('.card-holder-label'))
  let before = { right: label.right, top: label.top }
  const read = []
  for (const name of await line.locator('.card-subscriber').all()) {
    const drawn = await nameLayout(name)
    const moved = drawn.firstTop > before.top + 2
    const starts = moved ? drawn.lineStarts : drawn.lineStarts.slice(1)
    read.push({
      cut: drawn.cut || drawn.right > room.right + 0.5,
      lines: drawn.oneLine <= room.width ? drawn.lines === 1 : drawn.lines > 1,
      breaks: drawn.widestWord > room.width || drawn.breaksAtSpaces,
      edge: starts.every((start) => Math.abs(start - label.left) <= 0.5),
      forced: moved && room.right - before.right - 8 >= drawn.firstWord,
    })
    before = { right: drawn.lastRight, top: drawn.lastTop }
  }
  return read
}

/**
 * Names of three widths in one list, so that at each width some name finds its first word room
 * at the end of a line and the rest of it none: one that broke inside itself would show there.
 * The Claude Code subagents' names are wider than half the drawer's line, the Codex sessions'
 * a quarter of it, and the Codex subagent's, whose agent id is a whole UUID, wider than a phone.
 */
const MIXED = [
  FIVE[0],
  FIVE[1],
  follower(ONE, ONE_LABEL),
  CODEX_AGENT,
  follower(TWO, `codex (session ${TWO})`),
]

for (const locale of ['ru', 'en'] as const)
  for (const width of [320, 390, 760, 1280]) {
    const at = `${locale} at ${width}`

    test(`${at}: a name that fits a line moves to it whole, a wider one wraps at its words`, async ({
      page,
    }) => {
      const drawer = await openCard(page, locale, width, MIXED)
      const line = drawer.locator('.card-subscribers')
      await expect(line.locator('.card-subscriber')).toHaveCount(5)
      const names = await namesOf(line)
      const every = (key: 'cut' | 'lines' | 'breaks' | 'edge') => names.map((name) => name[key])
      expect(every('cut'), `${at}: nothing given way`).toEqual([false, false, false, false, false])
      expect(every('lines'), `${at}: whole on a line`).toEqual([true, true, true, true, true])
      expect(every('breaks'), `${at}: between words`).toEqual([true, true, true, true, true])
      expect(every('edge'), `${at}: from the label's edge`).toEqual([true, true, true, true, true])
      expect(
        names.some((name) => name.forced),
        `${at}: a name the line had room to start`,
      ).toBe(true)
      await expectNoSilentClipping(page, `${at}: mixed followers`)
    })
  }

for (const width of [390, 320])
  test(`at ${width} a name wider than the line wraps between its words and reads whole`, async ({
    page,
  }) => {
    const drawer = await openCard(page, 'ru', width, [CODEX_AGENT, follower(ONE, ONE_LABEL)])
    const long = drawer.locator('.card-subscriber').first()
    await expect(long).toHaveText(`codex agent ${CODEX_ID} · 019a3c2e-5b7d,`)
    const drawn = await nameLayout(long)
    const room = await box(drawer.locator('.card-subscribers'))
    expect(drawn.oneLine).toBeGreaterThan(room.width)
    expect(drawn.lines).toBeGreaterThan(1)
    expect(drawn.breaksAtSpaces).toBe(true)
    expect(drawn.cut).toBe(false)
    await expect(long).not.toHaveCSS('text-overflow', 'ellipsis')
    // The whole label, the session's full id with it, is still its title, as the holder's is.
    await expect(long).toHaveAttribute('title', CODEX_AGENT.label)
    const short = await nameLayout(drawer.locator('.card-subscriber').last())
    expect(short.lines).toBe(1)
  })
