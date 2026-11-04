/**
 * Live work moving on the graph as the browser runs it: a comet only on the
 * lines that reach work being done now, one switch that stops all of it and is
 * remembered across a reload, nothing moving under reduced motion, and the
 * live line in the forced palette's own colour for what is picked out.
 *
 * Drawn on the harness's sample layout, where the first card is being worked
 * on and the second has fallen silent; `live=folded` also puts work under way
 * inside the folded largest epic.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { test } from './test.ts'

const surface = (live = '') => {
  const query = new URLSearchParams({ surface: 'graph', lang: 'en' })
  if (live) query.set('live', live)
  return `/tests/browser/harness.html?${query.toString()}`
}

async function settled(page: Page) {
  await expect(page.locator('.graph-flow.settled')).toBeVisible()
  await expect(page.locator('.graph-frame')).toHaveCount(3)
}

/** Every animation running in the field, the strip's switch aside. */
const fieldAnimations = (page: Page) =>
  page.evaluate(
    () => document.querySelector('.graph-flow')?.getAnimations({ subtree: true }).length,
  )

/** Which lines carry a comet, by whether they are live. */
const comets = (page: Page) =>
  page.locator('.vue-flow__edge').evaluateAll((edges) =>
    edges.map((edge) => ({
      live: edge.classList.contains('live'),
      comet: edge.querySelector('.graph-comet') !== null,
    })),
  )

const toggle = (page: Page) => page.locator('.graph-motion-toggle')

test('a comet runs only on a line that reaches work being done now', async ({ page }) => {
  await page.goto(surface())
  await settled(page)
  // The line between the two cards reaches the one being worked on; the line
  // folded onto the largest epic reaches only the silent one.
  expect(await comets(page)).toEqual([
    { live: true, comet: true },
    { live: false, comet: false },
  ])
  await page.goto(surface('folded'))
  await settled(page)
  expect(await comets(page)).toEqual([
    { live: true, comet: true },
    { live: true, comet: true },
  ])
  await expect(page.locator('.graph-frame.folded .graph-frame-working').first()).toContainText('1')
  expect(await fieldAnimations(page)).toBeGreaterThan(0)
})

test('an item a session holds without working on it stands still, and the key says so', async ({
  page,
}) => {
  await page.goto(surface())
  await settled(page)
  await expect(page.locator('.graph-legend-held')).toHaveCount(0)
  await page.goto(surface('held'))
  await settled(page)
  const held = page.locator('.graph-live[data-live="held"]')
  await expect(held).toHaveText('held')
  // Its dots stand still while the card being worked on pulses beside it.
  const dots = (live: string) =>
    page
      .locator(`.graph-live[data-live="${live}"] .work-dots i`)
      .first()
      .evaluate((dot) => dot.getAnimations().length)
  expect(await dots('held')).toBe(0)
  expect(await dots('working')).toBeGreaterThan(0)
  // The line it reaches carries no comet, and the key names the still dots.
  expect(await comets(page)).toEqual([
    { live: true, comet: true },
    { live: false, comet: false },
  ])
  await expect(page.locator('.graph-legend-on-field .graph-legend-held')).toHaveText(
    'held by a session, not worked on now',
  )
})

test('the switch stops all motion at once and the stop survives a reload', async ({ page }) => {
  await page.goto(surface('folded'))
  await settled(page)
  await expect(toggle(page)).toHaveAccessibleName('Stop the motion')
  await toggle(page).click()
  await expect(toggle(page)).toHaveAccessibleName('Start the motion')
  await expect(page.locator('.graph-comet')).toHaveCount(0)
  await expect(page.locator('.graph-flow')).toHaveAttribute('data-motion', 'paused')
  // A transition the switch began ends in a moment; nothing repeats after it.
  await expect.poll(() => fieldAnimations(page), { timeout: 2000 }).toBe(0)
  expect(await page.evaluate(() => localStorage.getItem('valkama-graph-motion'))).toBe('paused')
  // Held still, the live line is wider than a resting one.
  const width = await page
    .locator('.vue-flow__edge.live .vue-flow__edge-path')
    .first()
    .evaluate((path) => Number.parseFloat(getComputedStyle(path).strokeWidth))
  expect(width).toBeGreaterThan(1.6)

  await page.reload()
  await settled(page)
  await expect(toggle(page)).toHaveAccessibleName('Start the motion')
  // A transition the switch began ends in a moment; nothing repeats after it.
  await expect.poll(() => fieldAnimations(page), { timeout: 2000 }).toBe(0)
  await toggle(page).click()
  await expect(page.locator('.graph-comet')).toHaveCount(2)
})

test('under reduced motion nothing moves and there is no switch', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(surface('folded'))
  await settled(page)
  await expect(toggle(page)).toHaveCount(0)
  await expect(page.locator('.graph-comet')).toHaveCount(0)
  // A transition the switch began ends in a moment; nothing repeats after it.
  await expect.poll(() => fieldAnimations(page), { timeout: 2000 }).toBe(0)
  const widths = await page
    .locator('.vue-flow__edge .vue-flow__edge-path')
    .evaluateAll((paths) => paths.map((path) => getComputedStyle(path).strokeWidth))
  expect(widths).toEqual(['2.4px', '2.4px'])
})

test('in a forced palette the live line is drawn in the colour kept for what is picked out', async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: 'active' })
  await page.goto(surface())
  await settled(page)
  const paint = await page.evaluate(() => {
    const probe = document.createElement('i')
    probe.style.color = 'Highlight'
    document.body.append(probe)
    const highlight = getComputedStyle(probe).color
    probe.remove()
    const stroke = (selector: string) => {
      const path = document.querySelector(selector)
      return path ? getComputedStyle(path).stroke : ''
    }
    return {
      highlight,
      live: stroke('.vue-flow__edge.live .vue-flow__edge-path'),
      comet: stroke('.graph-comet'),
      rest: stroke('.vue-flow__edge:not(.live) .vue-flow__edge-path'),
    }
  })
  expect(paint.live).toBe(paint.highlight)
  expect(paint.comet).toBe(paint.highlight)
  expect(paint.rest).not.toBe(paint.highlight)
})

for (const width of [1500, 390]) {
  test(`the switch is reached from the keyboard and moves nothing at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 })
    await page.goto(surface('folded'))
    await settled(page)
    const strip = page.locator('.graph-harness-strip')
    const before = await strip.boundingBox()
    const flow = await page.locator('.graph-flow').boundingBox()
    await page.keyboard.press('Tab')
    await expect(toggle(page)).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(toggle(page)).toHaveAccessibleName('Start the motion')
    await page.keyboard.press('Space')
    await expect(toggle(page)).toHaveAccessibleName('Stop the motion')
    // The switch rides the strip's one line: the strip is as tall as with no
    // switch in it, so the field does not move when it comes or goes.
    expect(before?.height).toBe(await strip.evaluate((node) => node.clientHeight))
    expect(await page.locator('.graph-flow').boundingBox()).toEqual(flow)
    const target = await toggle(page).evaluate((button) => {
      const after = getComputedStyle(button, '::after')
      return Number.parseFloat(after.width)
    })
    expect(target).toBeGreaterThanOrEqual(44)
  })
}

test('with the switch not offered, the strip keeps the switch’s place', async ({ page }) => {
  await page.goto(surface())
  await settled(page)
  const offered = await page.locator('.graph-harness-strip').boundingBox()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(toggle(page)).toHaveCount(0)
  const withdrawn = await page.locator('.graph-harness-strip').boundingBox()
  expect(withdrawn).toEqual(offered)
})
