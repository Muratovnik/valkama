/**
 * The list in the built application: the title takes the width the other
 * columns leave and nothing is pushed past the right edge at any width, the
 * columns that give way on a narrow list are folded under the title rather
 * than cut, the head stays one line at every width, and the rows are one Tab
 * stop walked with the arrows and the page keys and opened by a click anywhere.
 */
import { expect, test } from '@playwright/test'

import { installBackend } from './backend.ts'
import { openList, serve, shot } from './boardPage.ts'
import { expectNoSilentClipping } from './overflow.ts'

// A phone's width folds five columns, and their sorts as a run of buttons took
// three lines of it; there they are one choice instead.
for (const [width, headings, foldedSorts, choice] of [
  [1440, ['Ref', 'Title', 'State', 'Priority', 'Assignee', 'Steps', 'Updated'], 0, false],
  [1024, ['Ref', 'Title', 'Steps', 'Updated'], 3, false],
  [390, ['Ref', 'Title'], 0, true],
] as const) {
  test(`the list fits its columns at ${width}px and gives the title the rest`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 800 })
    await installBackend(page)
    await serve(page)
    await openList(page)
    const list = page.locator('.work-item-list')
    await expect(list.locator('tbody tr').first()).toBeVisible()
    // Each heading's own sort is its first button; a folded column's sort rides the title's.
    await expect(list.locator('thead th .list-sort:not(.folded)')).toHaveText([...headings])
    const geometry = await list.evaluate((element) => {
      const heads = [...element.querySelectorAll('thead th')].map((th) =>
        th.getBoundingClientRect(),
      )
      const box = element.getBoundingClientRect()
      return {
        overflow: element.scrollWidth - element.clientWidth,
        lastRight: heads.at(-1)?.right ?? 0,
        right: box.left + element.clientWidth,
        widths: heads.map((head) => Math.round(head.width)),
        head: element.querySelector('thead')?.getBoundingClientRect().height ?? 0,
      }
    })
    expect(geometry.overflow, 'nothing is pushed past the right edge').toBeLessThanOrEqual(0)
    expect(geometry.lastRight).toBeLessThanOrEqual(geometry.right + 1)
    // The title is the widest column: the spare width is its.
    expect(Math.max(...geometry.widths)).toBe(geometry.widths[1])
    // What gives way is folded under the title, not dropped: its sort is in the
    // title's heading and its value on a line of facts under each title.
    await expect(list.locator('thead .list-sort.folded')).toHaveCount(foldedSorts)
    await expect(list.locator('thead .list-sort-choice')).toHaveCount(choice ? 1 : 0)
    const facts = await list.locator('tbody .list-facts').count()
    expect(facts > 0).toBe(foldedSorts > 0 || choice)
    // One line of head, as tall as the control row the rows scroll under.
    expect(geometry.head, 'the head is one line').toBeLessThanOrEqual(41)
    // The reference's heading starts where the references do, not over the
    // glyph slots that lead them.
    const [heading, reference] = await list.evaluate((element) =>
      ['thead th:first-child .list-sort', 'tbody .list-open'].map((selector) => {
        const text = [...(element.querySelector(selector)?.childNodes ?? [])].find(
          (child) => child.nodeType === Node.TEXT_NODE && child.textContent?.trim(),
        )
        if (!text) return Number.NaN
        const range = document.createRange()
        range.selectNodeContents(text)
        return range.getBoundingClientRect().left
      }),
    )
    expect(Math.abs(heading - reference), `${heading} → ${reference}`).toBeLessThanOrEqual(1)
    await expectNoSilentClipping(page, `list at ${width}px`)
    await page.screenshot(shot(info, `w-list-${width}.png`))
  })
}

