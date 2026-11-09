import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { installDocuments } from './documentBackend.ts'
import { openCard } from './editorPage.ts'
import { planningSpace } from './planningFixtures.ts'
import { test } from './test.ts'

/**
 * `@` in a comment, as a person meets it in the built app: one list of the space's
 * tasks and the project's files, grouped by kind. A chosen task is written as its
 * number with no `@`, and the comment sent tells it in `mentions`, which is what the
 * server records (connection contract, "Mentions"); a chosen file is written as a
 * Markdown link from the project's root, and the link the comment then shows opens
 * the file through the document routes. A `#` opens nothing, since at a line's start
 * it is a heading, and the toolbar's mention button writes an `@`.
 */

const TASK = {
  work_item_id: '00000000-0000-4000-8000-000000000103',
  planning_space_id: planningSpace.planning_space_id,
  reference: 'MAIN-3',
  title: 'The plan parser',
  state: { name: 'Doing' },
  claim_ref: '',
}

type Found = { line: number; path: string; text: string }
type Asked = { kind: string; query: string | null; space: string | null }

/** A card with the space's search and the project's files answering, and what each was asked. */
async function openWithSources(page: Page, documents: Found[]) {
  const searched: Asked[] = []
  const asked = (kind: string, url: string) => {
    const query = new URL(url).searchParams
    searched.push({ kind, query: query.get('q'), space: query.get('space') })
  }
  const opened = await openCard(page, async () => {
    await installDocuments(page)
    await page.route('**/api/planning/search?*', (route) => {
      asked('task', route.request().url())
      return route.fulfill({
        json: { interface_version: 'valkama-planning-api', work_items: [TASK] },
      })
    })
    await page.route('**/api/documents/search?*', (route) => {
      asked('file', route.request().url())
      return route.fulfill({ json: { documents } })
    })
  })
  return { ...opened, searched, list: page.getByRole('listbox', { name: 'Mentions' }) }
}

test('@ offers tasks and files; a task is told, a file is a link that opens, and # opens nothing', async ({
  page,
}) => {
  await page.clock.install()
  const { backend, drawer, comment, list, searched } = await openWithSources(page, [
    { path: 'docs/plan.md', line: 0, text: '' },
  ])

  // A `#` is a heading or a word's part, and asks nobody, however long typing pauses:
  // the page's time moves past the pause an `@` waits only when the test moves it.
  await comment.click()
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000)
  await page.keyboard.type('#par')
  await page.clock.runFor(1000)
  await expect(list).toHaveCount(0)
  expect(searched).toEqual([])
  await page.clock.resume()

  // An `@` asks for tasks and files at once, and the list says which is which.
  await comment.fill('')
  await page.keyboard.type('See @pl')
  await expect(list.getByRole('group', { name: 'Tasks' }).getByRole('option')).toHaveText([
    /MAIN-3.*The plan parser/u,
  ])
  await expect(list.getByRole('group', { name: 'Files' }).getByRole('option')).toHaveText([
    /plan\.md.*docs\/plan\.md/u,
  ])
  const space = planningSpace.planning_space_id
  expect(searched).toEqual(
    expect.arrayContaining([
      { kind: 'task', query: 'pl', space },
      { kind: 'file', query: 'pl', space },
    ]),
  )
  // By now a search the `#` had asked for would have arrived too.
  expect(searched.filter((asked) => asked.query === 'par')).toEqual([])

  // The keys take a task, and its number is written without the `@`.
  await page.keyboard.press('Enter')
  await expect(comment).toHaveValue('See MAIN-3 ')
  await expect(list).toHaveCount(0)

  // A file is taken by a press, as a link from the project's root named by the file.
  await page.keyboard.type('and @plan')
  await list.getByRole('group', { name: 'Files' }).getByRole('option').click()
  await expect(comment).toHaveValue('See MAIN-3 and [plan.md](docs/plan.md) ')
  await expect(comment).toBeFocused()

  // The toolbar's mention button writes an `@` and opens the same list.
  await drawer
    .locator('.discussion-form')
    .getByRole('button', { name: 'Mention a task or a file', exact: true })
    .click()
  await expect(comment).toHaveValue('See MAIN-3 and [plan.md](docs/plan.md) @')
  await expect(list).toBeVisible()
  await page.keyboard.press('Backspace')
  await expect(list).toHaveCount(0)

  // Sent, the comment tells the task it chose, and the text is what was written.
  await drawer.locator('.discussion-form').getByRole('button', { name: 'Add note' }).click()
  await expect(comment).toHaveValue('')
  const sent = backend.writes.at(-1)
  expect(sent?.body).toBe('See MAIN-3 and [plan.md](docs/plan.md) ')
  expect(sent?.mentions).toEqual(['MAIN-3'])
  expect(backend.item.comments.at(-1)?.mentions).toEqual(['MAIN-3'])

  // The link the comment shows is the resolver's, and opens the file in the document viewer.
  await drawer
    .getByRole('link', { name: 'plan.md — Open the document in Valkama: docs/plan.md' })
    .click()
  const viewer = page.locator('.document-drawer')
  await expect(viewer.locator('.overlay-header-name')).toHaveText('The migration plan')
})

const LONG = 'docs/plans/2026/a-file-name-long-enough-to-crowd-out-everything-beside-it.md'
const LINE = `A line found in the file, ${'long enough to run past any width the list takes, '.repeat(3)}`

/** Where a shot goes when a person asks for shots; a run without the setting takes none. */
async function shot(list: Locator, name: string) {
  const folder = process.env.VALKAMA_SHOT_DIR
  if (folder) await list.screenshot({ path: `${folder}/${name}.png` })
}

/**
 * Each row as measured: how far it stands past the list's inner edges, how far its name
 * runs into its title, how far any part runs past its end, and the name's share of it.
 */
const measureRows = (list: Locator) =>
  list.evaluate((element) => {
    const box = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    const left = box.left + Number.parseFloat(style.paddingLeft)
    const right = box.right - Number.parseFloat(style.paddingRight)
    return [...element.querySelectorAll('[role="option"]')].map((option) => {
      const row = option.getBoundingClientRect()
      const part = (name: string) =>
        option.querySelector(`.markdown-suggestion-${name}`)?.getBoundingClientRect() ?? row
      const parts = [part('name'), part('title'), part('detail')]
      return {
        outside: Math.max(0, left - row.left, row.right - right),
        overlap: Math.max(0, part('name').right - part('title').left),
        past: Math.max(0, ...parts.map((inner) => inner.right - row.right)),
        nameShare: part('name').width / row.width,
      }
    })
  })

for (const width of [390, 1280]) {
  test(`a long file name and a long found line stay in their row at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    const { comment, list } = await openWithSources(page, [
      { path: LONG, line: 0, text: '' },
      { path: 'docs/notes.md', line: 3, text: LINE },
    ])
    await comment.click()
    await page.keyboard.type('@pl')
    await expect(list.getByRole('option')).toHaveCount(3)
    await shot(list, `mentions-${width}`)

    const rows = await measureRows(list)
    // Inside the list, the name before the title, and nothing past the row's end.
    expect(rows.map(({ outside, overlap, past }) => Math.max(outside, overlap, past))).toEqual(
      rows.map(() => expect.closeTo(0, 0)),
    )
    // The long name gives way, at no more than its share of the row.
    expect(rows[1]?.nameShare).toBeLessThan(0.5)
  })
}
