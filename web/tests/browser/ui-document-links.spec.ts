import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { test } from './test.ts'

/**
 * A path in a text, driven with the real keyboard: what it does, where focus stays,
 * what is announced and how it is drawn on a phone and in forced colours.
 */

const FILE = { status: 'file', project: 'demo', relative: 'docs/plan.md', markdown: true }
const FOLDER = { status: 'directory', project: 'demo', relative: 'web/src' }
const REFUSED = { status: 'refused', code: 'outside_root' }

/** What the server knows. Everything else is not there. */
const KNOWN: Record<string, object> = {
  'docs/plan.md': FILE,
  'C:/work/probe': REFUSED,
  'web/src': FOLDER,
}

interface Page2 {
  copied: () => Promise<string[]>
  /** Sentences the status region took on, in order, kept from before the first press. */
  spoken: () => Promise<string[]>
}

async function open(
  page: Page,
  { width = 1100, surface = 'document-links', slow = false } = {},
): Promise<Page2> {
  await page.setViewportSize({ width, height: 800 })
  // The clipboard stays in the page: nothing here reaches the system's.
  await page.addInitScript(() => {
    const copied: string[] = []
    ;(window as unknown as { __copied: string[] }).__copied = copied
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string) => {
          copied.push(text)
          return Promise.resolve()
        },
      },
    })
  })
  await page.route('**/api/documents/resolve*', async (route) => {
    const paths = new URL(route.request().url()).searchParams.getAll('path')
    if (slow) await new Promise((settle) => setTimeout(settle, 600))
    await route.fulfill({
      json: { paths: paths.map((path) => ({ path, ...(KNOWN[path] ?? { status: 'missing' }) })) },
    })
  })
  await page.goto(`/tests/browser/harness.html?surface=${surface}`)
  await page.evaluate(() => {
    const region = document.querySelector('[role="status"]')
    const spoken: string[] = []
    ;(window as unknown as { __spoken: string[] }).__spoken = spoken
    if (region)
      new MutationObserver(() => spoken.push(region.textContent ?? '')).observe(region, {
        characterData: true,
        childList: true,
        subtree: true,
      })
  })
  return {
    spoken: () => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken),
    copied: () => page.evaluate(() => (window as unknown as { __copied: string[] }).__copied),
  }
}

const control = (page: Page, name: string) =>
  page.locator('button.rich-reference', { hasText: name })

/** Tab from where focus is until the named path holds it; the keyboard's own way there. */
async function tabTo(page: Page, name: string) {
  for (let press = 0; press < 30; press += 1) {
    await page.keyboard.press('Tab')
    const here = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '')
    if (here === name) return
  }
  throw new Error(`Tab never reached ${name}`)
}

const focusedText = (page: Page) =>
  page.evaluate(() => document.activeElement?.textContent?.trim() ?? '')

