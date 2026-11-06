/**
 * A card's row of sections as the tab specs read it: the card opened on a phone or a desktop,
 * which ends of the row fade and which cut a section, how far it has scrolled, where a section's
 * words stand against the fade, and where a person presses one.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { enableExecutionTab } from './executionFixtures.ts'
import { projectScope } from './planningFixtures.ts'

export async function openCard(page: Page, width: number, locale: 'en' | 'ru' = 'ru') {
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

export const fadedEnds = async (strip: Locator) =>
  endsOf(await strip.evaluate((node) => getComputedStyle(node).maskImage))

/** How far the row can scroll past what it shows. */
export const overrun = (strip: Locator) =>
  strip.evaluate((node) => node.scrollWidth - node.clientWidth)

/** How far the strip has scrolled. */
export const scrolled = (strip: Locator) => strip.evaluate((node) => node.scrollLeft)

/** The strip once it has stopped moving: the same over two frames. */
export async function still(strip: Locator) {
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
export async function expectFadeOnCut(strip: Locator, where: string) {
  await expect
    .poll(async () => {
      const { start, end } = await fadedEnds(strip)
      return { start, end }
    }, `${where}: the fade follows the cut`)
    .toEqual(await cutEnds(strip))
}

/** Which faded end the words `tab` draws stand under now, as a Range over them reads them. */
export async function wordsUnderFade(strip: Locator, tab: Locator) {
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

/** Where a person presses a section: the middle of what of its drawn words the row shows. */
export function pressPoint(strip: Locator, index: number) {
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

export const frames = (strip: Locator) =>
  strip.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  )
