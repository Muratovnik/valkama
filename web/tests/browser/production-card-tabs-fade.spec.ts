/**
 * A card's sections, on a row narrower than they are: the row fades out at each end where a
 * section is cut and at no other, so a phone, which draws no scrollbar, still says the row
 * goes on. A section picked by the pointer or reached by the keyboard stands with its words
 * clear of the fade, and one that already did is not moved.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { enableExecutionTab } from './executionFixtures.ts'
import { projectScope } from './planningFixtures.ts'
import { test } from './test.ts'

async function openCard(page: Page, width: number, locale: 'en' | 'ru' = 'ru') {
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await enableExecutionTab(page)
  await page.setViewportSize({ width, height: 700 })
  await installBackend(page, { longRead: true })
  await page.goto(serializePlatformRoute({ module_id: 'planning', scope: projectScope }))
  await page.locator('.work-item-column[data-state="dev"] .work-item-tile').first().click()
  const drawer = page.locator('.drawer')
  await expect(drawer).toHaveCSS('transform', 'none')
  const strip = drawer.locator('.inspector-tabs')
  await expect(strip.getByRole('tab')).toHaveCount(5)
  return strip
}

/** The arguments of a function at its outer level: a stop may hold a calc() with commas. */
function outerArguments(inner: string): string[] {
  const parts: string[] = []
  let depth = 0
  let from = 0
  for (let at = 0; at < inner.length; at += 1) {
    if (inner[at] === '(') depth += 1
    else if (inner[at] === ')') depth -= 1
    else if (inner[at] === ',' && depth === 0) {
      parts.push(inner.slice(from, at).trim())
      from = at + 1
    }
  }
  return [...parts, inner.slice(from).trim()]
}

/** A stop that shows nothing of what it masks. */
const clear = (stop: string) => /^(?:transparent|rgba\(0, 0, 0, 0\))/u.test(stop)

/** Which ends of the row a computed `mask-image` fades: the start and the end of the line. */
function endsOf(mask: string) {
  if (mask === 'none') return { mask, start: false, end: false }
  const inner = /^linear-gradient\((.*)\)$/su.exec(mask)?.[1]
  if (!inner) throw new Error(`not a linear mask: ${mask}`)
  const parts = outerArguments(inner)
  const direction = /^to |deg$/u.test(parts[0]) ? parts[0] : 'to bottom'
  if (direction !== 'to left' && direction !== 'to right') throw new Error(`not across: ${mask}`)
  const stops = parts.slice(direction === parts[0] ? 1 : 0)
  const [first, last] = [clear(stops[0]), clear(stops.at(-1) ?? '')]
  const reversed = direction === 'to left'
  return { mask, start: reversed ? last : first, end: reversed ? first : last }
}

const fadedEnds = async (strip: Locator) =>
  endsOf(await strip.evaluate((node) => getComputedStyle(node).maskImage))

/** How far the row can scroll past what it shows. */
const overrun = (strip: Locator) => strip.evaluate((node) => node.scrollWidth - node.clientWidth)

/** How far the strip has scrolled. */
const scrolled = (strip: Locator) => strip.evaluate((node) => node.scrollLeft)

/** The strip once it has stopped moving: the same over two frames. */
async function still(strip: Locator) {
  await expect
    .poll(async () => {
      const first = await scrolled(strip)
      await strip.evaluate(
        () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
      )
      return first === (await scrolled(strip))
    })
    .toBe(true)
  return scrolled(strip)
}

/**
 * Which ends of the row cut a section, the first's box before the start or the last's past
 * the end, by more than the pixel a zoomed page rounds off: what the fade stands for.
 */
const cutEnds = (strip: Locator) =>
  strip.evaluate((node) => {
    const row = node.getBoundingClientRect()
    const sections = [...node.querySelectorAll('button')].map((tab) => tab.getBoundingClientRect())
    const first = sections[0]
    const last = sections.at(-1)
    return {
      start: first !== undefined && row.left - first.left > 1,
      end: last !== undefined && last.right - row.right > 1,
    }
  })

