/**
 * The list's own find, in the built application. A list of a thousand rows
 * draws only its window, so the browser's find reached the rows drawn; Ctrl+F
 * on the list opens the list's find instead, which counts a term in the words
 * of every row and walks its matches in the list's order, each brought under
 * the sticky head and marked, the current one apart.
 *
 * The count holds through the walk and follows the stream; the current match
 * stays on its row while the list changes; Escape closes the bar and gives focus
 * back. Over a card, and on the board, Ctrl+F stays the browser's. On a list
 * short enough to draw every row, at each of its widths and in Russian, what
 * the find counts is what the rows show: every match it counts is marked, in
 * words a reader sees.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { installBackend } from './backend.ts'
import { openBoard, openList, serve } from './boardPage.ts'
import { picture } from './graphPixels.ts'
import { brief, serveSpace, stateOf, stillFrames } from './longSpace.ts'
import { installStreamDouble } from './streamDouble.ts'
import { test } from './test.ts'

const START = Date.UTC(2026, 9, 1, 12)

/** Row `index` of a list sorted by Updated, newest first, stands at `index`. */
const row = (index: number, extra: object = {}) =>
  brief(1000 + index, stateOf(index), {
    updated_at: new Date(START - index * 3_600_000).toISOString(),
    ...extra,
  })
const reference = (index: number) => `MAIN-${1000 + index}`

/** A thousand rows, «quartz» in four far down the list and twice in one of them. */
const QUARTZ: Record<number, string> = {
  120: 'Quartz sample to look for',
  400: 'Quartz sample, and quartz again',
  650: 'Quartz sample in the middle',
  980: 'Quartz sample near the end',
}
const thousand = () =>
  Array.from({ length: 1000 }, (_, index) =>
    row(index, QUARTZ[index] ? { title: QUARTZ[index] } : {}),
  )
/** The matches of «quartz» in the list's order: row by row, and in a row as it reads. */
const WALK = [120, 400, 400, 650, 980]

const listOf = (page: Page) => page.locator('.work-item-list')
const barOf = (page: Page) => page.getByRole('search', { name: 'Find in the list' })
const fieldOf = (page: Page) => barOf(page).getByRole('textbox', { name: 'Find' })
const countOf = (page: Page) => barOf(page).locator('.list-find-now')

/** Hears whether the page took Ctrl+F from the browser, after the list has. */
const hearFind = (page: Page) =>
  page.evaluate(() => {
    globalThis.addEventListener('keydown', (event) => {
      if (event.code === 'KeyF') Object.assign(globalThis, { findTaken: event.defaultPrevented })
    })
  })
const findTaken = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as { findTaken?: boolean }).findTaken)

interface Box {
  bottom: number
  left: number
  right: number
  top: number
}
interface Mark {
  box: Box
  reference: string | undefined
  text: string
}

/** The marks the page registered, the current one apart, with the row each is drawn in. */
const marksOf = (page: Page) =>
  page.evaluate(() => {
    const [current, others] = ['list-find-current', 'list-find'].map((name) =>
      [...(CSS.highlights.get(name) ?? [])].map((range) => {
        const { bottom, left, right, top } = (range as Range).getBoundingClientRect()
        const element = range.startContainer.parentElement
        return {
          box: { bottom, left, right, top },
          reference: element?.closest('tr')?.querySelector<HTMLElement>('.list-open')?.dataset
            .reference,
          text: (range as Range).toString(),
        }
      }),
    )
    return { current: current ?? [], others: others ?? [] }
  })

/** The room the rows scroll in: under the sticky head, inside the list's edges. */
const roomOf = (page: Page) =>
  listOf(page).evaluate((list): Box => {
    const frame = list.getBoundingClientRect()
    const head = list.querySelector('th.list-head')?.getBoundingClientRect().bottom ?? frame.top
    const left = frame.left + list.clientLeft
    return {
      bottom: frame.top + list.clientTop + list.clientHeight,
      left,
      right: left + list.clientWidth,
      top: head,
    }
  })

const overlaps = (one: Box, other: Box) =>
  one.top < other.bottom &&
  one.bottom > other.top &&
  one.left < other.right &&
  one.right > other.left

