/**
 * The list in the built application: the title takes the width the other
 * columns leave and nothing is pushed past the right edge at any width, the
 * columns that give way on a narrow list are folded under the title rather
 * than cut, the head stays one line at every width, and the rows are one Tab
 * stop walked with the arrows and the page keys and opened by a click anywhere.
 * The oracle for which columns stand is the list's rule in DESIGN.md («Work»): the
 * widest fit whose table the list holds, the title keeping 36 characters and its
 * heading one line in every fit but the narrowest.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { installBackend } from './backend.ts'
import { boardRoute, openList, serve, shot } from './boardPage.ts'
import { brief, identity, serveSpace, stateOf, stillFrames } from './longSpace.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { test } from './test.ts'

// The scroll bars are drawn, as the reader sees them: hidden, a list was 10px wider.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } })

/** How many characters of its own font the first title's cell is wide. */
const titleCharacters = (list: Locator) =>
  list.evaluate((element) => {
    const title = element.querySelector<HTMLElement>('tbody .list-title')
    const probe = document.createElement('span')
    probe.style.cssText = 'position:absolute;visibility:hidden;inline-size:1ch'
    title?.append(probe)
    const characters =
      (title?.getBoundingClientRect().width ?? 0) / probe.getBoundingClientRect().width
    probe.remove()
    return characters
  })

