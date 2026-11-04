/**
 * The threads in the built app, driven with the keys: what the keyboard reaches and in
 * which order, where focus lands after a write, and how a thread holds up on a phone and
 * in a forced palette, none of which a component test can see.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { drawnColours } from './contrast.ts'
import { openCard } from './editorPage.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { asked, openQuestion, QUESTION_ID } from './questionBackend.ts'
import { test } from './test.ts'
import { reply, root, SETTLED, talkedOn } from './threadFixtures.ts'

async function openTalkedOn(page: Page, width = 1280) {
  await page.setViewportSize({ width, height: 900 })
  const opened = await openCard(page)
  opened.backend.item.comments.push(...talkedOn())
  await page.reload()
  await expect(opened.drawer.locator('.thread-entry').first()).toBeVisible()
  return opened
}

const threadOf = (drawer: Locator, text: string) =>
  drawer.locator('.thread-entry').filter({ hasText: text })
const focused = (page: Page) => page.locator(':focus')

for (const [size, width] of [
  ['1280', 1280],
  ['390', 390],
] as const) {
  test(`a reply goes from the keyboard at ${size}`, async ({ page }) => {
    const { backend, drawer } = await openTalkedOn(page, width)
    const thread = threadOf(drawer, 'Should the second report')
    await thread.focus()
    await page.keyboard.press('Tab')
    await expect(focused(page)).toHaveText('Reply')
    await page.keyboard.press('Tab')
    await expect(focused(page)).toHaveText('Resolve')
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Enter')
    const field = thread.getByRole('textbox', { name: 'Your reply' })
    await expect(field).toBeFocused()
    await expect(field).toBeInViewport()

    // Empty: Escape closes it, leaves the card, and comes back to the way in.
    await page.keyboard.press('Escape')
    await expect(field).toBeHidden()
    await expect(drawer).toBeVisible()
    await expect(focused(page)).toHaveText('Reply')

    await page.keyboard.press('Enter')
    await expect(field).toBeFocused()
    await page.keyboard.type('Beside it, then.')
    // With words in it: Escape asks about them where they are, and closes nothing, neither
    // the field nor the card, whose own question about leaving it stays down.
    await page.keyboard.press('Escape')
    await expect(field).toHaveValue('Beside it, then.')
    await expect(thread.locator('.confirm-strip')).toBeVisible()
    await expect(focused(page)).toHaveText('Keep writing')
    await expect(drawer.getByRole('button', { name: 'Keep editing', exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(thread.locator('.confirm-strip')).toHaveCount(0)
    await expect(field).toBeFocused()
    await expect(drawer).toBeVisible()

    await page.keyboard.press('Control+Enter')
    const written = thread.locator('.reply').filter({ hasText: 'Beside it, then.' })
    await expect(written).toBeFocused()
    await expect(field).toBeHidden()
    expect(backend.writes.at(-1)).toEqual({
      author: 'user',
      id: backend.item.work_item_id,
      body: 'Beside it, then.',
      reply_to: 3,
    })
    await expect(written.locator('.reply-meta')).toContainText('you')
    await expect(thread).not.toContainText('New reply')
    // The ring stands clear of the words and inside the replies' line, not on either.
    const ring = await written.evaluate((node) => {
      const style = getComputedStyle(node)
      const reach = Number.parseFloat(style.outlineOffset) + Number.parseFloat(style.outlineWidth)
      const line = node.parentElement?.getBoundingClientRect().left ?? 0
      return {
        gap: Number.parseFloat(style.outlineOffset),
        left: node.getBoundingClientRect().left - reach - line,
      }
    })
    expect(ring.gap).toBeGreaterThanOrEqual(4)
    expect(ring.left).toBeGreaterThanOrEqual(1)
  })

  test(`a mark goes from the keyboard and comes off again at ${size}`, async ({ page }) => {
    const { backend, drawer } = await openTalkedOn(page, width)
    const thread = threadOf(drawer, 'Should the second report')
    await thread.getByRole('button', { name: 'Resolve', exact: true }).focus()
    await page.keyboard.press('Enter')
    const field = thread.getByRole('textbox', { name: 'Decision (optional)' })
    await expect(field).toBeFocused()

    // Empty: Escape closes the line and comes back to the way in.
    await page.keyboard.press('Escape')
    await expect(field).toBeHidden()
    await expect(drawer).toBeVisible()
    await expect(focused(page)).toHaveText('Resolve')

    // With words in it, Escape asks as a reply's field does, and a second one keeps them.
    await page.keyboard.press('Enter')
    await page.keyboard.type('half a thought')
    await page.keyboard.press('Escape')
    const question = thread.locator('.confirm-strip')
    await expect(question).toContainText('Discard this draft decision?')
    await expect(focused(page)).toHaveText('Keep writing')
    await expect(field).toHaveValue('half a thought')
    await expect(drawer.getByRole('button', { name: 'Keep editing', exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(question).toHaveCount(0)
    await expect(field).toBeFocused()
    await expect(field).toHaveValue('half a thought')

    // Cancel asks the same, and the draft goes only on the answer that drops it.
    await thread.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(focused(page)).toHaveText('Keep writing')
    await thread.getByRole('button', { name: 'Discard draft', exact: true }).click()
    await expect(field).toBeHidden()
    await expect(focused(page)).toHaveText('Resolve')

    await page.keyboard.press('Enter')
    await expect(field).toHaveValue('')
    await page.keyboard.type('Beside it')
    await page.keyboard.press('Enter')
    const folded = drawer.getByRole('article', { name: /^Resolved · you · .* · Beside it/u })
    await expect(folded).toBeFocused()
    await expect(folded).toHaveClass(/is-folded/u)
    expect(backend.writes.at(-1)).toEqual({
      author: 'user',
      id: backend.item.work_item_id,
      comment_id: 3,
      resolution: 'Beside it',
    })
    await expect(folded.locator('.reply')).toHaveCount(0)
    await expect(folded.locator('.thread-first')).toContainText('Should the second report')
    await expect(folded.locator('.thread-first')).toHaveCSS('text-overflow', 'ellipsis')

    await page.keyboard.press('Tab')
    await expect(focused(page)).toHaveText('Expand')
    await expect(focused(page)).toHaveAttribute('aria-expanded', 'false')
    await page.keyboard.press('Enter')
    await expect(focused(page)).toHaveText('Collapse')
    await expect(focused(page)).toHaveAttribute('aria-expanded', 'true')
    await expect(folded.locator('.reply')).toHaveCount(1)

    await folded.getByRole('button', { name: 'Reopen', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(focused(page)).toHaveText('Resolve')
    expect(backend.writes.at(-1)).toEqual({
      author: 'user',
      id: backend.item.work_item_id,
      comment_id: 3,
      reopen: true,
    })
  })
}

test('the button for held replies stands before them and opens them on the first', async ({
  page,
}) => {
  const { drawer } = await openTalkedOn(page)
  const thread = threadOf(drawer, 'Four replies below')
  await thread.getByRole('button', { name: 'Resolve', exact: true }).focus()
  await page.keyboard.press('Tab')
  await expect(focused(page)).toHaveText('Show 2 more replies')
  await expect(focused(page)).toHaveAttribute('aria-expanded', 'false')
  await expect(thread.locator('.reply')).toHaveCount(2)
  await page.keyboard.press('Enter')
  await expect(thread.locator('.reply')).toHaveCount(4)
  await expect(thread.locator('.reply').first()).toBeFocused()
  await expect(thread.locator('.reply').first()).toContainText('First reply')
})

test('what opens more of a thread is lighter than what acts on it, and starts where its text does', async ({
  page,
}) => {
  const { backend, drawer } = await openTalkedOn(page)
  const long = Array.from({ length: 14 }, (_, at) => `Line ${at + 1} of a long root.`).join('\n\n')
  backend.item.comments.push(
    root(40, long),
    ...[41, 42, 43, 44].map((id) => reply(id, 40, `Reply ${id}.`)),
  )
  await page.reload()
  const thread = threadOf(drawer, 'Line 1 of a long root.')
  await expect(thread.locator('.reply')).toHaveCount(2)
  // Measured across several reads, so not while the drawer is still sliding in.
  await expect(drawer).toHaveCSS('transform', 'none')
  const look = (name: string) =>
    thread.getByRole('button', { name, exact: true }).evaluate((button) => {
      const range = document.createRange()
      range.selectNodeContents(button)
      const words = [...range.getClientRects()].find((rect) => rect.width > 0)
      return { ground: getComputedStyle(button).backgroundColor, words: words?.left ?? 0 }
    })
  const startOf = (selector: string) =>
    thread
      .locator(selector)
      .first()
      .evaluate((node) => node.getBoundingClientRect().left)
  const bare = 'rgba(0, 0, 0, 0)'
  // Raising the rest of a text or of a thread is a reading step; Reply and Resolve change it.
  const more = await look('Show all')
  const earlier = await look('Show 2 more replies')
  const replying = await look('Reply')
  const resolving = await look('Resolve')
  expect(more.ground).toBe(bare)
  expect(earlier.ground).toBe(bare)
  expect(replying.ground).not.toBe(bare)
  expect(resolving.ground).not.toBe(bare)
  expect(Math.abs(more.words - (await startOf('.thread-text')))).toBeLessThanOrEqual(1)
  expect(Math.abs(earlier.words - (await startOf('.thread-actions')))).toBeLessThanOrEqual(1)
})

test('a reply set aside for another thread comes back with its words', async ({ page }) => {
  const { drawer } = await openTalkedOn(page)
  const one = threadOf(drawer, 'Should the second report')
  const other = threadOf(drawer, 'Four replies below')
  await one.getByRole('button', { name: 'Reply', exact: true }).click()
  await page.keyboard.type('Words to keep')
  await other.getByRole('button', { name: 'Reply', exact: true }).click()
  await expect(drawer.getByRole('textbox', { name: 'Your reply' })).toHaveCount(1)
  await expect(one.locator('.thread-flag', { hasText: 'Draft' })).toBeVisible()
  await one.getByRole('button', { name: 'Reply', exact: true }).click()
  await expect(one.getByRole('textbox', { name: 'Your reply' })).toHaveValue('Words to keep')
  await expect(one.locator('.thread-flag', { hasText: 'Draft' })).toHaveCount(0)
})

test('Cancel asks before it drops a reply, with focus on the way back', async ({ page }) => {
  const { drawer } = await openTalkedOn(page)
  const thread = threadOf(drawer, 'Should the second report')
  await thread.getByRole('button', { name: 'Reply', exact: true }).click()
  await page.keyboard.type('Words')
  await thread.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(thread.getByRole('button', { name: 'Keep writing', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(thread.getByRole('textbox', { name: 'Your reply' })).toHaveValue('Words')
  await thread.getByRole('button', { name: 'Cancel', exact: true }).click()
  await thread.getByRole('button', { name: 'Discard draft', exact: true }).click()
  await expect(thread.getByRole('textbox', { name: 'Your reply' })).toBeHidden()
  await expect(focused(page)).toHaveText('Reply')
})

test('a reply whose mark failed stands, and the mark can be tried again', async ({ page }) => {
  const { backend, drawer } = await openTalkedOn(page)
  const thread = threadOf(drawer, 'Should the second report')
  await thread.getByRole('button', { name: 'Reply', exact: true }).click()
  await page.keyboard.type('Settled here')
  await thread.getByRole('checkbox', { name: 'Mark the thread resolved' }).check()
  backend.failNextMark()
  await thread.getByRole('button', { name: 'Send', exact: true }).click()
  const failed = thread.getByRole('alert')
  await expect(failed).toContainText('The reply was sent, but the thread could not be marked.')
  await expect(thread.locator('.reply').filter({ hasText: 'Settled here' })).toBeFocused()
  await failed.getByRole('button', { name: 'Mark again', exact: true }).click()
  await expect(failed).toBeHidden()
  await expect(
    drawer.getByRole('article', { name: /^Resolved · you/u }).filter({
      hasText: 'Should the second report',
    }),
  ).toHaveClass(/is-folded/u)
})

test('a refused reply keeps its words and offers the read', async ({ page }) => {
  const { backend, drawer } = await openTalkedOn(page)
  const thread = threadOf(drawer, 'Should the second report')
  await thread.getByRole('button', { name: 'Reply', exact: true }).click()
  await page.keyboard.type('Refused words')
  backend.failNextWrite()
  await page.keyboard.press('Control+Enter')
  await expect(thread.getByRole('alert')).toContainText('The task changed.')
  await expect(thread.getByRole('textbox', { name: 'Your reply' })).toHaveValue('Refused words')
  await thread.getByRole('button', { name: 'Refresh task', exact: true }).click()
  await expect(thread.getByRole('textbox', { name: 'Your reply' })).toHaveValue('Refused words')
})

test('a refused mark keeps its line, and focus stays in it', async ({ page }) => {
  const { backend, drawer } = await openTalkedOn(page)
  const thread = threadOf(drawer, 'Should the second report')
  await thread.getByRole('button', { name: 'Resolve', exact: true }).click()
  await page.keyboard.type('A decision')
  backend.failNextMark()
  await page.keyboard.press('Enter')
  await expect(thread.getByRole('alert')).toBeVisible()
  const field = thread.getByRole('textbox', { name: 'Decision (optional)' })
  await expect(field).toBeFocused()
  await expect(field).toHaveValue('A decision')
})

test('the unresolved view counts, hides and brings back, and is the same after a reload', async ({
  page,
}) => {
  const { drawer } = await openTalkedOn(page)
  const heading = drawer.locator('.section-header').filter({ hasText: 'Discussion' })
  await expect(heading).toContainText('3 unresolved')
  const view = drawer.getByRole('radiogroup', { name: 'Threads to show' })
  const all = view.getByRole('radio', { name: 'All', exact: true })
  const open = view.getByRole('radio', { name: 'Unresolved 3' })
  // One Tab stop, on the choice, and the arrows move focus and the choice together.
  await expect(all).toHaveAttribute('tabindex', '0')
  await expect(open).toHaveAttribute('tabindex', '-1')
  await all.focus()
  await page.keyboard.press('ArrowRight')
  await expect(open).toBeFocused()
  await expect(open).toHaveAttribute('aria-checked', 'true')
  await expect(drawer.getByRole('article', { name: /^Resolved/u })).toHaveCount(0)
  await expect(drawer.locator('.thread-hidden')).toContainText('1 resolved thread hidden')
  await expect(heading).toContainText('3 unresolved')

  await page.reload()
  await expect(open).toHaveAttribute('aria-checked', 'true')
  await expect(drawer.locator('.thread-hidden')).toBeVisible()

  await drawer.getByRole('button', { name: 'Show all', exact: true }).click()
  const back = drawer.getByRole('article', { name: /^Resolved/u })
  await expect(back).toBeFocused()
  await expect(all).toHaveAttribute('aria-checked', 'true')
})

test('the unresolved count is what the view shows, a waiting question among it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  const { backend, card, drawer } = await openQuestion(page, [asked()])
  backend.item.comments.push(...talkedOn())
  await page.reload()
  await expect(card).toBeVisible()
  const heading = drawer.locator('.section-header').filter({ hasText: 'Discussion' })
  await expect(heading).toContainText('5 threads · 4 unresolved')
  const open = drawer.getByRole('radio', { name: 'Unresolved 4' })
  await open.click()
  await expect(drawer.locator('.thread > li')).toHaveCount(4)
  await expect(drawer.locator('.thread-hidden')).toContainText('1 resolved thread hidden')
})

test('a question keeps its answer apart from what is said under it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 })
  const { backend, card, drawer, requests } = await openQuestion(page, [asked()])
  await expect(card).toBeVisible()
  await drawer.getByRole('button', { name: 'Reply in thread', exact: true }).click()
  await expect(drawer.getByRole('checkbox', { name: 'Mark the thread resolved' })).toHaveCount(0)
  await page.keyboard.type('Which comments?')
  await page.keyboard.press('Control+Enter')
  const written = drawer.locator('.thread-question .reply').filter({ hasText: 'Which comments?' })
  await expect(written).toBeFocused()
  expect(backend.writes.at(-1)).toEqual({
    author: 'user',
    id: backend.item.work_item_id,
    body: 'Which comments?',
    reply_to_request: QUESTION_ID,
  })
  expect(requests.writes).toEqual([])
  await expect(card.getByRole('button', { name: 'Send', exact: true })).toBeVisible()
})

test.describe('on a phone in Russian', () => {
  test.use({ locale: 'ru-RU' })

  test('every state of a thread fits its width, its words whole', async ({ page }) => {
    const { backend, drawer } = await openTalkedOn(page, 390)
    backend.item.comments.push(
      root(30, 'Очень-длинное-слово-без-пробелов-которое-не-должно-раздвинуть-карточку'.repeat(3)),
      reply(31, 30, 'ответ-без-пробелов'.repeat(12)),
    )
    await page.reload()
    await expect(drawer.getByRole('radiogroup', { name: 'Какие ветки показывать' })).toBeVisible()
    const thread = threadOf(drawer, 'Должно-раздвинуть'.toLowerCase()).first()
    const fits = async (where: string) => {
      await expectNoSilentClipping(page, where)
      const overflow = await drawer.evaluate((node) => node.scrollWidth - node.clientWidth)
      expect(overflow, where).toBeLessThanOrEqual(0)
    }
    await fits('the feed')
    await thread.getByRole('button', { name: 'Ответить', exact: true }).click()
    await fits('a reply being written')
    await thread.getByRole('button', { name: 'Разобрано', exact: true }).click()
    await fits('a mark being written')
    const form = await thread.locator('.resolve-form').boundingBox()
    const box = await thread.boundingBox()
    expect(form?.width ?? 0).toBeLessThanOrEqual(box?.width ?? 0)
    await drawer.getByRole('radio', { name: /^Неразобранные/u }).click()
    await fits('the unresolved view')
    await expect(drawer.locator('.thread-hidden')).toContainText('Скрыта 1 разобранная ветка')
    await drawer.getByRole('button', { name: 'Показать все', exact: true }).click()
    await fits('a folded thread')
    await expect(
      drawer.getByRole('article', { name: new RegExp(`^Разобрано · вы .*${SETTLED}`, 'u') }),
    ).toBeVisible()
  })
})

test('what a folded thread says reads at 4.5:1', async ({ page }) => {
  const { drawer } = await openTalkedOn(page)
  const folded = drawer.getByRole('article', { name: /^Resolved/u })
  const readable = async (selector: string) => {
    const colours = await folded
      .locator(selector)
      .first()
      .evaluate(drawnColours, 'own' as const)
    expect(colours.contrast, selector).toBeGreaterThanOrEqual(4.5)
  }
  await readable('.thread-mark')
  await readable('.thread-first')
  await readable('.thread-first-meta')
  await readable('.thread-flag')
})

for (const colorScheme of ['light', 'dark'] as const) {
  test(`a thread's edge survives the ${colorScheme} forced palette`, async ({ page }) => {
    await page.emulateMedia({ colorScheme, forcedColors: 'active' })
    // The pressed segment beside it is held by `production-forced-states.spec.ts`, which reads
    // the painted pixels: a computed ground names the colour asked for, not the one painted.
    const { drawer } = await openTalkedOn(page)
    const edge = await drawer
      .getByRole('article', { name: /^Resolved/u })
      .evaluate((node) => getComputedStyle(node).outlineStyle)
    expect(edge).toBe('solid')
  })
}
