import AxeBuilder from '@axe-core/playwright'
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { asked, openQuestion } from './questionBackend.ts'
import { test } from './test.ts'

/**
 * A document opened from a text, in the built app with the real keyboard: from a card
 * and from the questions waiting for an answer, at a width where it stands over them.
 */

const PLAN = `---
status: proposed
card: 12
date: 2026-11-03
---

# The migration plan <!-- kb:plan-head -->

Why this plan exists, in a paragraph long enough to wrap at any width this viewer takes,
so that a reader sees how its lines run together instead of breaking where the file does.

See [the notes](notes.md) and [the second part](#part-two). The parser is at \`src/a.ts\`.

| Step | Owner | State | Where it stands | What it still waits for from anyone else |
| --- | --- | --- | --- | --- |
| Read | Person | Done | \`docs/plan.md\` | Nothing at all, it has been finished for a while now |
| Write | an_identifier_long_enough_that_it_cannot_wrap_in_a_narrow_column | Open | here | Time |

\`\`\`text
A line of code long enough that a phone has to scroll it inside its own frame and nowhere else.
\`\`\`

## Part two

${Array.from({ length: 30 }, (_, index) => `Paragraph ${index + 1} of the second part.`).join('\n\n')}

## The target <!-- kb:a7f3 -->

The block an anchor lands on, far enough down that landing on it has to scroll.

${Array.from({ length: 30 }, (_, index) => `Closing paragraph ${index + 1}.`).join('\n\n')}
`

const FILES: Record<string, string> = {
  'docs/plan.md': PLAN,
  'docs/notes.md': '# The notes\n\nBack to [the plan](plan.md#part-two).\n',
}

const confirmed = (relative: string) => ({
  status: 'file',
  project: 'demo',
  relative,
  markdown: true,
})

const KNOWN: Record<string, object> = {
  'docs/plan.md': confirmed('docs/plan.md'),
  'docs/notes.md': confirmed('docs/notes.md'),
  'docs/gone.md': confirmed('docs/gone.md'),
  'src/a.ts': { status: 'file', project: 'demo', relative: 'src/a.ts', markdown: false },
}

async function installDocuments(page: Page) {
  await page.route('**/api/documents/resolve*', async (route) => {
    const paths = new URL(route.request().url()).searchParams.getAll('path')
    await route.fulfill({
      json: { paths: paths.map((path) => ({ path, ...(KNOWN[path] ?? { status: 'missing' }) })) },
    })
  })
  await page.route('**/api/documents/read*', async (route) => {
    const path = new URL(route.request().url()).searchParams.get('path') ?? ''
    const markdown = FILES[path]
    await (markdown === undefined
      ? route.fulfill({ status: 404, json: { error: { code: 'not_found' } } })
      : route.fulfill({
          json: {
            project: 'demo',
            path,
            markdown,
            size: markdown.length,
            modified_at: '2026-11-03T15:12:09Z',
            revision: '9f2c41d0a7b3e655',
          },
        }))
  })
}

const LINK = 'docs/plan.md#kb:a7f3'
const HUB_TITLE = 'Needs my answer'

const aCardAsking = (page: Page, prompt: string) =>
  openQuestion(page, [asked({ prompt })], () => installDocuments(page))

function viewerOf(page: Page) {
  const viewer = page.locator('.document-drawer')
  return {
    viewer,
    body: viewer.locator('.document-body'),
    title: viewer.locator('.overlay-header-name'),
    status: viewer.getByRole('status').first(),
  }
}

/** The link's name says what it opens, and nothing about how the text happens to word it. */
const linkIn = (scope: Locator, path: string) =>
  scope.getByRole('button', { name: `Open the document in Valkama: ${path}` })

async function settled(viewer: Locator) {
  await expect(viewer).toHaveCSS('transform', 'none')
}

/** Where a shot goes when a person asks for shots; a run without the setting takes none. */
async function shot(page: Page, name: string) {
  const folder = process.env.VALKAMA_SHOT_DIR
  if (folder) await page.screenshot({ path: `${folder}/${name}.png` })
}

