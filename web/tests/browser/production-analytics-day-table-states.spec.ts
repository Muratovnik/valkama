/**
 * The day chart's table on the model of states the Analytics page's rows share, in the real app
 * at 1440×900, in English and in Russian. A day's row holds several controls — the day and each
 * value's figure — and takes the row's grounds from the model: at rest it is drawn as the task
 * table's rows are, under the pointer anywhere on it the whole row takes the hovered ground a rail
 * entry and a task row take, and chosen the ground of the rail's chosen entry. Its box is one box
 * in every state. The keyboard's ring stands round the cell of the control focused, inside that
 * cell and the row, and covers no neighbour; Tab moves it from cell to cell. Each run prints what
 * it measured.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { pageAt, record, serve } from './analyticsPage.ts'
import { drawnColours } from './contrast.ts'
import { test } from './test.ts'

/** Moves the pointer onto the panel's heading, away from every row. */
async function pointAway(page: Page) {
  const heading = await page.locator('.module-title').boundingBox()
  await page.mouse.move((heading?.x ?? 0) + 2, (heading?.y ?? 0) + 2)
}

/** The ground each cell of a row is drawn on, laid over what stands under it. */
async function drawnGrounds(row: Locator) {
  const grounds: string[] = []
  for (const cell of await row.locator(':scope > *').all()) {
    const drawn = await cell.evaluate(drawnColours, 'own' as const)
    grounds.push(drawn.fill.join(','))
  }
  return grounds
}

/** The ground each cell of a row is given, as its style says it. */
const cellGrounds = (row: Locator) =>
  row.evaluate((element) =>
    [...element.children].map((cell) => getComputedStyle(cell).backgroundColor),
  )

/** The ground a rail entry is given, as its style says it. */
const ground = (target: Locator) =>
  target.evaluate((element) => getComputedStyle(element).backgroundColor)

/**
 * The chosen row's mark: where it is drawn, by the row or a cell of it, against the first cell's
 * box and where the first cell's words start; null when nothing in the row draws one.
 */
const markIn = (row: Locator) =>
  row.evaluate((element) => {
    const first = element.firstElementChild
    if (!first) return null
    for (const node of [element, first]) {
      const before = getComputedStyle(node, '::before')
      if (before.content === 'none' || Number.parseFloat(before.width) <= 0) continue
      // An absolute mark stands from the padding box of the box it is drawn in.
      const from = node.getBoundingClientRect()
      const left = from.left + Number.parseFloat(before.left)
      const top = from.top + Number.parseFloat(before.top)
      const words = document.createRange()
      words.selectNodeContents(first)
      const { left: cellLeft, right, top: cellTop, bottom } = first.getBoundingClientRect()
      return {
        by: node === element ? 'row' : 'cell',
        mark: {
          left,
          right: left + Number.parseFloat(before.width),
          top,
          bottom: top + Number.parseFloat(before.height),
        },
        cell: { left: cellLeft, right, top: cellTop, bottom },
        name: words.getBoundingClientRect().left,
      }
    }
    return null
  })

/** A row's box, from the table's corner, so a scroll of the page does not read as a move. */
const rowBox = (row: Locator) =>
  row.evaluate((element) => {
    const box = element.getBoundingClientRect()
    const table = element.closest('table')?.getBoundingClientRect()
    return {
      x: Math.round((box.left - (table?.left ?? 0)) * 100) / 100,
      y: Math.round((box.top - (table?.top ?? 0)) * 100) / 100,
      width: Math.round(box.width * 100) / 100,
      height: Math.round(box.height * 100) / 100,
    }
  })

/**
 * Every focus ring drawn in a row, by the row, a cell or a control in it: an outline, as far as
 * its width and offset reach past the element's box, or a shadow, which stays inside the box when
 * it is inset and reaches past it by its lengths when not. Each comes with the box of the cell it
 * is drawn in, the box of the row, and the index of the cell that holds the focused control.
 */
