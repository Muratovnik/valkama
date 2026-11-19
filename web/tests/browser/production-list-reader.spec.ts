/**
 * What the list gives a screen reader, in the built app, flat and grouped by goal:
 * Tab comes to the rows at one stop, not through each sort of the head, and the head
 * is reached from the rows by ↑; a fold by a press on a row's arrow, while focus is
 * on a row under it, moves focus to the row while it is open and folds it after, as
 * ← and ← do, the arrow taking no focus; and nothing in the list or around it listens
 * for a press but its controls, since Chromium names such an element clickable to a
 * reader, and the list's box was read as «clickable» before its table.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { installBackend } from './backend.ts'
import { boardRoute } from './boardPage.ts'
import { brief, identity, serveSpace, stateOf, stillFrames } from './longSpace.ts'
import { test } from './test.ts'

const VIEWS = [
  { name: 'flat', state: {}, stop: '.work-item-list tbody .list-open[tabindex="0"]' },
  { name: 'by goal', state: { group: 'goal' }, stop: '.work-item-list tbody tr[tabindex="0"]' },
] as const

function readerSpace() {
  return [
    brief(1, stateOf(1), { kind: 'goal', title: 'Launch' }),
    brief(2, stateOf(1), { title: 'Write the notes', parent_id: identity(1) }),
    brief(3, stateOf(1), { title: 'Tidy up' }),
  ]
}

async function open(page: Page, state: Record<string, unknown>) {
  await page.setViewportSize({ width: 1280, height: 900 })
  await installBackend(page)
  await serveSpace(page, readerSpace())
  await page.goto(boardRoute({ view: 'list', sort: 'reference', ...state }))
  await expect(page.locator('.work-item-list tbody tr.list-row').first()).toBeVisible()
  await stillFrames(page)
}

const inList = (page: Page) =>
  page.evaluate(() => document.activeElement?.closest('.work-item-list') !== null)
const rowOf = (page: Page, reference: string) =>
  page.locator(`.work-item-list tbody tr[data-reference="${reference}"]`)

/** Tab from the page's start until focus is in the list, as a reader comes to it. */
async function tabIntoList(page: Page) {
  for (let presses = 0; presses < 80 && !(await inList(page)); presses += 1)
    await page.keyboard.press('Tab')
}

const PRESS = new Set(['click', 'mousedown', 'mouseup', 'DOMActivate'])

/** The press listeners on `selector`'s element and every element above it, by depth. */
async function pressListeners(page: Page, selector: string): Promise<string[]> {
  const session = await page.context().newCDPSession(page)
  const depth = await page.evaluate((chosen) => {
    let count = 0
    for (let at = document.querySelector(chosen); at; at = at.parentElement) count += 1
    return count
  }, selector)
  const heard: string[] = []
  for (let up = 0; up < depth; up += 1) {
    const { result } = (await session.send('Runtime.evaluate', {
      expression: `(() => { let at = document.querySelector(${JSON.stringify(selector)}); for (let i = 0; i < ${up}; i += 1) at = at.parentElement; return at })()`,
    })) as { result: { objectId?: string } }
    if (!result.objectId) continue
    const { listeners } = (await session.send('DOMDebugger.getEventListeners', {
      objectId: result.objectId,
    })) as { listeners: { type: string }[] }
    for (const { type } of listeners) if (PRESS.has(type)) heard.push(`${up}:${type}`)
  }
  await session.detach()
  return heard
}

for (const view of VIEWS) {
  test(`Tab comes to the ${view.name} list's rows at one stop, and ↑ reaches the head`, async ({
    page,
  }) => {
    await open(page, view.state)
    await page.locator('body').focus()
    await tabIntoList(page)
    await expect(page.locator(view.stop)).toBeFocused()
    await page.keyboard.press('Tab')
    expect(await inList(page), 'the next Tab leaves the list').toBe(false)
    await page.keyboard.press('Shift+Tab')
    await expect(page.locator(view.stop)).toBeFocused()
    await page.keyboard.press('ArrowUp')
    await expect(page.locator('.work-item-list thead button').first()).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await expect(page.locator('.work-item-list thead button').nth(1)).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(page.locator(view.stop)).toBeFocused()
  })

  test(`nothing in or around the ${view.name} list listens for a press but its controls`, async ({
    page,
  }) => {
    await open(page, view.state)
    expect(await pressListeners(page, '.work-item-list table')).toEqual([])
    expect(await pressListeners(page, '.work-item-list tbody tr.list-row td')).toEqual([])
    // A press anywhere in a row still opens its card.
    await page.locator('.work-item-list tbody tr.list-row .list-title').last().click()
    await expect(page.locator('.drawer')).toHaveCount(1)
  })
}

test('a press on the arrow folds a goal as ← and ← do, focus on its open row first', async ({
  page,
}) => {
  await open(page, { group: 'goal' })
  await rowOf(page, 'MAIN-2').focus()
  await page.evaluate(() => {
    const seen: string[] = []
    ;(globalThis as unknown as { seen: string[] }).seen = seen
    document.addEventListener('focusin', (event) => {
      const target = event.target as HTMLElement
      const goal = document.querySelector('tbody tr[data-reference="MAIN-1"]')
      seen.push(
        `${target.dataset.reference ?? target.className}:${goal?.getAttribute('aria-expanded')}`,
      )
    })
  })
  await rowOf(page, 'MAIN-1').locator('.tree-toggle').click()
  await expect(rowOf(page, 'MAIN-1')).toHaveAttribute('aria-expanded', 'false')
  await expect(rowOf(page, 'MAIN-1')).toBeFocused()
  await expect(rowOf(page, 'MAIN-2')).toHaveCount(0)
  const seen = await page.evaluate(() => (globalThis as unknown as { seen: string[] }).seen)
  expect(seen).toEqual(['MAIN-1:true'])
})