/** The fade at each end matches the cut there. */
async function expectFadeOnCut(strip: Locator, where: string) {
  await expect
    .poll(async () => {
      const { start, end } = await fadedEnds(strip)
      return { start, end }
    }, `${where}: the fade follows the cut`)
    .toEqual(await cutEnds(strip))
}

/** Which faded end the words `tab` draws stand under now, as a Range over them reads them. */
async function wordsUnderFade(strip: Locator, tab: Locator) {
  const { start, end } = await fadedEnds(strip)
  const [fade, row, words] = await Promise.all([
    strip.evaluate((node) =>
      Number.parseFloat(getComputedStyle(node).getPropertyValue('--size-tabs-fade')),
    ),
    strip.evaluate((node) => node.getBoundingClientRect().toJSON() as DOMRect),
    tab.evaluate((node) => {
      const range = document.createRange()
      range.selectNodeContents(node)
      return range.getBoundingClientRect().toJSON() as DOMRect
    }),
  ])
  expect(fade, 'the fade has a width').toBeGreaterThan(0)
  const under: string[] = []
  if (start && words.left < row.left + fade - 0.5) under.push('start')
  if (end && words.right > row.right - fade + 0.5) under.push('end')
  if (words.left < row.left - 0.5) under.push('out before')
  if (words.right > row.right + 0.5) under.push('out after')
  return under
}

test('at 390px the row fades at the end that has more sections, and only there', async ({
  page,
}) => {
  const strip = await openCard(page, 390)
  expect(await overrun(strip), 'five sections overrun a phone').toBeGreaterThan(0)

  await expect.poll(() => fadedEnds(strip)).toMatchObject({ start: false, end: true })

  // Two pixels in, only the row's own inset has left sight: no section is cut before it.
  await strip.evaluate((node) => node.scrollTo({ left: 2 }))
  await still(strip)
  await expectFadeOnCut(strip, 'two pixels in')
  await expect.poll(() => fadedEnds(strip)).toMatchObject({ start: false, end: true })

  await strip.evaluate((node) => node.scrollTo({ left: (node.scrollWidth - node.clientWidth) / 2 }))
  await expect.poll(() => fadedEnds(strip)).toMatchObject({ start: true, end: true })
  await expectFadeOnCut(strip, 'halfway')

  await strip.evaluate((node) => node.scrollTo({ left: node.scrollWidth }))
  await expect.poll(() => fadedEnds(strip)).toMatchObject({ start: true, end: false })
  await expectFadeOnCut(strip, 'at the end')

  await strip.evaluate((node) => node.scrollTo({ left: 0 }))
  await expect.poll(() => fadedEnds(strip)).toMatchObject({ start: false, end: true })
})

test('at 1280px the sections fit and the row draws no mask', async ({ page }) => {
  const strip = await openCard(page, 1280)
  expect(await overrun(strip), 'five sections fit a desktop card').toBeLessThanOrEqual(0)
  await expect.poll(() => fadedEnds(strip)).toMatchObject({ mask: 'none' })
})

/** Where a person presses a section: the middle of what of its drawn words the row shows. */
function pressPoint(strip: Locator, index: number) {
  return strip.evaluate((node, at) => {
    const row = node.getBoundingClientRect()
    const range = document.createRange()
    range.selectNodeContents(node.querySelectorAll('button')[at])
    const words = range.getBoundingClientRect()
    const left = Math.max(words.left, row.left + 2)
    const right = Math.min(words.right, row.right - 2)
    return { x: (left + right) / 2, y: (words.top + words.bottom) / 2, seen: right - left }
  }, index)
}

const frames = (strip: Locator) =>
  strip.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  )

/**
 * A pointer's press on a section, down and up apart, where a person presses it: never
 * `locator.click()`, which scrolls the section into view before it presses. The row holds
 * still between the two, or the press ends on another section, or none, and chooses nothing.
 */