/** How much of a box is the current match's yellow, read off the screen. */
async function yellowIn(page: Page, box: Box) {
  const area = {
    bottom: Math.floor(box.bottom),
    left: Math.ceil(box.left),
    right: Math.floor(box.right),
    top: Math.ceil(box.top),
  }
  const source = await picture(page, area)
  return page.evaluate(async (png) => {
    const image = new Image()
    image.src = `data:image/png;base64,${png}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d') as CanvasRenderingContext2D
    context.drawImage(image, 0, 0)
    const { data } = context.getImageData(0, 0, image.width, image.height)
    const probe = document.createElement('span')
    probe.style.color = 'var(--color-find-current)'
    document.body.append(probe)
    const [r, g, b] = (getComputedStyle(probe).color.match(/\d+/gu) ?? []).map(Number)
    probe.remove()
    let near = 0
    for (let at = 0; at < data.length; at += 4) {
      const off =
        Math.abs((data[at] ?? 0) - r) +
        Math.abs((data[at + 1] ?? 0) - g) +
        Math.abs((data[at + 2] ?? 0) - b)
      if (off < 24) near += 1
    }
    return near / (data.length / 4)
  }, source)
}

/** The current match: one, in its row, whole in the room clear of the bar, and painted. */
async function expectCurrentIn(page: Page, index: number, centred: boolean) {
  const { current } = await marksOf(page)
  expect(current, `the current match in ${reference(index)}`).toHaveLength(1)
  const [mark] = current as [Mark]
  expect(mark.reference).toBe(reference(index))
  expect(mark.text.toLowerCase()).toBe('quartz')
  const room = await roomOf(page)
  const bar = await barOf(page).boundingBox()
  expect(mark.box.top, 'under the sticky head').toBeGreaterThanOrEqual(room.top)
  expect(mark.box.bottom, 'above the list’s bottom edge').toBeLessThanOrEqual(room.bottom)
  if (bar) {
    const covered = {
      bottom: bar.y + bar.height,
      left: bar.x,
      right: bar.x + bar.width,
      top: bar.y,
    }
    expect(overlaps(mark.box, covered), 'clear of the find bar').toBe(false)
  }
  if (centred) {
    // Brought to the middle of the room, not to an edge of it.
    const middle = (mark.box.top + mark.box.bottom) / 2
    const share = (middle - room.top) / (room.bottom - room.top)
    expect(share).toBeGreaterThan(0.25)
    expect(share).toBeLessThan(0.75)
  }
  expect(await yellowIn(page, mark.box), 'the current match painted').toBeGreaterThan(0.3)
}

async function openThousand(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  const stream = await installStreamDouble(page)
  await serveSpace(page, thousand())
  const read = page.waitForResponse((response) => response.url().includes('/api/planning?'))
  await openList(page)
  const answered = await read
  const model = JSON.parse(await answered.text()) as { work_items: { title: string }[] }
  await stillFrames(page)
  await hearFind(page)
  return { model, stream }
}

test('Ctrl+F counts a term outside the window and walks it in the list’s order', async ({
  page,
}) => {
  await openThousand(page)
  const list = listOf(page)
  // The window holds none of the rows the term is in.
  await expect(list.locator('tbody tr.list-row').first()).toBeVisible()
  expect(await list.locator('tbody').textContent()).not.toMatch(/quartz/iu)
  const first = list.locator(`tbody .list-open[data-reference="${reference(0)}"]`)
  await first.focus()

  await page.keyboard.press('Control+f')
  expect(await findTaken(page)).toBe(true)
  await expect(barOf(page)).toBeVisible()
  await expect(fieldOf(page)).toBeFocused()

  // Every value the count takes, through the typing, the walk and every scroll.
  await countOf(page).evaluate((count) => {
    const seen: string[] = []
    Object.assign(globalThis, { countsSeen: seen })
    new MutationObserver(() => seen.push(count.textContent?.trim() ?? '')).observe(count, {
      characterData: true,
      childList: true,
      subtree: true,
    })
  })
  await fieldOf(page).fill('QUARTZ')
  await expect(countOf(page)).toHaveText(`1 of ${WALK.length}`)
  await stillFrames(page)
  await expectCurrentIn(page, WALK[0], true)
  const barBox = await barOf(page).boundingBox()

  for (const [step, index] of [...WALK.entries()].slice(1)) {
    await page.keyboard.press('Enter')
    await expect(countOf(page)).toHaveText(`${step + 1} of ${WALK.length}`)
    await stillFrames(page)
    // A second match in a row already in sight leaves the list where it is.
    await expectCurrentIn(page, index, index !== WALK[step - 1])
    await expect(fieldOf(page)).toBeFocused()
    expect(await barOf(page).boundingBox(), 'the bar holds still').toEqual(barBox)
  }
  // Round past the end to the first, and back past the start to the last.
  await page.keyboard.press('Enter')
  await expect(countOf(page)).toHaveText(`1 of ${WALK.length}`)
  await stillFrames(page)
  await expectCurrentIn(page, WALK[0], true)
  await page.keyboard.press('Shift+Enter')
  await expect(countOf(page)).toHaveText(`${WALK.length} of ${WALK.length}`)
  await stillFrames(page)
  await expectCurrentIn(page, WALK.at(-1) ?? 0, true)

  const seen = await page.evaluate(
    () => (globalThis as unknown as { countsSeen: string[] }).countsSeen,
  )
  expect(seen.filter((text) => text && !text.endsWith(` of ${WALK.length}`))).toEqual([])

  await page.keyboard.press('Escape')
  await expect(barOf(page)).toHaveCount(0)
  await expect(first).toBeFocused()
  expect(await page.evaluate(() => CSS.highlights.size)).toBe(0)
})

test('the current match stays on its row as the stream changes the list', async ({ page }) => {
  const { model, stream } = await openThousand(page)
  await page.keyboard.press('Control+f')
  await fieldOf(page).fill('quartz')
  await expect(countOf(page)).toHaveText('1 of 5')
  for (let step = 1; step < 4; step += 1) await page.keyboard.press('Enter')
  await expect(countOf(page)).toHaveText('4 of 5')
  await stillFrames(page)
  await expectCurrentIn(page, 650, true)
  const before = {
    bar: await barOf(page).boundingBox(),
    scroll: await listOf(page).evaluate((list) => list.scrollTop),
  }

  // The first row the term was in no longer holds it.
  const changed = structuredClone(model)
  changed.work_items[120] = { ...changed.work_items[120], title: 'Sample to look for' }
  await stream.deliver(JSON.stringify(changed))
  await expect(countOf(page)).toHaveText('3 of 4')
  await stillFrames(page)
  await expectCurrentIn(page, 650, true)
  await expect(fieldOf(page)).toBeFocused()
  expect(await barOf(page).boundingBox()).toEqual(before.bar)
  expect(await listOf(page).evaluate((list) => list.scrollTop)).toBe(before.scroll)
})

test('Ctrl+F stays the browser’s over an open card and on the board', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 })
  await installBackend(page)
  await serve(page)
  await openList(page)
  await hearFind(page)
  await page.locator('.work-item-list tbody .list-open').first().click()
  await expect(page.locator('.drawer')).toHaveCount(1)
  await page.keyboard.press('Control+f')
  expect(await findTaken(page)).toBe(false)
  await expect(barOf(page)).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.locator('.drawer')).toHaveCount(0)
  // With the card gone the list's again.
  await page.keyboard.press('Control+f')
  expect(await findTaken(page)).toBe(true)
  await expect(barOf(page)).toBeVisible()

  await openBoard(page)
  await hearFind(page)
  await page.keyboard.press('Control+f')
  expect(await findTaken(page)).toBe(false)
})

/** A list short enough to draw every row: «quartz» in three, every seventh row urgent. */
const short = () =>
  Array.from({ length: 120 }, (_, index) =>
    row(index, {
      ...(index % 7 === 3 ? { priority: 'high' } : {}),
      ...([5, 60, 110].includes(index) ? { title: `Quartz sample ${index}` } : {}),
    }),
  )

/** The matches a reader sees: a term in the text the rows draw where it has room to show. */
const shownCount = (page: Page, term: string) =>
  listOf(page).evaluate((list, wanted) => {
    let count = 0
    const walker = document.createTreeWalker(
      list.querySelector('tbody') as Node,
      NodeFilter.SHOW_TEXT,
    )
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement
      if (!parent?.checkVisibility({ visibilityProperty: true })) continue
      // Words kept for assistive technology alone stand in a box a pixel wide, which
      // clips them; a box that draws none of its own is its parent's.
      let box: Element | null = parent
      while (box && getComputedStyle(box).display === 'contents') box = box.parentElement
      const drawn = box?.getBoundingClientRect()
      if (!drawn || drawn.width <= 1 || drawn.height <= 1) continue
      const text = (node.textContent ?? '').toLowerCase()
      for (let at = text.indexOf(wanted); at >= 0; at = text.indexOf(wanted, at + wanted.length))
        count += 1
    }
    return count
  }, term.toLowerCase())

/**
 * The words of two rows, an urgent one among them, text by text as they are drawn,
 * the words kept for assistive technology alone included: what a reader would type,
 * and what a reader cannot see and should not find.
 */
const wordsOf = (page: Page) =>
  listOf(page).evaluate((list) => {
    const words = new Set<string>()
    for (const reference of ['MAIN-1000', 'MAIN-1003']) {
      const row = list.querySelector(`.list-open[data-reference="${reference}"]`)?.closest('tr')
      const walker = document.createTreeWalker(row as Node, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode())
        for (const word of node.textContent?.match(/\p{L}{3,}|\d+/gu) ?? []) words.add(word)
    }
    return [...words]
  })

/** What the count says for `expected` matches: «n of m», whatever n is, or the words for none. */
const totalOf = (expected: number, none: string) =>
  expected ? new RegExp(`\\s${expected}$`, 'u') : none

async function openShort(page: Page, locale: string, width: number) {
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  await page.setViewportSize({ width, height: 900 })
  await installBackend(page)
  await serveSpace(page, short())
  await openList(page)
  await stillFrames(page)
  await page.locator('.work-item-list tbody .list-open').first().focus()
  await page.keyboard.press('Control+f')
  const bar = page.getByRole('search')
  await expect(bar).toBeVisible()
  return { count: bar.locator('.list-find-now'), field: bar.getByRole('textbox') }
}

for (const { fit, locale, none, width } of [
  { fit: 'wide', locale: 'en', none: 'No matches', width: 1440 },
  { fit: 'medium', locale: 'en', none: 'No matches', width: 1000 },
  { fit: 'narrow', locale: 'en', none: 'No matches', width: 390 },
  { fit: 'wide', locale: 'ru', none: 'Нет совпадений', width: 1440 },
] as const) {
  test(`on a ${fit} list in ${locale} the find counts what the rows show`, async ({ page }) => {
    const { count, field } = await openShort(page, locale, width)
    await expect(listOf(page)).toHaveAttribute('data-fit', fit)
    // Every row's words, and the priority's, where a glyph stands for it.
    const terms = [...(await wordsOf(page)), 'high', 'medium']
    const counted: number[] = []
    for (const term of terms) {
      await field.fill(term)
      const expected = await shownCount(page, term)
      counted.push(expected)
      await expect(count, `«${term}»`).toHaveText(totalOf(expected, none))
      const { current, others } = await marksOf(page)
      const marks = [...current, ...others]
      expect(marks, `«${term}» marked`).toHaveLength(expected)
      for (const mark of marks) expect(mark.text.toLowerCase()).toBe(term.toLowerCase())
    }
    // The rows' words were many, and most of them were found.
    expect(counted.filter(Boolean).length).toBeGreaterThanOrEqual(6)
  })
}

test('a match far down a list drawn whole is brought to the middle of the room', async ({
  page,
}) => {
  const { count, field } = await openShort(page, 'en', 1440)
  await field.fill('quartz')
  await expect(count).toHaveText('1 of 3')
  await page.keyboard.press('Enter')
  await expect(count).toHaveText('2 of 3')
  await stillFrames(page)
  await expectCurrentIn(page, 60, true)
})
