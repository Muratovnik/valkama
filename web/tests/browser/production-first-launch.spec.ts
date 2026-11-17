/**
 * The first launch: the shell's skeleton until the application mounts, and then the
 * shell in its place.
 *
 * Before the application's code arrives, `index.html` draws the shell's chrome — the
 * rail with the mark and its first entries, the context bar, the empty workspace panel —
 * and the desktop window draws the same chrome from a data URL while it finds the server
 * (`desktop/startup_page.js`). Neither draws a content row: what the workspace will show
 * is the board's to say once it has read it. Each part stands where the shell draws it,
 * so the handoff moves nothing; a part that stood a pixel off was a visible jump.
 *
 * The application's bundle is held back here, and its stylesheets for a moment, so the
 * skeleton is measured on screen as a slow load leaves it, and the shell is measured in
 * the same page once the bundle is let through.
 */
import { createRequire } from 'node:module'

import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { NAV_WIDTH_STORAGE_KEY } from '@/shared/lib/shellLayout.ts'

import { installBackend } from './backend.ts'
import { test } from './test.ts'

const { renderStartupPage, startupPageUrl } = createRequire(import.meta.url)(
  '../../../desktop/startup_page.js',
) as {
  renderStartupPage: (state: Record<string, unknown>) => string
  startupPageUrl: (state: Record<string, unknown>) => string
}

/** How far a part may stand from the shell's own: under a pixel is no visible jump. */
const TOLERANCE = 0.5

const SIZES = [
  { width: 1484, height: 911 },
  { width: 704, height: 441 },
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
] as const
/** The rail as the reader left it; null is a reader who never moved it. */
const RAILS = [null, 200, 320, 480] as const

interface Box {
  h: number
  w: number
  x: number
  y: number
}

/** Each part of the chrome: the skeleton's, the shell's, and the edges that must agree. */
const PARTS = [
  { part: 'rail', skeleton: '.sk-rail', shell: '.app-nav-shell', edges: ['x', 'w'] },
  { part: 'mark', skeleton: '.sk-mark', shell: '.nav-head svg', edges: ['x', 'y', 'w', 'h'] },
  { part: 'bar', skeleton: '.sk-bar', shell: '.context-bar', edges: ['x', 'y', 'w', 'h'] },
  { part: 'title', skeleton: '.sk-title', shell: '.module-title', edges: ['x', 'cy'] },
  {
    part: 'scope',
    skeleton: '.sk-scope',
    shell: '.context-controls',
    edges: ['x', 'y', 'w', 'h'],
  },
  { part: 'panel', skeleton: '.sk-panel', shell: '#main-content', edges: ['x', 'y', 'w', 'h'] },
] as const

/** The rail's entries, in the skeleton's order and the shell's. */
const ENTRIES = [
  { part: 'finder', skeleton: '.sk-list > .sk-entry:nth-child(1)', shell: '.work-action', nth: 0 },
  {
    part: 'requests',
    skeleton: '.sk-list > .sk-entry:nth-child(2)',
    shell: '.work-action',
    nth: 1,
  },
  { part: 'work', skeleton: '.sk-list > .sk-work', shell: '.module-planning', nth: 0 },
  { part: 'settings', skeleton: '.sk-foot > .sk-entry', shell: '.module-settings', nth: 0 },
] as const

type Measured = Record<string, Box | null>

/** A box as the page lays it out, or null where nothing is drawn. Runs in the page. */
function drawnBox(node: Element): Box | null {
  const { x, y, width, height } = node.getBoundingClientRect()
  return width > 0 || height > 0 ? { x, y, w: width, h: height } : null
}

/** One of a skeleton entry's pseudo-elements, from its computed style. Runs in the page. */
function pseudoBox(node: Element, which: string): Box | null {
  const style = getComputedStyle(node, which)
  if (style.display === 'none') return null
  const entry = node.getBoundingClientRect()
  return {
    x: entry.x + Number.parseFloat(style.left),
    y: entry.y + Number.parseFloat(style.top),
    w: Number.parseFloat(style.width),
    h: Number.parseFloat(style.height),
  }
}

/**
 * The line a shell entry's first words stand on, or null on an icons-only rail, which keeps
 * them for a screen reader in a box of a pixel and draws them nowhere. Runs in the page.
 */
function labelBox(node: Element): Box | null {
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
    acceptNode: (text) =>
      text.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
  })
  const text = walker.nextNode()
  const holder = text?.parentElement?.getBoundingClientRect()
  if (!text || !holder || holder.width <= 1 || holder.height <= 1) return null
  const range = document.createRange()
  range.selectNodeContents(text)
  const { x, y, width, height } = range.getBoundingClientRect()
  return { x, y, w: width, h: height }
}

async function boxOf(locator: Locator): Promise<Box | null> {
  return (await locator.count()) === 0 ? null : locator.evaluate(drawnBox)
}

/**
 * Every part's box as the page draws it: the skeleton's where it stands, else the shell's.
 * An entry's icon and label are the skeleton's two pseudo-elements against the shell's
 * icon and the line its label's text stands on.
 */
