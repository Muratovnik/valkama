import AxeBuilder from '@axe-core/playwright'
import { expect } from '@playwright/test'
import type { BrowserContext, Locator, Page } from '@playwright/test'

import { installBackend } from './backend.ts'
import { asked, openQuestion } from './questionBackend.ts'
import { test } from './test.ts'

/**
 * A document in a window of its own, in the built app: the page at its address, and the
 * button in the viewer that opens it. A new tab is a page of its own, which a route on the
 * first page does not reach, so what it reads stands on the context; a route on a page
 * goes first, so what the backend's page answers has to be on the page as well.
 */

const SESSION = '12345678-1234-4234-8234-123456789abc'

const PLAN = `---
status: proposed
card: 12
---

# The migration plan <!-- kb:plan-head -->

Why this plan exists, in a paragraph long enough to wrap at any width this page takes, so
that a reader sees how its lines run together instead of breaking where the file does.

It came from MAIN-12, in the session ${SESSION}. See [the notes](notes.md) and \`src/a.ts\`.

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

const confirmed = (relative: string, markdown = true) => ({
  status: 'file',
  project: 'demo',
  relative,
  markdown,
})

const KNOWN: Record<string, object> = {
  'docs/plan.md': confirmed('docs/plan.md'),
  'docs/notes.md': confirmed('docs/notes.md'),
  'src/a.ts': confirmed('src/a.ts', false),
}

const REFUSED: Record<string, { code: string; status: number }> = {
  'docs/gone.md': { code: 'not_found', status: 404 },
  '../outside.md': { code: 'outside_root', status: 403 },
}

async function installDocuments(on: BrowserContext | Page) {
  await on.route('**/api/documents/resolve*', async (route) => {
    const paths = new URL(route.request().url()).searchParams.getAll('path')
    await route.fulfill({
      json: { paths: paths.map((path) => ({ path, ...(KNOWN[path] ?? { status: 'missing' }) })) },
    })
  })
  await on.route('**/api/documents/read*', async (route) => {
    const path = new URL(route.request().url()).searchParams.get('path') ?? ''
    const markdown = FILES[path]
    const refusal = REFUSED[path] ?? { code: 'not_found', status: 404 }
    await (markdown === undefined
      ? route.fulfill({ status: refusal.status, json: { error: { code: refusal.code } } })
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

const addressOf = (path: string, fragment = '') =>
  `/doc?project=demo&path=${encodeURIComponent(path)}${fragment}`

async function openPage(page: Page, path: string, fragment = '') {
  const backend = await installBackend(page)
  await installDocuments(page)
  await page.goto(addressOf(path, fragment))
  return backend
}

const linkIn = (scope: Locator | Page, path: string) =>
  scope.getByRole('button', { name: `Open the document in Valkama: ${path}` })

const target = (page: Page) => page.locator('.document-block.is-target')

/** Where a shot goes when a person asks for shots; a run without the setting takes none. */
async function shot(page: Page, name: string) {
  const folder = process.env.VALKAMA_SHOT_DIR
  if (folder) await page.screenshot({ path: `${folder}/${name}.png` })
}

test.describe('the page at its address', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
  })

  test('opens the document at the anchor, alone in the window, and a reload stays there', async ({
    page,
  }) => {
    await openPage(page, 'docs/plan.md', '#kb:a7f3')
    await expect(page.getByRole('heading', { level: 1, name: 'The migration plan' })).toBeVisible()
    await expect(target(page)).toContainText('The target')
    await expect(target(page)).toBeInViewport()
    await expect(page).toHaveTitle('The migration plan')

    await expect(page.locator('.app-shell')).toHaveCount(0)
    await expect(page.locator('.skip-link')).toHaveCount(0)
    await expect(page.locator('.document-drawer')).toHaveCount(0)
    await expect(page.getByRole('main')).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Close the document' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Open in a new window' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible()

    await page.reload()
    await expect(target(page)).toContainText('The target')
    await expect(target(page)).toBeInViewport()
    expect(new URL(page.url()).hash).toBe('#kb:a7f3')
  })

  test('focus waits unringed on what it is read with, and the keys go on from there', async ({
    page,
  }) => {
    await openPage(page, 'docs/plan.md', '#kb:a7f3')
    const body = page.locator('.document-body')
    await expect(target(page)).toBeInViewport()
    await expect(body).toBeFocused()
    await expect(body).toHaveCSS('outline-style', 'none')

    const before = await body.evaluate((node) => node.scrollTop)
    await page.keyboard.press('PageDown')
    await expect.poll(() => body.evaluate((node) => node.scrollTop)).toBeGreaterThan(before)

    await page.evaluate(() => {
      document.querySelector<HTMLElement>('.document-body')?.scrollTo({ top: 0 })
    })
    await page.keyboard.press('Shift+Tab')
    await expect(page.getByRole('button', { name: 'Refresh' })).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(page.getByRole('button', { name: 'Copy the path docs/plan.md' })).toBeFocused()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    await expect(linkIn(page, 'notes.md')).toBeFocused()
  })

  test('a number or a session is text, while paths and documents work and the address follows', async ({
    page,
  }) => {
    await openPage(page, 'docs/plan.md')
    await expect(page.getByRole('heading', { level: 1, name: 'The migration plan' })).toBeVisible()
    const paragraph = page.locator('.document-block', { hasText: 'It came from' })
    await expect(paragraph).toContainText(`MAIN-12, in the session ${SESSION}`)
    await expect(linkIn(paragraph, 'notes.md')).toBeVisible()
    // The shell's opener reaches the page: a file offers its editor, and is not only copied.
    await expect(paragraph.getByRole('button', { name: /^Open in .+: src\/a\.ts$/u })).toBeVisible()
    await expect(paragraph.getByRole('button', { name: /MAIN-12|session/iu })).toHaveCount(0)
    await expect(paragraph.getByRole('link')).toHaveCount(0)
    await expect(paragraph.locator('.rich-reference', { hasText: 'MAIN-12' })).toHaveCount(0)

    await linkIn(paragraph, 'notes.md').click()
    await expect(page).toHaveTitle('The notes')
    await expect(page).toHaveURL(/path=docs(?:%2F|\/)notes\.md$/u)
    const back = page.getByRole('button', { name: 'Back to docs/plan.md' })
    await expect(back).toBeVisible()

    await linkIn(page, 'plan.md#part-two').click()
    await expect(page).toHaveTitle('The migration plan')
    await expect(page).toHaveURL(/path=docs(?:%2F|\/)plan\.md#part-two$/u)
    await expect(target(page)).toContainText('Part two')
    await expect(target(page)).toBeFocused()

    await page.reload()
    await expect(target(page)).toContainText('Part two')
    await expect(page).toHaveURL(/path=docs(?:%2F|\/)plan\.md#part-two$/u)
  })

  test('another anchor typed into the address moves there and reads nothing again', async ({
    page,
  }) => {
    await openPage(page, 'docs/plan.md', '#part-two')
    await expect(target(page)).toContainText('Part two')
    const reads: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/api/documents/read')) reads.push(request.url())
    })
    await page.evaluate(() => {
      location.hash = '#kb:a7f3'
    })
    await expect(target(page)).toContainText('The target')
    expect(reads).toEqual([])
  })

  test('a refused read is the viewer saying so, with nothing to close', async ({ page }) => {
    await openPage(page, 'docs/gone.md', '#kb:a7f3')
    await expect(page.getByRole('heading', { level: 1, name: 'gone.md' })).toBeVisible()
    await expect(page.locator('main')).toContainText(
      'The file docs/gone.md is no longer in the project',
    )
    await expect(page).toHaveTitle('gone.md')
    await expect(page.getByRole('button', { name: 'Close the document' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Refresh' })).toHaveCount(0)
    await expect(page.locator('.app-shell')).toHaveCount(0)
    expect(new URL(page.url()).hash).toBe('#kb:a7f3')

    await page.goto(addressOf('../outside.md'))
    await expect(page.locator('main')).toContainText('The file is outside the project')
  })

  test('an anchor the document does not have opens at the start and says so', async ({ page }) => {
    await openPage(page, 'docs/plan.md', '#kb:gone')
    await expect(page.getByRole('status').first()).toHaveText(
      'There is no #kb:gone in this document, so it opens at the start',
    )
    expect(await page.locator('.document-body').evaluate((node) => node.scrollTop)).toBe(0)
  })

  test('an address that names no document is the shell saying so, with its way back', async ({
    page,
  }) => {
    await installBackend(page)
    await installDocuments(page)
    await page.goto('/doc?project=demo')
    await expect(page.locator('.app-shell')).toBeVisible()
    await expect(page.locator('.document-page')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /home|work/iu }).first()).toBeVisible()
  })

  test('it is no place for the app to hand a card to, and no place to come back to', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const desktop = window as unknown as { listened: number }
      desktop.listened = 0
      window.valkamaDesktop = {
        onOpenRoute() {
          desktop.listened += 1
        },
      } as unknown as typeof window.valkamaDesktop
    })
    await page.clock.install()
    const { prefsWrites } = await openPage(page, 'docs/plan.md')
    await expect(page).toHaveTitle('The migration plan')
    // Longer than the shell waits before it remembers where it stands.
    await page.clock.runFor(1000)
    expect(prefsWrites).toEqual([])
    expect(await page.evaluate(() => (window as unknown as { listened: number }).listened)).toBe(0)
  })

  test('it holds to the accessibility rules with its text and a mark in it', async ({ page }) => {
    await openPage(page, 'docs/plan.md', '#kb:a7f3')
    await expect(target(page)).toBeVisible()
    const { violations } = await new AxeBuilder({ page })
      .disableRules(['scrollable-region-focusable'])
      .analyze()
    expect(violations.map(({ id, nodes }) => [id, nodes[0]?.target])).toEqual([])
  })
})

test.describe('the button in the viewer', () => {
  const LINK = 'docs/plan.md#kb:a7f3'

  async function openFromCard(page: Page, context: BrowserContext, written = LINK) {
    await page.setViewportSize({ width: 1100, height: 800 })
    await installDocuments(context)
    // The backend's doubles stand in for `window.open`, and this is about the real one.
    await page.addInitScript(() => {
      ;(window as unknown as { realOpen: typeof window.open }).realOpen = window.open
    })
    const { drawer, comment } = await openQuestion(
      page,
      [asked({ prompt: `Read \`${written}\` first.` })],
      async () => {
        await installDocuments(page)
        await page.addInitScript(() => {
          Object.defineProperty(window, 'open', {
            configurable: true,
            value: (window as unknown as { realOpen: typeof window.open }).realOpen,
          })
        })
      },
    )
    await comment.fill('Half a thought')
    const link = linkIn(drawer, written)
    await link.focus()
    await page.keyboard.press('Enter')
    const viewer = page.locator('.document-drawer')
    await expect(viewer).toHaveCSS('transform', 'none')
    return { comment, drawer, link, viewer }
  }

  test('opens a tab that has no way back, and the document closes here', async ({
    page,
    context,
  }) => {
    const { comment, link, viewer } = await openFromCard(page, context)
    const [tab] = await Promise.all([
      context.waitForEvent('page'),
      viewer.getByRole('button', { name: 'Open in a new window' }).click(),
    ])
    await tab.waitForLoadState()
    expect(await tab.evaluate(() => window.opener)).toBeNull()
    const address = new URL(tab.url())
    expect(address.pathname).toBe('/doc')
    expect(address.searchParams.get('project')).toBe('demo')
    expect(address.searchParams.get('path')).toBe('docs/plan.md')
    expect(address.hash).toBe('#kb:a7f3')
    await expect(target(tab)).toContainText('The target')
    await expect(tab).toHaveTitle('The migration plan')

    await expect(viewer).toHaveCount(0)
    await expect(link).toBeFocused()
    await expect(comment).toHaveValue('Half a thought')
    await tab.close()
  })

  test('a line a link named goes along, in the form an address has', async ({ page, context }) => {
    const { viewer } = await openFromCard(page, context, 'docs/plan.md:9')
    const [tab] = await Promise.all([
      context.waitForEvent('page'),
      viewer.getByRole('button', { name: 'Open in a new window' }).click(),
    ])
    await tab.waitForLoadState()
    expect(new URL(tab.url()).hash).toBe('#L9')
    await expect(target(tab)).toContainText('Why this plan exists')
    await tab.close()
  })
})

