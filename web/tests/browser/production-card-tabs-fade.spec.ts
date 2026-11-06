/**
 * A card's sections, on a row narrower than they are: the row fades out at each end that
 * has more sections past it and at no other, so a phone, which draws no scrollbar, still
 * says the row goes on. A section the keyboard brings in stands clear of the fade.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { enableExecutionTab } from './executionFixtures.ts'
import { projectScope } from './planningFixtures.ts'
import { test } from './test.ts'

async function openCard(page: Page, width: number) {
  await page.addInitScript(() => localStorage.setItem('valkama-locale', 'ru'))
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

/**
 * Whether the row keeps what it brings in clear of its ends, and which faded end `tab`
 * stands under now.
 */
async function underFade(strip: Locator, tab: Locator) {
  const { start, end } = await fadedEnds(strip)
  const fade = await strip.evaluate((node) =>
    Number.parseFloat(getComputedStyle(node).scrollPaddingInlineStart),
  )
  const [row, box] = await Promise.all([strip.boundingBox(), tab.boundingBox()])
  if (!row || !box) throw new Error('the row or its section is not drawn')
  const under: string[] = []
  if (start && box.x < row.x + fade - 0.5) under.push('start')
  if (end && box.x + box.width > row.x + row.width - fade + 0.5) under.push('end')
  return { padded: fade > 0, under }
}

test('at 390px the row fades at the end that has more sections, and only there', async ({
  page,
}) => {
  const strip = await openCard(page, 390)
  expect(await overrun(strip), 'five sections overrun a phone').toBeGreaterThan(0)

  await expect.poll(() => fadedEnds(strip)).toMatchObject({ start: false, end: true })

  await strip.evaluate((node) => node.scrollTo({ left: (node.scrollWidth - node.clientWidth) / 2 }))
  await expect.poll(() => fadedEnds(strip)).toMatchObject({ start: true, end: true })

  await strip.evaluate((node) => node.scrollTo({ left: node.scrollWidth }))
  await expect.poll(() => fadedEnds(strip)).toMatchObject({ start: true, end: false })

  await strip.evaluate((node) => node.scrollTo({ left: 0 }))
  await expect.poll(() => fadedEnds(strip)).toMatchObject({ start: false, end: true })
})

test('at 1280px the sections fit and the row draws no mask', async ({ page }) => {
  const strip = await openCard(page, 1280)
  expect(await overrun(strip), 'five sections fit a desktop card').toBeLessThanOrEqual(0)
  await expect.poll(() => fadedEnds(strip)).toMatchObject({ mask: 'none' })
})

test('a section the keyboard reaches at 390px stands clear of the fade', async ({ page }) => {
  const strip = await openCard(page, 390)
  const tabs = strip.getByRole('tab')
  await tabs.first().focus()
  await expect(tabs.first()).toBeFocused()
  await expect.poll(() => underFade(strip, tabs.first())).toEqual({ padded: true, under: [] })
  for (let index = 1; index < (await tabs.count()); index += 1) {
    await page.keyboard.press('ArrowRight')
    await expect(tabs.nth(index)).toBeFocused()
    await expect
      .poll(() => underFade(strip, tabs.nth(index)), `section ${index + 1}`)
      .toEqual({ padded: true, under: [] })
  }
})