test('from a card: over it at 1100, at the anchor, and Escape comes back to the link', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 800 })
  const { drawer, comment } = await aCardAsking(page, `Read \`${LINK}\` first.`)
  await comment.fill('Half a thought')
  const link = linkIn(drawer, LINK)
  await link.focus()
  await page.keyboard.press('Enter')

  const { viewer, body, title } = viewerOf(page)
  await settled(viewer)
  await expect(title).toHaveText('The migration plan')
  await expect(viewer.getByText('status: proposed · card: 12 · date: 2026-11-03')).toBeVisible()
  await expect(viewer.getByRole('heading', { level: 3, name: 'Part two' })).toBeVisible()
  const target = viewer.locator('.document-block.is-target')
  await expect(target).toContainText('The target')
  await expect(target).toBeFocused()
  await expect(target).toBeInViewport()
  await expect.poll(() => body.evaluate((node) => node.scrollTop)).toBeGreaterThan(0)
  await shot(page, 'card-1100')
  // The card is still there under it, out of reach.
  await expect(drawer.locator('..').locator('.overlay-surface').first()).toHaveAttribute(
    'inert',
    '',
  )

  await page.keyboard.press('Escape')
  await expect(viewer).toHaveCount(0)
  await expect(link).toBeFocused()
  await expect(comment).toHaveValue('Half a thought')
  await expect(drawer).toBeVisible()
})

test('from the questions waiting for an answer: over the dialog, which stays', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 })
  const { drawer } = await aCardAsking(page, `Read \`${LINK}\` first.`)
  await page.keyboard.press('Escape')
  await expect(drawer).toHaveCount(0)
  await page.getByRole('button', { name: /^Needs my answer/u }).click()
  const hub = page.getByRole('dialog', { name: HUB_TITLE })
  await expect(hub).toBeVisible()
  const link = linkIn(hub, LINK)
  await link.focus()
  await page.keyboard.press('Enter')

  const { viewer } = viewerOf(page)
  await settled(viewer)
  await expect(viewer.locator('.document-block.is-target')).toBeFocused()
  await shot(page, 'questions-1100')

  await page.keyboard.press('Escape')
  await expect(viewer).toHaveCount(0)
  await expect(link).toBeFocused()
  await expect(hub).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(hub).toHaveCount(0)
})

test('a line leads to its block, and links lead on and back to the same place', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 800 })
  // The first paragraph, past the front matter and the heading.
  const { drawer } = await aCardAsking(page, 'Read `docs/plan.md:9` first.')
  await linkIn(drawer, 'docs/plan.md:9').click()
  const { viewer, body, title } = viewerOf(page)
  await settled(viewer)
  await expect(viewer.locator('.document-block.is-target')).toContainText('Why this plan exists')

  // A link to a place in the same file moves there and adds nothing to go back to.
  await linkIn(viewer, '#part-two').click()
  await expect(viewer.locator('.document-block.is-target')).toContainText('Part two')
  await expect(viewer.getByRole('button', { name: /^Back to/u })).toHaveCount(0)

  await body.evaluate((node) => node.scrollTo({ top: 240 }))
  await linkIn(viewer, 'notes.md').evaluate((node: HTMLElement) => node.click())
  await expect(title).toHaveText('The notes')
  const back = viewer.getByRole('button', { name: 'Back to docs/plan.md' })
  await expect(back).toBeVisible()
  await back.click()
  await expect(title).toHaveText('The migration plan')
  await expect.poll(() => body.evaluate((node) => node.scrollTop)).toBe(240)
  await expect(viewer.getByRole('button', { name: /^Back to/u })).toHaveCount(0)
})

test('an anchor it does not have opens at the start and says so', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 })
  const { drawer } = await aCardAsking(page, 'Read `docs/plan.md#kb:gone` first.')
  await linkIn(drawer, 'docs/plan.md#kb:gone').click()
  const { viewer, body, status } = viewerOf(page)
  await settled(viewer)
  await expect(status).toHaveText('There is no #kb:gone in this document, so it opens at the start')
  expect(await body.evaluate((node) => node.scrollTop)).toBe(0)
  await shot(page, 'anchor-missing-1100')
})