for (const [locale, gone, missing] of [
  ['en-US', 'The file docs/gone.md is no longer in the project', 'There is no #kb:gone'],
  ['ru-RU', 'Файла docs/gone.md больше нет в проекте', 'Якоря #kb:gone в документе нет'],
] as const) {
  test.describe(`in ${locale}`, () => {
    test.use({ locale })

    for (const width of [1280, 390]) {
      test(`at ${width}px nothing runs off the window, in any state`, async ({ page }) => {
        const name = `${locale.slice(0, 2)}-${width}`
        await page.setViewportSize({ width, height: 800 })
        await openPage(page, 'docs/plan.md', '#kb:a7f3')
        const body = page.locator('.document-body')
        const stays = async () => {
          expect(await body.evaluate((node) => node.scrollWidth - node.clientWidth)).toBe(0)
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
        }
        await expect(target(page)).toBeInViewport()
        await stays()
        await shot(page, `${name}-anchor`)
        await body.evaluate((node) => node.scrollTo({ top: 0 }))
        await shot(page, `${name}-top`)

        await page.goto(addressOf('docs/plan.md', '#kb:gone'))
        await expect(page.getByRole('status').first()).toContainText(missing)
        await stays()
        await shot(page, `${name}-anchor-missing`)

        await page.goto(addressOf('docs/gone.md'))
        await expect(page.locator('main')).toContainText(gone)
        await shot(page, `${name}-refused`)
      })
    }
  })
}