test('the rows are one Tab stop, walked by the arrows, and a closed card gives focus back', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 800 })
  await installBackend(page)
  await serve(page)
  await openList(page)
  const rows = page.locator('.work-item-list tbody .list-open')
  await expect(rows.first()).toBeVisible()
  const count = await rows.count()
  await expect(page.locator('.work-item-list tbody .list-open[tabindex="0"]')).toHaveCount(1)
  // Tab from the last sort heading lands on the first row, and the next Tab leaves the list.
  await page.locator('.work-item-list thead .list-sort').last().focus()
  await page.keyboard.press('Tab')
  await expect(rows.first()).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(rows.nth(1)).toBeFocused()
  await page.keyboard.press('End')
  await expect(rows.nth(count - 1)).toBeFocused()
  await page.keyboard.press('Home')
  await expect(rows.first()).toBeFocused()
  await page.keyboard.press('ArrowDown')
  const text = await rows.nth(1).textContent()
  const reference = text?.trim() ?? ''
  await page.keyboard.press('Enter')
  const drawer = page.locator('.drawer')
  await expect(drawer.locator('.head-reference')).toHaveText(reference)
  await page.keyboard.press('Escape')
  await expect(drawer).toHaveCount(0)
  await expect(rows.nth(1)).toBeFocused()
  await expect(rows.nth(1)).toHaveAttribute('tabindex', '0')
})

test('the page keys move focus a screen of rows, and focus stays in sight', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 600 })
  await installBackend(page)
  await serve(page)
  await openList(page)
  const list = page.locator('.work-item-list')
  const rows = list.locator('tbody .list-open')
  await expect(rows.first()).toBeVisible()
  expect(await list.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
  await rows.first().focus()
  const sight = () =>
    list.evaluate((element) => {
      const focused = document.activeElement?.closest('tr')
      const head = element.querySelector('thead')?.getBoundingClientRect()
      const box = element.getBoundingClientRect()
      const row = focused?.getBoundingClientRect()
      return {
        index: focused ? [...(focused.parentElement?.children ?? [])].indexOf(focused) : -1,
        inSight: Boolean(row && head && row.top >= head.bottom - 1 && row.bottom <= box.bottom + 1),
      }
    })
  await page.keyboard.press('PageDown')
  const down = await sight()
  expect(down.index).toBeGreaterThan(1)
  expect(down.inSight, 'the row focus moved to is in sight').toBe(true)
  await page.keyboard.press('PageUp')
  expect(await sight()).toEqual({ index: 0, inSight: true })
})

test('a click anywhere in a row opens its card, but not one that selects its text', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 800 })
  await installBackend(page)
  await serve(page)
  await openList(page)
  const row = page.locator('.work-item-list tbody tr').nth(1)
  await expect(row).toBeVisible()
  const text = await row.locator('.list-open').textContent()
  const reference = text?.trim() ?? ''
  const name = row.locator('.list-name')
  expect(await name.evaluate((element) => getComputedStyle(element).cursor)).toBe('pointer')
  await name.click()
  const drawer = page.locator('.drawer')
  await expect(drawer.locator('.head-reference')).toHaveText(reference)
  await page.keyboard.press('Escape')
  await expect(drawer).toHaveCount(0)
  await expect(row.locator('.list-open')).toBeFocused()
  // A drag across the title selects it and opens nothing.
  const [left, top, span] = await name.evaluate((element) => {
    const line = element.getClientRects()[0]
    return [line.x, line.y, line.width]
  })
  await page.mouse.move(left + 3, top + 6)
  await page.mouse.down()
  await page.mouse.move(left + Math.min(span - 3, 150), top + 6, { steps: 10 })
  await page.mouse.up()
  expect(
    await page.evaluate(() => document.getSelection()?.toString().length ?? 0),
  ).toBeGreaterThan(0)
  // A heading's sort orders the rows and opens nothing either.
  await page.locator('.work-item-list thead .list-sort').nth(1).click()
  await expect(page.locator('.work-item-list thead th').nth(1)).toHaveAttribute(
    'aria-sort',
    'ascending',
  )
  await expect(drawer).toHaveCount(0)
})