test('a file gone since the text was written says so, and Close comes back to the link', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 800 })
  const { drawer } = await aCardAsking(page, 'Read `docs/gone.md` first.')
  const link = linkIn(drawer, 'docs/gone.md')
  await link.click()
  const { viewer } = viewerOf(page)
  await settled(viewer)
  await expect(viewer.getByRole('heading', { name: 'gone.md' })).toBeVisible()
  await expect(viewer).toContainText('The file docs/gone.md is no longer in the project')
  await expect(viewer.getByRole('button', { name: 'Refresh' })).toHaveCount(0)
  await shot(page, 'gone-1100')
  await viewer.getByRole('button', { name: 'Close the document' }).click()
  await expect(viewer).toHaveCount(0)
  await expect(link).toBeFocused()
})

test('the viewer holds to the accessibility rules with its text and a mark in it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 800 })
  const { drawer } = await aCardAsking(page, `Read \`${LINK}\` first.`)
  await linkIn(drawer, LINK).click()
  const { viewer } = viewerOf(page)
  await settled(viewer)
  await expect(viewer.locator('.document-block.is-target')).toBeVisible()
  // A browser takes a scroller with no control in it into the Tab order only while it
  // scrolls, which the phone's test below walks; a stop on every block of code would not.
  const { violations } = await new AxeBuilder({ page })
    .include('.document-drawer')
    .disableRules(['scrollable-region-focusable'])
    .analyze()
  expect(violations.map(({ id, nodes }) => [id, nodes[0]?.target])).toEqual([])
})

test('the keyboard walks the head, then the links of the text, and comes round', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 800 })
  const { drawer } = await aCardAsking(page, 'Read `docs/plan.md` first.')
  await linkIn(drawer, 'docs/plan.md').focus()
  await page.keyboard.press('Enter')
  const { viewer, title } = viewerOf(page)
  await settled(viewer)
  await expect(title).toBeFocused()

  await page.keyboard.press('Tab')
  await expect(viewer.getByRole('button', { name: 'Copy the path docs/plan.md' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(viewer.getByRole('button', { name: 'Refresh' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(viewer.getByRole('button', { name: 'Open in a new window' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(viewer.getByRole('button', { name: 'Close the document' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(linkIn(viewer, 'notes.md')).toBeFocused()

  // Round the ends, with the separator at the far one, as in every drawer.
  await viewer.getByRole('separator').focus()
  await page.keyboard.press('Shift+Tab')
  await expect(page.locator(':focus')).not.toHaveCount(0)
  expect(
    await page.evaluate(() => document.activeElement?.closest('.document-drawer')),
  ).not.toBeNull()
})

test.describe('on a phone', () => {
  test('whole window, nothing runs off it, and the wide parts scroll in their frames', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 800 })
    const { drawer } = await aCardAsking(page, 'Read `docs/plan.md` first.')
    await linkIn(drawer, 'docs/plan.md').click()
    const { viewer, body, title } = viewerOf(page)
    await settled(viewer)
    await expect(title).toHaveText('The migration plan')
    const box = await viewer.boundingBox()
    expect(box?.width).toBe(390)
    await expect(viewer.getByRole('separator')).toHaveCount(0)
    expect(await body.evaluate((node) => node.scrollWidth - node.clientWidth)).toBe(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await shot(page, 'card-390')
    const table = viewer.locator('.rich-table-frame')
    expect(await table.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true)
    const code = viewer.locator('.rich-pre')
    expect(await code.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true)
    // A browser takes a scroller with no control in it into the Tab order by itself.
    await code.evaluate((node: HTMLElement) => node.scrollIntoView())
    await viewer.locator('.rich-table-frame button').last().focus()
    await page.keyboard.press('Tab')
    await expect(code).toBeFocused()
  })
})

test.describe('in a forced palette', () => {
  test.use({ forcedColors: 'active' })

  test('the mark on the target stays when the fill goes', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 })
    const { drawer } = await aCardAsking(page, `Read \`${LINK}\` first.`)
    await linkIn(drawer, LINK).click()
    const { viewer } = viewerOf(page)
    await settled(viewer)
    const target = viewer.locator('.document-block.is-target')
    await expect(target).toHaveCSS('border-inline-start-style', 'solid')
    await expect(target).toHaveCSS('border-inline-start-width', '2px')
    await shot(page, 'card-forced')
  })
})