async function measure(page: Page, skeleton: boolean): Promise<Measured> {
  const found: Measured = {}
  for (const part of PARTS) {
    found[part.part] = await boxOf(page.locator(skeleton ? part.skeleton : part.shell).first())
  }
  for (const entry of ENTRIES) {
    const node = skeleton
      ? page.locator(entry.skeleton)
      : page.locator(`.app-nav-shell ${entry.shell}`).nth(entry.nth)
    found[entry.part] = await boxOf(node)
    if (found[entry.part] === null) continue
    found[`${entry.part}.icon`] = skeleton
      ? await node.evaluate(pseudoBox, '::before')
      : await boxOf(node.locator('svg').first())
    found[`${entry.part}.label`] = skeleton
      ? await node.evaluate(pseudoBox, '::after')
      : await node.evaluate(labelBox)
  }
  return found
}

/** Which edges of an entry's inner parts must agree: where it starts, and its middle. */
const INNER_EDGES = { icon: ['x', 'y', 'w', 'h'], label: ['x', 'cy'] } as const

function edgesOf(part: string): readonly string[] {
  const listed = PARTS.find((each) => each.part === part)
  if (listed) return listed.edges
  const [, inner] = part.split('.')
  return inner === 'icon' || inner === 'label' ? INNER_EDGES[inner] : ['x', 'y', 'w', 'h']
}

const edge = (box: Box, name: string) =>
  name === 'cy' ? box.y + box.h / 2 : box[name as keyof Box]

/**
 * What is wrong with a part only one side draws, or neither. An entry's label is drawn nowhere
 * on an icons-only rail, by either; a part or an entry that neither draws is a selector that
 * finds nothing, and nothing would have been compared. A part the window hides is drawn by
 * neither, or one of them shows what the other hides.
 */
function unmatched(part: string, drawn: Box | null, real: Box | null, hidden: boolean) {
  if (hidden)
    return drawn === null && real === null ? null : `${part}: drawn on a window that hides it`
  if (drawn === null && real === null)
    return part.includes('.') ? null : `${part}: neither draws it`
  if (drawn === null) return `${part}: only the shell draws it`
  return real === null ? `${part}: only the skeleton draws it` : null
}

/**
 * The parts a window this wide hides: at 760px and under the rail is icons only and keeps no
 * mark, in the shell (`AppNav`), the skeleton (`index.html`) and the desktop window's page.
 */
const hiddenAt = (width: number): readonly string[] => (width <= 760 ? ['mark'] : [])

/** Every edge that stands further than the tolerance from the shell's, said in full. */
function mismatches(skeleton: Measured, shell: Measured, hidden: readonly string[]): string[] {
  const found: string[] = []
  for (const part of new Set([...Object.keys(skeleton), ...Object.keys(shell)])) {
    const drawn = skeleton[part] ?? null
    const real = shell[part] ?? null
    if (hidden.includes(part) || drawn === null || real === null) {
      const said = unmatched(part, drawn, real, hidden.includes(part))
      if (said !== null) found.push(said)
      continue
    }
    for (const name of edgesOf(part)) {
      const delta = edge(real, name) - edge(drawn, name)
      if (Math.abs(delta) > TOLERANCE)
        found.push(
          `${part}.${name}: shell ${edge(real, name).toFixed(2)}, skeleton ${edge(drawn, name).toFixed(2)}`,
        )
    }
  }
  return found
}

/** The application's code, held until the test lets it through. */
async function holdBundle(page: Page): Promise<() => void> {
  let release: (() => void) | undefined
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route(/\/assets\/index-[^/]+\.js$/u, async (route) => {
    await released
    await route.continue()
  })
  return () => release?.()
}

/**
 * The bundle's stylesheets, held until the returned call lets them through. Until they
 * apply the page draws no frame, so a layout read then is one nobody sees.
 */
async function holdStyles(page: Page): Promise<() => void> {
  let release: (() => void) | undefined
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route(/\/assets\/[^/]+\.css$/u, async (route) => {
    await released
    await route.continue()
  })
  return () => release?.()
}

/** The reader's rail width, in the page's storage before its first script runs. */
async function rememberRail(page: Page, rail: number | null) {
  await page.addInitScript(
    ({ key, width }) => {
      try {
        if (width === null) localStorage.removeItem(key)
        else localStorage.setItem(key, String(width))
      } catch {
        // A data URL has no storage of its own.
      }
    },
    { key: NAV_WIDTH_STORAGE_KEY, width: rail },
  )
}