// Where the state, the priority and the holder fold, the folded sorts are one choice: as a
// run of buttons after the title's they took three lines of a phone's head, and a second
// line of the head at 1024px once «Steps» became «Conditions». At 1280px two fold, a run
// that holds one line.
for (const [width, headings, foldedSorts, choice] of [
  [
    1440,
    ['Ref', 'Title', 'Goal and stage', 'State', 'Priority', 'Assignee', 'Conditions', 'Updated'],
    0,
    false,
  ],
  [1280, ['Ref', 'Title', 'State', 'Priority', 'Assignee', 'Conditions', 'Updated'], 1, false],
  [1024, ['Ref', 'Title', 'Conditions', 'Updated'], 0, true],
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
  // The sorts are no Tab stops: ↑ from the first row reaches them, and ↓ comes back.
  await expect(page.locator('.work-item-list thead .list-sort:not([tabindex="-1"])')).toHaveCount(0)
  await rows.first().focus()
  await page.keyboard.press('ArrowUp')
  await expect(page.locator('.work-item-list thead .list-sort').first()).toBeFocused()
  await page.keyboard.press('ArrowDown')
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
  // The list opens in the queue's order, which no column names; Updated is folded here and
  // reads newest first when chosen.
  await expect(choice).toHaveText('Order')
  const option = (name: string) => page.getByRole('option', { name, exact: true })
  await choice.click()
  await option('Updated').click()
  await expect(choice).toHaveText('Updated')
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

/** What the title keeps in a fit: 36 characters, but in the narrowest, which gives way to none. */
const leastCharacters = (fit: string | undefined) => (fit === 'narrow' ? 0 : 36)

/** The fits from the one that stands every column to the narrowest. */
const FITS = ['full', 'wide', 'medium', 'narrow']

/**
 * The list at each of `sizes` pixels of its own, a frame apart: its fit, how it stands, and
 * what the fit's table needs, the other columns as drawn and the title its 36 characters or
 * its heading on one line, whichever is wider.
 */
const walk = (list: Locator, sizes: readonly number[]) =>
  list.evaluate(async (element, widths) => {
    const seen = []
    for (const size of widths) {
      element.style.inlineSize = `${size}px`
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
      const title = element.querySelector<HTMLElement>('tbody .list-title')
      const probe = document.createElement('span')
      probe.style.cssText = 'position:absolute;visibility:hidden;inline-size:36ch'
      title?.append(probe)
      const least = probe.getBoundingClientRect().width
      probe.remove()
      const [others, run] = [
        element.querySelectorAll('thead th:not(.list-head-title)'),
        element.querySelector('thead .list-head-title .list-sorts')?.children ?? [],
      ].map((parts) =>
        [...parts].reduce((sum, part) => sum + part.getBoundingClientRect().width, 0),
      )
      seen.push({
        size,
        room: element.clientWidth,
        fit: element.dataset.fit ?? '',
        overflow: element.scrollWidth - element.clientWidth,
        head: element.querySelector('thead')?.getBoundingClientRect().height ?? 0,
        characters: ((title?.getBoundingClientRect().width ?? 0) * 36) / least,
        need: others + Math.max(least, run),
      })
    }
    return seen
  }, sizes)

// In both languages, so a longer word for a heading in either shows here: «Conditions» took
// the title of a list 900px wide down to 35.6 characters in English and «Условия» to 34.2.
for (const [locale, workable, goal] of [
  ['en', 'Workable', 'Goal and stage'],
  ['ru', 'Можно брать', 'Цель и этап'],
] as const)
  test(`each fit stands down to what its table needs in ${locale}, the references align and nobody reads as workable`, async ({
    page,
  }, info) => {
    await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
    await page.setViewportSize({ width: 1600, height: 800 })
    await installBackend(page)
    await serve(page)
    await openList(page)
    const list = page.locator('.work-item-list')
    await expect(list.locator('tbody tr').first()).toBeVisible()
    const sizes = Array.from({ length: 101 }, (_, at) => 1400 - at * 10)
    const seen = await walk(list, sizes)
    for (const at of seen) {
      const said = `${at.size}px of list, ${at.fit}`
      expect(at.overflow, `${said}: nothing past the right edge`).toBeLessThanOrEqual(0)
      expect(at.head, `${said}: the head is one line`).toBeLessThanOrEqual(41)
      expect(at.characters, said).toBeGreaterThanOrEqual(leastCharacters(at.fit))
    }
    // Narrower, the list only folds more, each fit in turn, and a fit gives way only where
    // the room is less than its table needs.
    const turns = seen.slice(1).filter((at, index) => at.fit !== seen[index].fit)
    expect([seen[0].fit, ...turns.map((at) => at.fit)]).toEqual(FITS)
    for (const at of turns) {
      const before = seen[seen.indexOf(at) - 1]
      expect(before.need, `${before.fit} gives way at ${at.size}px`).toBeGreaterThan(at.room)
    }
    // As wide again, every column stands again, «Goal and stage» after the title.
    await walk(list, [1400])
    await expect(list).toHaveAttribute('data-fit', 'full')
    await expect(list.locator('thead th .list-sort:not(.folded)').nth(2)).toHaveText(goal)
    // The widest list that folds «Goal and stage» alone.
    const wide = seen.find((at) => at.fit === 'wide')?.size ?? 0
    await walk(list, [wide])
    await expect(list).toHaveAttribute('data-fit', 'wide')
    const measured = await list.evaluate((element) => {
      const starts = [...element.querySelectorAll('tbody .list-open')].map((open) =>
        Math.round(open.getBoundingClientRect().left),
      )
      const glyphs = [...element.querySelectorAll('tbody .list-ref-cell')].map(
        (cell) => cell.querySelectorAll('.facet-glyph').length,
      )
      return { starts: [...new Set(starts)], glyphs: [...new Set(glyphs)] }
    })
    // A row says its priority once: while its column is shown, the column says the
    // word in its tone, and the reference leads with the kind alone.
    const priority = await list.evaluate((element) =>
      [...element.querySelectorAll('tbody tr')].map((row) => {
        const column = row.querySelector<HTMLElement>(
          'td:not(.list-ref-cell) .facet-mark[data-facet="priority"]',
        )
        return {
          glyphs: row.querySelectorAll('.facet-mark[data-facet="priority"] .facet-glyph').length,
          tone: column?.dataset.tone ?? null,
          word: column ? getComputedStyle(column).color : null,
        }
      }),
    )
    expect(Math.max(...priority.map((row) => row.glyphs))).toBe(0)
    const hued = priority.filter((row) => row.tone === 'warning' || row.tone === 'danger')
    const plain = priority.find((row) => row.word && !hued.includes(row))
    expect(hued.length).toBeGreaterThan(0)
    for (const row of hued) expect(row.word).not.toBe(plain?.word)
    // Rows with and without glyphs, and every reference starts at one edge.
    expect(measured.glyphs.length).toBeGreaterThan(1)
    expect(measured.starts).toHaveLength(1)
    await expect(list.locator('tbody')).not.toContainText(workable)
    await expectNoSilentClipping(page, `list at ${wide}px of list in ${locale}`)
    await page.screenshot(shot(info, `w-list-wide-${locale}.png`))
  })

/** A state of the space's own workflow, named in a sentence. */
const CONFIRMING = {
  state_id: identity(950),
  key: 'confirming',
  name: 'Waiting for the owner to confirm',
  category: 'review',
  is_terminal: false,
}

/** Every condition met, which the column says in full. */
const MET = Array.from({ length: 24 }, (_, at) => ({
  id: identity(600 + at),
  text: `Condition ${at + 1}`,
  done: true,
  claimed_by: '',
  done_by: 'worker-a',
  by_previous_holder: false,
}))

/**
 * Words as long as a space's own: a state named in a sentence, long holders, a date of
 * last year, a long goal's path. Fixed widths chose the fit before, set for shorter words:
 * beside these the flat list of a 1280px window stood every column but two, left its title
 * a few characters and put its head on two lines.
 */
function longWords() {
  const items = [
    brief(1, stateOf(1), {
      kind: 'goal',
      title: 'A goal whose title runs on past what any title column of the list holds',
    }),
    brief(2, stateOf(2), {
      kind: 'stage',
      parent_id: identity(1),
      title: 'A stage named at length under that goal',
    }),
  ]
  for (let number = 3; number <= 10; number += 1)
    items.push(
      brief(number, stateOf(number), {
        parent_id: identity(2),
        ...(number % 2 ? { state: CONFIRMING } : {}),
        priority: number % 3 ? 'urgent' : 'high',
        claim_ref: `worker-${number} agent 0123456789abcdef (session ${identity(700 + number)})`,
        claim_state: 'live',
        checklist: MET,
        updated_at: `${new Date().getFullYear() - 1}-11-08T00:40:00Z`,
      }),
    )
  return items
}

/** The list of long words in a window `width` wide, in `locale`, by `group` or flat. */
async function openLong(page: Page, locale: string, width: number, group = '') {
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  await page.setViewportSize({ width, height: 800 })
  await installBackend(page)
  await serveSpace(page, longWords(), [], { states: [{ ...CONFIRMING, position: 6 }] })
  const grouped = group ? { group } : {}
  await page.goto(boardRoute({ view: 'list', sort: 'reference', ...grouped }))
  const list = page.locator('.work-item-list')
  await expect(list.locator('tbody tr').first()).toBeVisible()
  await stillFrames(page)
  return list
}

for (const locale of ['en', 'ru'] as const)
  for (const width of [1440, 1280, 1100, 1024, 760, 620, 390])
    test(`beside long words at ${width}px in ${locale} the head is one line and the title keeps 36 characters`, async ({
      page,
    }, info) => {
      const list = await openLong(page, locale, width)
      const drawn = await list.evaluate((element) => ({
        fit: (element as HTMLElement).dataset.fit,
        head: element.querySelector('thead')?.getBoundingClientRect().height ?? 0,
        overflow: element.scrollWidth - element.clientWidth,
      }))
      expect(drawn.head, `the head of a ${drawn.fit} list is one line`).toBeLessThanOrEqual(41)
      expect(drawn.overflow, 'nothing is pushed past the right edge').toBeLessThanOrEqual(0)
      expect(await titleCharacters(list)).toBeGreaterThanOrEqual(leastCharacters(drawn.fit))
      await page.screenshot(shot(info, `w-list-long-${width}-${locale}.png`))
    })

// The tree's lead and an urgent glyph widen the reference column of a phone's list until the
// title's heading cannot hold «Порядок» beside its sort: there the choice shows its chevron
// alone, its name the value assistive technology reads and its hint. Where the heading holds
// the name, it shows it, in English on a phone too.
for (const { bare, group, locale, name, width } of [
  { bare: true, group: 'goal', locale: 'ru', name: 'Порядок', width: 390 },
  { bare: false, group: 'goal', locale: 'ru', name: 'Порядок', width: 620 },
  { bare: false, group: 'goal', locale: 'en', name: 'Order', width: 390 },
  { bare: false, group: '', locale: 'ru', name: 'Порядок', width: 390 },
] as const)
  test(`the choice of order at ${width}px in ${locale} ${group || 'flat'}: bare ${bare}, the head one line`, async ({
    page,
  }, info) => {
    const list = await openLong(page, locale, width, group)
    const head = await list.locator('thead').boundingBox()
    expect(head?.height, 'the head is one line').toBeLessThanOrEqual(41)
    const choice = list.locator('thead .list-sort-choice')
    const value = choice.locator('.choice-value')
    expect(await choice.evaluate((element) => element.classList.contains('bare'))).toBe(bare)
    expect(await value.evaluate((element) => element.getBoundingClientRect().width > 1)).toBe(!bare)
    // Bare or not, the name stays the value assistive technology reads after the label.
    await expect(value).toHaveText(name)
    // Only a bare choice hints its name; a shown one says it on screen.
    await choice.locator('.choice-trigger').hover()
    await expect(page.getByRole('tooltip').filter({ hasText: name })).toHaveCount(Number(bare))
    await page.screenshot(shot(info, `w-list-choice-${group || 'flat'}-${width}-${locale}.png`))
  })