test.describe('a path as a control', () => {
  test('Enter and Space copy a path that cannot be opened, and focus stays on it', async ({
    page,
  }) => {
    const run = await open(page)
    await expect(control(page, 'C:/work/probe')).toHaveAttribute('title', /вне проектов Valkama/)
    await tabTo(page, 'C:/work/probe')
    await page.keyboard.press('Enter')
    await expect(page.locator('[role="status"]')).toHaveText('Путь скопирован')
    expect(await focusedText(page)).toBe('C:/work/probe')
    await page.keyboard.press('Space')
    await expect.poll(run.copied).toEqual(['C:/work/probe', 'C:/work/probe'])
    expect(await focusedText(page)).toBe('C:/work/probe')
    // The same sentence twice is announced twice: the region empties between them.
    await expect.poll(run.spoken).toEqual(['Путь скопирован', '', 'Путь скопирован'])
  })

  test('copies a tail-free path and leaves the tail outside the control', async ({ page }) => {
    const run = await open(page)
    const gone = control(page, 'docs/gone.md')
    await expect(gone).toHaveText('docs/gone.md')
    await expect(gone).toHaveClass(/copies/)
    await expect(page.locator('[data-paragraph="1"]')).toContainText('docs/gone.md. и в скобках')
    await gone.click()
    await expect.poll(run.copied).toEqual(['docs/gone.md'])
  })

  test('a press while the answer is on its way waits and acts once', async ({ page }) => {
    const run = await open(page, { slow: true })
    const gone = control(page, 'docs/slow.md')
    await expect(gone).toHaveAttribute('aria-busy', 'true')
    await tabTo(page, 'docs/slow.md')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    expect(await run.copied()).toEqual([])
    await expect(gone).not.toHaveAttribute('aria-busy', 'true')
    await expect.poll(run.copied).toEqual(['docs/slow.md'])
    await expect(page.locator('[role="status"]')).toHaveText('Путь скопирован')
    expect(await focusedText(page)).toBe('docs/slow.md')
  })

  test('a weak path does not move when it becomes a link', async ({ page }) => {
    await open(page, { slow: true })
    const code = page.locator('[data-paragraph="2"] code', { hasText: 'web/src' })
    const before = await code.boundingBox()
    const link = page.locator('[data-paragraph="2"] button.rich-reference', { hasText: 'web/src' })
    await expect(link).toBeVisible()
    const after = await link.boundingBox()
    expect(after?.x).toBeCloseTo(before?.x ?? -1, 0)
    expect(after?.y).toBeCloseTo(before?.y ?? -1, 0)
    expect(after?.width).toBeCloseTo(before?.width ?? -1, 0)
    // What the server did not confirm is never a control.
    await expect(control(page, 'owner/repo')).toHaveCount(0)
    await expect(control(page, 'client/server/protocol')).toHaveCount(0)
  })

  test('tells copying from opening by the line, not by colour, in forced colours too', async ({
    page,
  }) => {
    await page.emulateMedia({ forcedColors: 'active' })
    await open(page)
    const copying = control(page, 'C:/work/probe')
    await expect(copying).toHaveAttribute('title', /вне проектов/)
    const line = (name: string) =>
      control(page, name).evaluate((node) => {
        const style = getComputedStyle(node)
        return `${style.textDecorationLine} ${style.textDecorationStyle}`
      })
    expect(await line('C:/work/probe')).toBe('underline dotted')
    await expect(control(page, 'docs/plan.md').first()).not.toHaveClass(/copies/)
    expect(
      await control(page, 'docs/plan.md')
        .first()
        .evaluate((node) => getComputedStyle(node).textDecorationStyle),
    ).toBe('solid')
  })

  test('on a phone a long path breaks inside itself and the page does not move sideways', async ({
    page,
  }) => {
    await open(page, { width: 390 })
    const long = control(page, 'InspectorReferenceScope.vue')
    await expect(long).toBeVisible()
    const box = await long.boundingBox()
    expect((box?.x ?? 0) + (box?.width ?? Infinity)).toBeLessThanOrEqual(390)
    expect(box?.height ?? 0).toBeGreaterThan(40)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    // A 24px band to press, on a single-line path, without a taller line.
    const band = await control(page, 'C:/work/probe').evaluate((node) => {
      const box = node.getBoundingClientRect()
      const before = getComputedStyle(node, '::before')
      return { line: box.height, band: Number.parseFloat(before.height) }
    })
    expect(band.band).toBe(24)
    expect(band.line).toBeLessThan(30)
  })
})

test.describe('from inside the card', () => {
  test('the sentence is said above the drawer, and Tab stays in the drawer', async ({ page }) => {
    const run = await open(page, { surface: 'document-links-drawer' })
    const drawer = page.locator('.overlay-surface')
    await expect(drawer.getByRole('button', { name: /C:\/work\/probe/ })).toBeVisible()
    await tabTo(page, 'C:/work/probe')
    await page.keyboard.press('Enter')
    await expect.poll(run.copied).toEqual(['C:/work/probe'])
    const notice = page.locator('.notice')
    await expect(notice).toBeVisible()
    // Not only painted: the words are what is on top at their own centre.
    const onTop = await notice.locator('.notice-message').evaluate((node) => {
      const box = node.getBoundingClientRect()
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
      return hit === node
    })
    expect(onTop).toBe(true)
    expect(await focusedText(page)).toBe('C:/work/probe')
    await expect(page.locator('[role="status"]').first()).toHaveText('Путь скопирован')
    await page.keyboard.press('Tab')
    expect(
      await page.evaluate(() => Boolean(document.activeElement?.closest('.overlay-surface'))),
    ).toBe(true)
  })
})