const ringsIn = (row: Locator) =>
  row.evaluate((element) => {
    const cells = [...element.children]
    // This body is serialized and evaluated in the page, so a module-scope helper would not be
    // in scope here.
    // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
    const boxes = (nodes: Element[]) =>
      nodes.map((node) => {
        const { left, right, top, bottom } = node.getBoundingClientRect()
        return { left, right, top, bottom }
      })
    type Box = ReturnType<typeof boxes>[number]
    const rings: { by: string; cell: number; drawn: Box }[] = []
    for (const node of [element, ...element.querySelectorAll('*')]) {
      const style = getComputedStyle(node)
      const [box = { left: 0, right: 0, top: 0, bottom: 0 }] = boxes([node])
      const cell = cells.findIndex((one) => one === node || one.contains(node))
      const grow = (reach: number) => ({
        left: box.left - reach,
        right: box.right + reach,
        top: box.top - reach,
        bottom: box.bottom + reach,
      })
      const outline = Number.parseFloat(style.outlineWidth)
      if (style.outlineStyle !== 'none' && outline > 0)
        rings.push({
          cell,
          by: `${node.tagName} outline`,
          drawn: grow(outline + Number.parseFloat(style.outlineOffset)),
        })
      if (style.boxShadow !== 'none') {
        const outer = style.boxShadow
          .split(/,(?![^(]*\))/u)
          .filter((shadow) => !shadow.includes('inset'))
          .flatMap((shadow) =>
            (shadow.match(/-?[\d.]+px/gu) ?? []).map((one) => Number.parseFloat(one)),
          )
          .reduce((sum, length) => sum + Math.abs(length), 0)
        rings.push({ cell, by: `${node.tagName} shadow`, drawn: grow(outer) })
      }
    }
    const focused = cells.findIndex((one) => one.contains(document.activeElement))
    return {
      rings,
      focused,
      cells: boxes(cells),
      row: boxes([element])[0],
      shown: document.activeElement?.matches(':focus-visible') ?? false,
    }
  })

type Rings = Awaited<ReturnType<typeof ringsIn>>

/** One ring, round the focused control's cell and inside it and the row; none anywhere else. */
function expectRingInCell(measured: Rings, where: string) {
  expect(measured.shown, `${where}: the ring shows after the keyboard`).toBe(true)
  expect(measured.focused, `${where}: the focus in a cell of the row`).toBeGreaterThanOrEqual(0)
  expect(measured.rings, `${where}: rings drawn ${JSON.stringify(measured.rings)}`).toHaveLength(1)
  const [ring] = measured.rings
  const cell = measured.cells[measured.focused]
  expect(ring?.cell, `${where}: the ring in a cell other than the focused one`).toBe(
    measured.focused,
  )
  for (const [name, box] of [
    ['cell', cell],
    ['row', measured.row],
  ] as const) {
    expect(ring?.drawn.left, `${where}: the ring past its ${name}'s start`).toBeGreaterThanOrEqual(
      (box?.left ?? 0) - 0.01,
    )
    expect(ring?.drawn.right, `${where}: the ring past its ${name}'s end`).toBeLessThanOrEqual(
      (box?.right ?? 0) + 0.01,
    )
    expect(ring?.drawn.top, `${where}: the ring over its ${name}'s top`).toBeGreaterThanOrEqual(
      (box?.top ?? 0) - 0.01,
    )
    expect(ring?.drawn.bottom, `${where}: the ring under its ${name}'s bottom`).toBeLessThanOrEqual(
      (box?.bottom ?? 0) + 0.01,
    )
  }
}

/** Brings the keyboard's focus to `control` as a keyboard does: from the stop before it. */
async function tabOnto(page: Page, control: Locator) {
  await control.focus()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  await expect(control).toBeFocused()
}