/** Whether a frame showed neither the skeleton nor the shell, counted from now on. */
function watchFrames(page: Page) {
  return page.evaluate(() => {
    const record = window as unknown as { bareFrames: number; frames: number; stop: boolean }
    record.bareFrames = 0
    record.frames = 0
    record.stop = false
    const tick = () => {
      record.frames += 1
      if (!document.querySelector('#app .sk-rail, #app .app-nav-shell')) record.bareFrames += 1
      if (!record.stop) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

async function settled(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
}

for (const size of SIZES) {
  for (const rail of RAILS) {
    const name = `${size.width}×${size.height}, rail ${rail ?? 'never moved'}`

    test(`${name}: the skeleton draws the shell's chrome and the shell takes its place unmoved`, async ({
      page,
    }) => {
      await page.setViewportSize(size)
      await installBackend(page)
      await rememberRail(page, rail)
      const release = await holdBundle(page)
      const releaseStyles = await holdStyles(page)
      await page.goto('/', { waitUntil: 'commit' })
      await expect(page.locator('#app > .sk')).toBeVisible()

      // Only the chrome: nothing in the skeleton says a word or stands for a row of content.
      // Read before the stylesheets come, which needs none of them.
      const drawn = await page.locator('#app').evaluate((app) => ({
        children: [...app.children].map((child) => child.className),
        text: app.textContent?.trim() ?? '',
        panelChildren: app.querySelector('.sk-panel')?.childElementCount ?? -1,
        entries: app.querySelectorAll('.sk-entry').length,
      }))
      expect(drawn).toEqual({ children: ['sk'], text: '', panelChildren: 0, entries: 4 })
      // The stylesheets come after the skeleton is in the page and has been read, as on a slow
      // load: what is measured is the first frame drawn once they apply, which `settled`
      // waits for, not a layout read before it.
      releaseStyles()
      await settled(page)
      const skeleton = await measure(page, true)

      await watchFrames(page)
      release()
      await expect(page.locator('.work-item-board')).toBeVisible()
      await expect(page.locator('#app .sk')).toHaveCount(0)
      await settled(page)
      const frames = await page.evaluate(() => {
        const record = window as unknown as { bareFrames: number; frames: number; stop: boolean }
        record.stop = true
        return { bare: record.bareFrames, seen: record.frames }
      })
      expect(frames.seen).toBeGreaterThan(0)
      expect(frames.bare, 'frames between the skeleton and the shell that showed neither').toBe(0)

      const shell = await measure(page, false)
      expect(mismatches(skeleton, shell, hiddenAt(size.width))).toEqual([])

      // The desktop window's page stands on the same lines, at the width the window remembers.
      await page.goto(
        startupPageUrl({ phase: 'starting', locale: 'en', port: 8642, navWidth: rail }),
      )
      await expect(page.locator('.sk-rail')).toBeVisible()
      expect(mismatches(await measure(page, true), shell, hiddenAt(size.width))).toEqual([])
    })
  }
}

test('with reduced motion nothing in either skeleton moves', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const running = () =>
    page.evaluate(() =>
      document
        .getAnimations()
        .filter((animation) => {
          const timing = animation.effect?.getComputedTiming()
          // A step that takes a millisecond is a change of state, not motion.
          return Number(timing?.duration ?? 0) > 1 || timing?.iterations === Infinity
        })
        .map((animation) => (animation as CSSAnimation).animationName ?? 'animation'),
    )

  // The window's page spins its wait by default, which is what reduced motion stops.
  const startup = startupPageUrl({ phase: 'starting', locale: 'ru', port: 8642 })
  await page.goto(startup)
  await expect(page.locator('.sk-rail')).toBeVisible()
  expect(await running()).toContain('spin')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(startup)
  await expect(page.locator('.sk-rail')).toBeVisible()
  expect(await running()).toEqual([])

  await installBackend(page)
  const release = await holdBundle(page)
  await page.goto('/', { waitUntil: 'commit' })
  await expect(page.locator('#app > .sk')).toBeVisible()
  expect(await running()).toEqual([])
  release()
})

for (const locale of ['en', 'ru'] as const) {
  for (const state of [
    { phase: 'stale', reasons: ['front-end', 'server-code'] },
    {
      phase: 'failed',
      kind: 'server-exited',
      detail: Array.from(
        { length: 12 },
        (_, line) => `line ${line + 1} of what the server said`,
      ).join('\n'),
    },
  ]) {
    test(`the ${state.phase} page reads whole in ${locale} at the smallest window`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 704, height: 441 })
      // A remedy is no wait: it is the plain page, without the skeleton behind it.
      expect(renderStartupPage({ ...state, locale, port: 8642 })).not.toContain('class="sk')
      await page.goto(startupPageUrl({ ...state, locale, port: 8642 }))
      const action = page.locator('a.button.primary')
      await expect(action).toBeVisible()
      const laid = await page.evaluate(() => {
        const inside = (node: Element | null) => {
          if (!node) return false
          const { left, right, top, bottom } = node.getBoundingClientRect()
          return left >= 0 && top >= 0 && right <= innerWidth && bottom <= innerHeight
        }
        return {
          title: inside(document.querySelector('h1')),
          lines: [...document.querySelectorAll('main > p:not(.brand)')].map((line) => inside(line)),
          action: inside(document.querySelector('a.button.primary')),
          sideways: document.documentElement.scrollWidth > innerWidth,
        }
      })
      // The page says why in lines of its own: each of them inside the window.
      expect(laid.lines.length).toBeGreaterThan(0)
      expect({ ...laid, lines: laid.lines.every(Boolean) }).toEqual({
        title: true,
        lines: true,
        action: true,
        sideways: false,
      })
    })
  }
}