test('a phone-width list offers the folded orders as one choice that turns them over', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 800 })
  await installBackend(page)
  await serve(page)
  await openList(page)
  const head = page.locator('.work-item-list thead')
  const choice = head.getByRole('combobox', { name: 'Sort by' })
  // The list opens sorted by Updated, newest first, which is folded here.
  await expect(choice).toHaveText('Updated')
  const option = (name: string) => page.getByRole('option', { name, exact: true })
  await choice.click()
  await option('Sort ascending').click()
  await expect(choice).toHaveText('Updated')
  await choice.click()
  await expect(option('Sort descending')).toBeVisible()
  await option('Assignee').click()
  await expect(choice).toHaveText('Assignee')
  // The longest order's name is whole beside the title's sort.
  const cut = await choice
    .locator('.choice-title')
    .evaluate((title) => title.scrollWidth > title.clientWidth)
  expect(cut, 'the chosen order is not cut').toBe(false)
  await head.getByRole('button', { name: 'Title', exact: true }).click()
  await expect(choice).toHaveText('Order')
  await expect(head.locator('th').nth(1)).toHaveAttribute('aria-sort', 'ascending')
  // The facts folded under a title are part of the row, and the whole row opens its card.
  const facts = page.locator('.work-item-list tbody .list-facts').first()
  expect(await facts.evaluate((element) => getComputedStyle(element).cursor)).toBe('pointer')
  await facts.click()
  await expect(page.locator('.drawer')).toHaveCount(1)
})

test('at the fold the title keeps 36 characters, the references align and nobody reads as workable', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 800 })
  await installBackend(page)
  await serve(page)
  await openList(page)
  const list = page.locator('.work-item-list')
  await expect(list.locator('tbody tr').first()).toBeVisible()
  // The narrowest list that still stands every column side by side.
  await list.evaluate((element) => {
    element.style.inlineSize = '900px'
  })
  await expect(list).toHaveAttribute('data-fit', 'wide')
  const measured = await list.evaluate((element) => {
    const title = element.querySelector<HTMLElement>('tbody .list-title')
    const probe = document.createElement('span')
    probe.style.cssText = 'position:absolute;visibility:hidden;inline-size:1ch'
    title?.append(probe)
    const characters =
      (title?.getBoundingClientRect().width ?? 0) / probe.getBoundingClientRect().width
    probe.remove()
    const starts = [...element.querySelectorAll('tbody .list-open')].map((open) =>
      Math.round(open.getBoundingClientRect().left),
    )
    const glyphs = [...element.querySelectorAll('tbody .list-ref')].map(
      (cell) => cell.querySelectorAll('.facet-glyph').length,
    )
    return { characters, starts: [...new Set(starts)], glyphs: [...new Set(glyphs)] }
  })
  // A row says its priority once: the glyph leads the reference, and the
  // column says the word, in the colour the glyph has.
  const priority = await list.evaluate((element) =>
    [...element.querySelectorAll('tbody tr')].map((row) => {
      const glyph = row.querySelector('.list-ref .facet-mark[data-facet="priority"] .facet-glyph')
      const column = row.querySelector<HTMLElement>(
        'td:not(.list-ref-cell) .facet-mark[data-facet="priority"]',
      )
      const word = column?.querySelector('.facet-word')
      return {
        glyphs: row.querySelectorAll('.facet-mark[data-facet="priority"] .facet-glyph').length,
        tone: column?.dataset.tone ?? null,
        glyph: glyph ? getComputedStyle(glyph).color : null,
        word: word ? getComputedStyle(word).color : null,
      }
    }),
  )
  expect(Math.max(...priority.map((row) => row.glyphs))).toBe(1)
  const hued = priority.filter((row) => row.tone === 'warning' || row.tone === 'danger')
  expect(hued.length).toBeGreaterThan(0)
  for (const row of hued) expect(row.word).toBe(row.glyph)
  expect(measured.characters).toBeGreaterThanOrEqual(36)
  // Rows with and without glyphs, and every reference starts at one edge.
  expect(measured.glyphs.length).toBeGreaterThan(1)
  expect(measured.starts).toHaveLength(1)
  await expect(list.locator('tbody')).not.toContainText('Workable')
  await expectNoSilentClipping(page, 'list at 900px of list')
  await page.screenshot(shot(info, 'w-list-900.png'))
})