/** The page at the task section, its day chart shown as its table. */
async function open(page: Page) {
  await serve(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(pageAt({ by: 'work_item' }))
  await expect(page.locator('.analytics-rail [aria-busy="true"]')).toHaveCount(0)
  const days = page.locator('.spending-days')
  // The section's switch offers the chart, then the table.
  await days.locator('.segmented-option').nth(1).click()
  await expect(days).toHaveAttribute('data-shown', 'table')
  await page.evaluate(() => document.fonts.ready)
  return days
}

for (const [language, locale] of [
  ['English', 'en-US'],
  ['Russian', 'ru-RU'],
] as const)
  test.describe(`in ${language}`, () => {
    test.use({ locale })

    test("a day's row takes the grounds the other rows take, keeps its box, and is grounded whole under the pointer", async ({
      page,
    }, info) => {
      const days = await open(page)
      const rows = days.locator('tbody tr')
      const row = rows.filter({ has: page.locator('[data-series]') }).first()
      const neighbour = row.locator('xpath=following-sibling::tr[1]')
      const figure = row
        .locator('td')
        .filter({ has: page.locator('[data-series]') })
        .first()
      const note = row.locator('td').last()
      const taskRow = page
        .locator('.spending-table tbody tr')
        .filter({ has: page.locator('a') })
        .first()
      await expect(figure).toBeVisible()
      await expect(neighbour).toBeVisible()
      await expect(taskRow).toBeVisible()
      await row.scrollIntoViewIfNeeded()

      // What the other rows give: a task row at rest, a rail entry and a task row under the
      // pointer, and the rail's chosen entry.
      await pointAway(page)
      const taskRest = await drawnGrounds(taskRow)
      const railChosen = await ground(page.locator('.analytics-rail-entry[aria-current="page"]'))
      const entry = page.locator('.analytics-rail-entry:not([aria-current])').first()
      await entry.hover()
      const railHover = await ground(entry)
      await taskRow.locator('td').last().hover()
      const taskHover = await cellGrounds(taskRow)

      // The day's row at rest, under the pointer on one figure and on its note, and chosen.
      await pointAway(page)
      const rest = {
        grounds: await drawnGrounds(row),
        neighbour: await drawnGrounds(neighbour),
        box: await rowBox(row),
      }
      await figure.hover()
      const onFigure = {
        grounds: await cellGrounds(row),
        neighbour: await drawnGrounds(neighbour),
        box: await rowBox(row),
      }
      await note.hover()
      const onNote = { grounds: await cellGrounds(row), box: await rowBox(row) }
      // No day stays chosen on the page, since pressing one narrows the view to it: the row is
      // marked as the model marks a chosen row, to read the ground the model gives it.
      await row.evaluate((element) => element.classList.add('selected'))
      await pointAway(page)
      const chosen = {
        grounds: await cellGrounds(row),
        box: await rowBox(row),
        mark: await markIn(row),
      }
      await figure.hover()
      const chosenHover = { grounds: await cellGrounds(row), box: await rowBox(row) }
      await row.evaluate((element) => element.classList.remove('selected'))
      await pointAway(page)

      await record(info, `analytics day table grounds ${locale}`, {
        taskRest,
        taskHover,
        railHover,
        railChosen,
        rest,
        onFigure,
        onNote,
        chosen,
        chosenHover,
      })

      // At rest the day's cells are drawn as a task row's: its name as the task's name, its
      // figures as the task's figures.
      const [taskName, ...taskFigures] = taskRest
      const [dayName, ...dayFigures] = rest.grounds
      expect(dayName, "the day's name at rest").toBe(taskName)
      expect(new Set(dayFigures), "the day's figures at rest").toEqual(new Set(taskFigures))
      expect(new Set(taskHover), 'a hovered task row').toEqual(new Set([railHover]))
      for (const [state, grounds] of Object.entries({
        'the pointer on a figure': onFigure.grounds,
        'the pointer on the note': onNote.grounds,
      }))
        expect(grounds, `${state}: the whole row hovered`).toEqual(grounds.map(() => railHover))
      expect(onFigure.neighbour, 'the row under it, the pointer on its neighbour').toEqual(
        rest.neighbour,
      )
      for (const [state, grounds] of Object.entries({
        'chosen': chosen.grounds,
        'chosen under the pointer': chosenHover.grounds,
      }))
        expect(grounds, `${state}: the whole row chosen`).toEqual(grounds.map(() => railChosen))
      expect(railChosen, 'the chosen ground told from the hovered one').not.toBe(railHover)
      for (const [state, one] of Object.entries({ onFigure, onNote, chosen, chosenHover }))
        expect(one.box, `${state}: the row's box changed`).toEqual(rest.box)
      // The chosen row's mark stands inside its first cell, clear of the day's name.
      expect(chosen.mark, 'the chosen row has no mark').not.toBeNull()
      const none = { left: 0, right: 0, top: 0, bottom: 0 }
      const { mark, cell, name } = chosen.mark ?? { mark: none, cell: none, name: 0 }
      expect(mark.left, 'the mark past the cell').toBeGreaterThan(cell.left)
      expect(mark.right, 'the mark over the name').toBeLessThanOrEqual(name)
      expect(mark.top, 'the mark over the cell').toBeGreaterThan(cell.top)
      expect(mark.bottom, 'the mark under the cell').toBeLessThan(cell.bottom)
    })

    test("the keyboard's ring stands round the focused control's cell, inside it and the row, and moves with Tab", async ({
      page,
    }, info) => {
      const days = await open(page)
      const row = days
        .locator('tbody tr')
        .filter({ has: page.locator('th button') })
        .filter({ has: page.locator('[data-series]') })
        .first()
      const day = row.locator('th button')
      const figure = row.locator('[data-series]').first()
      await expect(figure).toBeVisible()
      await pointAway(page)
      const before = await rowBox(row)

      await tabOnto(page, day)
      const onDay = await ringsIn(row)
      const dayBox = await rowBox(row)
      // Tab goes on from the day to the row's first figure that acts, as it did.
      await page.keyboard.press('Tab')
      await expect(figure).toBeFocused()
      const onFigure = await ringsIn(row)
      const figureBox = await rowBox(row)
      await record(info, `analytics day table ring ${locale}`, {
        before,
        onDay,
        dayBox,
        onFigure,
        figureBox,
      })

      expectRingInCell(onDay, 'the day')
      expect(onDay.focused, "the day's cell").toBe(0)
      expectRingInCell(onFigure, 'a figure')
      expect(onFigure.focused, "a figure's cell").toBeGreaterThan(0)
      expect(dayBox, "focus on the day changed the row's box").toEqual(before)
      expect(figureBox, "focus on a figure changed the row's box").toEqual(before)
    })
  })