async function press(page: Page, strip: Locator, index: number) {
  const { x, y } = await pressPoint(strip, index)
  const before = await scrolled(strip)
  await page.mouse.move(x, y)
  await page.mouse.down()
  await frames(strip)
  expect(await scrolled(strip), 'the row holds still under a press').toBe(before)
  await page.mouse.up()
}

/** A section chosen to set a scene, by no hand the check reads. */
const choose = (tab: Locator) => tab.evaluate((node) => (node as HTMLElement).click())

/**
 * Pick each section in turn, along the row and back, and read what the pick did: a section
 * whose words were in sight and clear of the fade is not moved, and every section picked
 * ends in sight, clear of the fade, with the fade at the ends that cut a section.
 */
async function pickEach(strip: Locator, pick: (index: number) => Promise<void>) {
  const tabs = strip.getByRole('tab')
  const count = await tabs.count()
  const along = Array.from({ length: count }, (_, at) => at)
  for (const index of [...along, ...along.toReversed().slice(1)]) {
    const tab = tabs.nth(index)
    const words = await tab.textContent()
    const name = words?.trim() ?? String(index)
    const before = await still(strip)
    const underBefore = await wordsUnderFade(strip, tab)
    const clearBefore = underBefore.length === 0
    await pick(index)
    await expect(tab).toHaveAttribute('aria-selected', 'true')
    const after = await still(strip)
    // Short of the browser's own clamp: the section left behind gives up its heavier weight,
    // and a row a pixel shorter cannot stand scrolled past its new end.
    const end = await overrun(strip)
    if (clearBefore)
      expect(after, `${name}, clear of the fade, is not moved`).toBe(Math.min(before, end))
    expect(await wordsUnderFade(strip, tab), `${name} once picked`).toEqual([])
    await expectFadeOnCut(strip, `${name} once picked`)
  }
}

/**
 * Each section between the ends that the row can place so, its words just clear of the
 * start's fade and the padding round them under it, with the one chosen before it standing
 * after it, so that nothing it is drawn with moves its words: reached, it stays where it is.
 * A row that keeps a section's box clear of the fade, not its words, moves it by that padding.
 */
async function pickJustClear(strip: Locator, reach: (index: number) => Promise<void>) {
  const tabs = strip.getByRole('tab')
  let placed = 0
  for (const index of [1, 2, 3]) {
    await choose(tabs.nth(index + 1))
    await tabs.nth(index + 1).focus()
    const reachable = await strip.evaluate((node, at) => {
      const fade = Number.parseFloat(getComputedStyle(node).getPropertyValue('--size-tabs-fade'))
      const range = document.createRange()
      range.selectNodeContents(node.querySelectorAll('button')[at])
      const words = range.getBoundingClientRect()
      const left = node.scrollLeft + words.left - (node.getBoundingClientRect().left + fade + 2)
      if (left > node.scrollWidth - node.clientWidth) return false
      node.scrollLeft = left
      return true
    }, index)
    if (!reachable) continue
    placed += 1
    const before = await still(strip)
    const tab = tabs.nth(index)
    expect(await wordsUnderFade(strip, tab), 'placed with its words clear').toEqual([])
    const boxUnder = await strip.evaluate((node, at) => {
      const fade = Number.parseFloat(getComputedStyle(node).getPropertyValue('--size-tabs-fade'))
      const box = node.querySelectorAll('button')[at].getBoundingClientRect()
      return box.left < node.getBoundingClientRect().left + fade - 4
    }, index)
    expect(boxUnder, 'placed with its padding under the fade').toBe(true)
    await reach(index)
    await expect(tab).toHaveAttribute('aria-selected', 'true')
    expect(await still(strip), `section ${index}, clear of the fade, is not moved`).toBe(before)
  }
  expect(placed, 'a section the row could place just clear').toBeGreaterThan(0)
}

