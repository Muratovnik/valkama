import { expect } from '@playwright/test'

import {
  box,
  focusColour,
  linesTall,
  openCard,
  select,
  selection,
  settledBox,
} from './editorPage.ts'
import { planningSpace } from './planningFixtures.ts'
import { test } from './test.ts'

/**
 * The editor as a person meets it: one object, a field of the size it asked for,
 * and a toolbar that acts on the selection without taking it away.
 *
 * Undo, the caret and the layout are what a browser alone can show. What each
 * tool does to text in every case is `markdownEdits.test.ts`.
 */

for (const [name, on] of [
  ['Bold', '**один**\n**два**'],
  ['Italic', '*один*\n*два*'],
  ['Code', '`один`\n`два`'],
] as const) {
  test(`${name}, pressed twice on two selected lines, leaves them as they were`, async ({
    page,
  }) => {
    const { drawer, comment } = await openCard(page)
    await comment.click()
    await page.keyboard.insertText('один\nдва')
    await select(comment, 0, 'один\nдва'.length)
    const button = drawer.locator('.discussion-form').getByRole('button', { name, exact: true })
    await button.click()
    await expect(comment).toHaveValue(on)
    await button.click()
    await expect(comment).toHaveValue('один\nдва')
    expect(await selection(comment)).toEqual([0, 'один\nдва'.length])
  })
}

test('marks over a typed bold selection and over a list item leave what they should', async ({
  page,
}) => {
  const { drawer, comment } = await openCard(page)
  const bold = drawer.locator('.discussion-form').getByRole('button', { name: 'Bold', exact: true })
  const list = drawer
    .locator('.discussion-form')
    .getByRole('button', { name: 'Bulleted list', exact: true })

  // Marks typed around two lines and selected with them come off as one.
  await comment.click()
  await page.keyboard.insertText('**один\nдва**')
  await select(comment, 0, '**один\nдва**'.length)
  await bold.click()
  await expect(comment).toHaveValue('один\nдва')

  // A list item stays one: the marks go after its marker, and the list button still reads it.
  await comment.fill('- один')
  await select(comment, 0, '- один'.length)
  await bold.click()
  await expect(comment).toHaveValue('- **один**')
  await list.click()
  await expect(comment).toHaveValue('**один**')
})

test('a comment sent with its button leaves focus in the field, for the next one', async ({
  page,
}) => {
  const { drawer, comment } = await openCard(page)
  await comment.fill('A note')
  await drawer
    .locator('.discussion-form')
    .getByRole('button', { name: 'Add note', exact: true })
    .click()
  await expect(comment).toHaveValue('')
  await expect(comment).toBeFocused()
})

