/**
 * A card's sections, on a row narrower than they are: the row fades out at each end where a
 * section is cut and at no other, so a phone, which draws no scrollbar, still says the row
 * goes on. A section picked by the pointer or reached by the keyboard stands with its words
 * clear of the fade, and one that already did is not moved.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import {
  expectFadeOnCut,
  fadedEnds,
  frames,
  openCard,
  overrun,
  pressPoint,
  scrolled,
  still,
  wordsUnderFade,
} from './cardTabsRow.ts'
import { test } from './test.ts'

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

/**
 * Each section the fade cuts with the row at either end, enough of its words in sight to press,
 * with `shown` chosen before it: the scene is set, and `act` is run on it. Says which it ran on.
 */
async function eachCut(
  strip: Locator,
  shown: (index: number) => number,
  act: (index: number, end: 'end' | 'start') => Promise<void>,
) {
  const tabs = strip.getByRole('tab')
  const ran: string[] = []
  for (const end of ['start', 'end'] as const)
    for (let index = 0; index < 5; index += 1) {
      await choose(tabs.nth(shown(index)))
      // Once the row has brought the choice in, as the section widens to its weight, or it
      // brings it in again over the scene.
      await still(strip)
      await strip.evaluate((node, left) => node.scrollTo({ left }), end === 'end' ? 1e6 : 0)
      await still(strip)
      const under = await wordsUnderFade(strip, tabs.nth(index))
      const { seen } = await pressPoint(strip, index)
      if (under.length === 0 || seen < 6) continue
      await act(index, end)
      ran.push(`${end}:${index}`)
    }
  return ran
}

for (const locale of ['ru', 'en'] as const) {
  test(`at 390px in ${locale} a press on the section shown, cut by the fade, brings it clear`, async ({
    page,
  }) => {
    const strip = await openCard(page, 390, locale)
    const tabs = strip.getByRole('tab')
    const pressed = await eachCut(
      strip,
      (index) => index,
      async (index, end) => {
        await press(page, strip, index)
        await still(strip)
        await expect(tabs.nth(index)).toHaveAttribute('aria-selected', 'true')
        expect(await wordsUnderFade(strip, tabs.nth(index)), `${end}: section ${index}`).toEqual([])
      },
    )
    expect(pressed.length, 'a section shown and cut, to press').toBeGreaterThan(0)
  })

  test(`at 390px in ${locale} a press let go off the row leaves the section it focused clear of the fade`, async ({
    page,
  }) => {
    const strip = await openCard(page, 390, locale)
    const tabs = strip.getByRole('tab')
    const left = await eachCut(
      strip,
      (index) => (index === 2 ? 0 : 2),
      async (index, end) => {
        const { x, y } = await pressPoint(strip, index)
        const before = await scrolled(strip)
        await page.mouse.move(x, y)
        await page.mouse.down()
        await frames(strip)
        expect(await scrolled(strip), 'the row holds still under a press').toBe(before)
        await page.mouse.move(x, y + 120, { steps: 4 })
        await page.mouse.up()
        await still(strip)
        const tab = tabs.nth(index)
        await expect(tab, 'focused by the press').toBeFocused()
        await expect(tab, 'and not chosen').toHaveAttribute('aria-selected', 'false')
        expect(await tab.evaluate((node) => node.matches(':focus-visible')), 'no ring').toBe(false)
        expect(await wordsUnderFade(strip, tab), `${end}: section ${index}`).toEqual([])
        await page.mouse.move(0, 0)
      },
    )
    expect(left.length, 'a section cut by the fade, to press').toBeGreaterThan(1)
  })
}