/**
 * The row at either end, each section with its words in sight pressed: those the fade cuts
 * at the far end as well as the first and the last. A pointer presses down and up apart, a
 * finger taps; each chooses the section it lands on. Says which it pressed, and which of
 * them the fade cut.
 */
async function pressEach(page: Page, strip: Locator, touch: boolean) {
  const pressed: string[] = []
  for (const end of ['start', 'end'] as const)
    for (let index = 0; index < 5; index += 1) {
      const name = await pressAtEnd(page, strip, { end, index, touch })
      if (name) pressed.push(name)
    }
  return pressed
}

/** One section pressed with the row at one end, another chosen before; null with none in sight. */
async function pressAtEnd(
  page: Page,
  strip: Locator,
  { end, index, touch }: { end: 'end' | 'start'; index: number; touch: boolean },
) {
  const tab = strip.getByRole('tab').nth(index)
  await choose(strip.getByRole('tab').nth(index === 2 ? 0 : 2))
  await strip.evaluate((node, left) => node.scrollTo({ left }), end === 'end' ? 1e6 : 0)
  await still(strip)
  const { x, y, seen } = await pressPoint(strip, index)
  if (seen < 6) return null
  const under = await wordsUnderFade(strip, tab)
  if (touch) await page.touchscreen.tap(x, y)
  else await press(page, strip, index)
  await expect(tab, `${end}: section ${index}`).toHaveAttribute('aria-selected', 'true')
  return `${end}:${index}${under.length ? ' under the fade' : ''}`
}

for (const locale of ['ru', 'en'] as const) {
  test(`a section pressed at 390px in ${locale} is chosen, stands clear of the fade and moves only when it did not`, async ({
    page,
  }) => {
    const strip = await openCard(page, 390, locale)
    await expect(strip.getByRole('tab')).toHaveCount(5)
    await pickEach(strip, (index) => press(page, strip, index))
    await pickJustClear(strip, (index) => press(page, strip, index))
  })

  test(`a section the keyboard reaches at 390px in ${locale} stands clear of the fade and moves only when it did not`, async ({
    page,
  }) => {
    const strip = await openCard(page, 390, locale)
    const tabs = strip.getByRole('tab')
    await tabs.first().focus()
    await expect(tabs.first()).toBeFocused()
    let at = 0
    await pickEach(strip, async (index) => {
      if (index === at) return
      await page.keyboard.press(index > at ? 'ArrowRight' : 'ArrowLeft')
      await expect(tabs.nth(index)).toBeFocused()
      at = index
    })
    await pickJustClear(strip, async (index) => {
      await page.keyboard.press('ArrowLeft')
      await expect(tabs.nth(index)).toBeFocused()
    })
    // Tabbed back into with the section shown scrolled away, the row brings it in.
    await page.keyboard.press('End')
    await expect(tabs.last()).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(tabs.last()).not.toBeFocused()
    await strip.evaluate((node) => node.scrollTo({ left: 0 }))
    await still(strip)
    expect(await wordsUnderFade(strip, tabs.last()), 'scrolled away').not.toEqual([])
    await page.keyboard.press('Shift+Tab')
    await expect(tabs.last()).toBeFocused()
    await still(strip)
    expect(await wordsUnderFade(strip, tabs.last()), 'tabbed back into').toEqual([])
  })

  for (const touch of [false, true])
    test.describe(`under a ${touch ? 'finger' : 'mouse'}`, () => {
      test.use({ hasTouch: touch })

      test(`at 390px in ${locale} a ${touch ? 'tap' : 'press'} on a section the fade cuts chooses it`, async ({
        page,
      }) => {
        const strip = await openCard(page, 390, locale)
        const pressed = await pressEach(page, strip, touch)
        expect(pressed).toEqual(expect.arrayContaining(['start:0', 'end:4']))
        expect(pressed.filter((name) => name.endsWith('under the fade')).length).toBeGreaterThan(1)
      })
    })
}