for (const width of [1680, 1024, 390]) {
  test(`the comment form is one object, with a field five lines tall, at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    const { drawer, comment } = await openCard(page)
    await expect(drawer.getByRole('button', { name: 'Work report' })).toHaveCount(0)
    await expect(drawer.getByRole('group', { name: 'What to publish' })).toHaveCount(0)
    await expect(drawer.getByRole('checkbox', { name: 'Make task outcome' })).toHaveCount(0)
    expect(await linesTall(comment)).toBe(5)

    // One frame around the toolbar, the text and the send; the text has no edge.
    const surface = drawer.locator('.discussion-form .markdown-surface')
    await expect(surface).toHaveCSS('border-top-width', '1px')
    await expect(comment).toHaveCSS('border-top-width', '0px')
    await expect(comment).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    const frame = await box(surface)
    const send = await box(surface.getByRole('button', { name: 'Add note', exact: true }))
    const tools = await box(surface.getByRole('group', { name: 'Formatting' }))
    const field = await box(comment)
    expect(tools.y + tools.height).toBeLessThanOrEqual(field.y)
    expect(field.y + field.height).toBeLessThanOrEqual(send.y)
    expect(send.y + send.height).toBeLessThanOrEqual(frame.y + frame.height)
    expect(frame.x + frame.width - (send.x + send.width)).toBeLessThanOrEqual(6)
    expect(Math.abs(field.width - (frame.width - 2))).toBeLessThan(1)

    // The frame's own edge takes the focus colour while the text has focus, and only
    // then, with no ring around the frame or the text.
    const resting = await surface.evaluate((node) => getComputedStyle(node).borderTopColor)
    await comment.focus()
    await expect(surface).toHaveCSS('border-top-color', await focusColour(page))
    await expect(surface).toHaveCSS('outline-style', 'none')
    await expect(comment).toHaveCSS('outline-style', 'none')
    await surface.getByRole('button', { name: 'Preview', exact: true }).focus()
    await expect(surface).toHaveCSS('border-top-color', resting)
  })
}

test('the field grows with its text to a ceiling, then scrolls inside, and the page stays put', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const { drawer, comment } = await openCard(page)
  const body = drawer.locator('.drawer-frame-body')
  const surface = drawer.locator('.discussion-form .markdown-surface')
  await surface.evaluate((element) => element.scrollIntoView({ block: 'start' }))
  const scroll = () => body.evaluate((element) => element.scrollTop)
  const before = await settledBox(surface)
  const scrolled = await scroll()

  await comment.click()
  await page.keyboard.type('one\ntwo\nthree\nfour\nfive')
  expect(await linesTall(comment)).toBe(5)
  await page.keyboard.type('\nsix\nseven\neight')
  expect(await linesTall(comment)).toBe(8)
  expect(await comment.evaluate((element) => element.scrollHeight - element.clientHeight)).toBe(0)
  const typed = await settledBox(surface)
  expect(typed.y).toBe(before.y)
  expect(await scroll()).toBe(scrolled)

  // 60% of this window, however long the text.
  await comment.fill(Array.from({ length: 60 }, (_, index) => `line ${index}`).join('\n'))
  const tall = await box(comment)
  expect(tall.height).toBe(600)
  expect(await comment.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
    true,
  )
  await comment.press('Control+End')
  const capped = await settledBox(surface)
  await page.keyboard.type('\nand on')
  expect(await settledBox(surface)).toEqual(capped)

  await comment.fill('')
  expect(await linesTall(comment)).toBe(5)
})

test('switching to preview moves nothing, and the caret and the history are there on the way back', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const { drawer, comment } = await openCard(page)
  const surface = drawer.locator('.discussion-form .markdown-surface')
  await comment.click()
  await page.keyboard.type('# Title\n\n- one\n- two\n\nA last line')
  await select(comment, 2, 7)
  const before = await settledBox(surface)

  await surface.getByRole('button', { name: 'Preview', exact: true }).click()
  await expect(surface.locator('.markdown-preview li')).toHaveCount(2)
  await expect(drawer.getByRole('textbox', { name: 'Comment', exact: true })).toHaveCount(0)
  expect(await settledBox(surface)).toEqual(before)

  await surface.getByRole('button', { name: 'Write', exact: true }).click()
  await expect(comment).toBeVisible()
  expect(await settledBox(surface)).toEqual(before)
  expect(await selection(comment)).toEqual([2, 7])
  await comment.focus()
  await page.keyboard.press('Control+z')
  await expect(comment).not.toHaveValue('# Title\n\n- one\n- two\n\nA last line')
})

test('a long preview scrolls inside the height the text had', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const { drawer, comment } = await openCard(page)
  const surface = drawer.locator('.discussion-form .markdown-surface')
  // Short to write and tall to read: every line of a table is a row of its own.
  await comment.fill(['| a |', '| - |', ...Array.from({ length: 12 }, () => '| 1 |')].join('\n'))
  const before = await settledBox(surface)
  await surface.getByRole('button', { name: 'Preview', exact: true }).click()
  const preview = surface.locator('.markdown-preview')
  await expect(preview.locator('tr')).toHaveCount(13)
  expect(await settledBox(surface)).toEqual(before)
  expect(await preview.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
    true,
  )
})

const TOOLS = [
  // What is pressed, on `a word here` with `word` selected, and at a caret after `a `.
  {
    name: 'Bold',
    selected: ['a **word** here', 4, 8],
    caret: ['a ****word here', 4, 4],
  },
  {
    name: 'Italic',
    selected: ['a *word* here', 3, 7],
    caret: ['a **word here', 3, 3],
  },
  {
    name: 'Code',
    selected: ['a `word` here', 3, 7],
    caret: ['a ``word here', 3, 3],
  },
  {
    name: 'Link',
    selected: ['a [word]() here', 9, 9],
    caret: ['a []()word here', 3, 3],
  },
  {
    name: 'Bulleted list',
    selected: ['- a word here', 0, 13],
    caret: ['- a word here', 4, 4],
  },
] as const

for (const tool of TOOLS) {
  test(`${tool.name} acts on the selection, or at the caret, and leaves the writing in the field`, async ({
    page,
  }) => {
    const { backend, drawer, comment } = await openCard(page)
    const button = drawer
      .locator('.discussion-form')
      .getByRole('button', { name: tool.name, exact: true })
    await comment.fill('a word here')
    await select(comment, 2, 6)
    // A press does not move focus, so the selection it acts on is still there.
    await button.click()
    await expect(comment).toBeFocused()
    await expect(comment).toHaveValue(tool.selected[0])
    expect(await selection(comment)).toEqual(tool.selected.slice(1))

    await comment.fill('a word here')
    await select(comment, 2, 2)
    await button.click()
    await expect(comment).toBeFocused()
    await expect(comment).toHaveValue(tool.caret[0])
    expect(await selection(comment)).toEqual(tool.caret.slice(1))

    // Reached by keyboard, it does the same and hands focus back to the text.
    await comment.fill('a word here')
    await select(comment, 2, 6)
    await button.focus()
    await page.keyboard.press('Enter')
    await expect(comment).toBeFocused()
    await expect(comment).toHaveValue(tool.selected[0])

    // A button in the form is not its submit.
    expect(backend.writes).toEqual([])
  })
}

test('Ctrl+Z takes back a toolbar action, and a chosen task, one step at a time', async ({
  page,
}) => {
  const { drawer, comment } = await openCard(page)
  const form = drawer.locator('.discussion-form')
  await page.route('**/api/planning/search?*', (route) =>
    route.fulfill({
      json: {
        interface_version: 'valkama-planning-api',
        work_items: [
          {
            work_item_id: '00000000-0000-4000-8000-000000000100',
            planning_space_id: planningSpace.planning_space_id,
            reference: 'MAIN-100',
            title: 'Parser',
            state: { name: 'Doing' },
            claim_ref: '',
          },
        ],
      },
    }),
  )
  await comment.click()
  await page.keyboard.type('a word')
  await select(comment, 2, 6)
  await form.getByRole('button', { name: 'Bold', exact: true }).click()
  await expect(comment).toHaveValue('a **word**')
  await form.getByRole('button', { name: 'Bold', exact: true }).click()
  await expect(comment).toHaveValue('a word')
  await page.keyboard.press('Control+z')
  await expect(comment).toHaveValue('a **word**')
  await page.keyboard.press('Control+z')
  await expect(comment).toHaveValue('a word')
  await expect(comment).toBeFocused()
  await page.keyboard.press('Control+y')
  await expect(comment).toHaveValue('a **word**')

  await comment.fill('See ')
  await select(comment, 4, 4)
  await page.keyboard.type('#Par')
  await page.getByRole('listbox', { name: 'Tasks' }).getByRole('option').first().click()
  await expect(comment).toHaveValue('See MAIN-100 ')
  await page.keyboard.press('Control+z')
  await expect(comment).toHaveValue('See #Par')
})

test('Ctrl+B and Ctrl+I work on a Russian layout, where the key says «и» and «ш»', async ({
  page,
}) => {
  const { comment } = await openCard(page)
  await comment.fill('слово')
  await select(comment, 0, 5)
  // Through the input pipeline, because a Latin keyboard cannot type this pair.
  const client = await page.context().newCDPSession(page)
  const press = async (key: string, code: string, windowsVirtualKeyCode: number) => {
    const event = { key, code, windowsVirtualKeyCode, modifiers: 2 }
    await client.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...event })
    await client.send('Input.dispatchKeyEvent', { type: 'keyUp', ...event })
  }
  await press('и', 'KeyB', 66)
  await expect(comment).toHaveValue('**слово**')
  await press('ш', 'KeyI', 73)
  await expect(comment).toHaveValue('***слово***')
})

const row = (number: number, title: string) => ({
  work_item_id: `00000000-0000-4000-8000-00000000010${number}`,
  planning_space_id: planningSpace.planning_space_id,
  reference: `MAIN-${number}`,
  title,
  state: { name: 'Doing' },
  claim_ref: '',
})

test('the mention button writes a # and opens the list a typed one opens, and a row is chosen from it', async ({
  page,
}) => {
  const { drawer, comment } = await openCard(page)
  const active: string[] = []
  await page.route('**/api/planning/work-items?*', (route) => {
    active.push(new URL(route.request().url()).search)
    return route.fulfill({
      json: {
        interface_version: 'valkama-planning-api',
        work_items: [row(1, 'Being worked on'), row(2, 'Also being worked on')],
      },
    })
  })
  const searched: (string | null)[] = []
  await page.route('**/api/planning/search?*', (route) => {
    searched.push(new URL(route.request().url()).searchParams.get('q'))
    return route.fulfill({
      json: { interface_version: 'valkama-planning-api', work_items: [row(3, 'The parser')] },
    })
  })
  const mention = drawer
    .locator('.discussion-form')
    .getByRole('button', { name: 'Link a task', exact: true })
  const list = page.getByRole('listbox', { name: 'Tasks' })

  // After a word, with what is selected left alone.
  await comment.fill('See word')
  await select(comment, 4, 8)
  await mention.click()
  await expect(comment).toHaveValue('See word #')
  await expect(comment).toBeFocused()
  await expect(list.getByRole('option')).toHaveCount(2)
  expect(active).toHaveLength(1)
  expect(active[0]).toContain('category=active')

  // Typing goes on narrowing the same list, and a press on a row writes it.
  await page.keyboard.type('par')
  await expect(list.getByRole('option')).toHaveCount(1)
  await expect(list.getByRole('option')).toContainText('MAIN-3')
  expect(searched).toEqual(['par'])
  await list.getByRole('option').first().click()
  await expect(comment).toHaveValue('See word MAIN-3 ')
  await expect(list).toHaveCount(0)
  await expect(comment).toBeFocused()

  // With nothing typed, the keys take a row just as well.
  await comment.fill('')
  await mention.click()
  await expect(comment).toHaveValue('#')
  await expect(list.getByRole('option')).toHaveCount(2)
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(comment).toHaveValue('MAIN-2 ')

  // Leaving the field takes the list with it.
  await comment.fill('')
  await mention.click()
  await expect(list).toBeVisible()
  await drawer.getByRole('heading', { name: /^Discussion/u }).click()
  await expect(list).toHaveCount(0)
})

test('the buttons are off in preview and while the text is being sent', async ({ page }) => {
  const { drawer, comment } = await openCard(page)
  const form = drawer.locator('.discussion-form')
  const tools = form.getByRole('group', { name: 'Formatting' }).getByRole('button')
  await expect(tools).toHaveCount(6)
  await comment.fill('A note')
  for (const tool of await tools.all()) await expect(tool).toBeEnabled()

  await form.getByRole('button', { name: 'Preview', exact: true }).click()
  for (const tool of await tools.all()) await expect(tool).toBeDisabled()
  await form.getByRole('button', { name: 'Write', exact: true }).click()

  const release: (() => void)[] = []
  const held = new Promise<void>((resolve) => release.push(resolve))
  await page.route('**/api/planning/work-item/comment', async (route) => {
    await held
    await route.fallback()
  })
  await comment.press('Control+Enter')
  for (const tool of await tools.all()) await expect(tool).toBeDisabled()
  await expect(comment).toBeDisabled()
  release[0]?.()
  await expect(comment).toHaveValue('')
  await expect(comment).toBeEnabled()
  // Disabling it dropped its focus, and whoever sent from the keyboard goes on from here.
  await expect(comment).toBeFocused()
})
