/**
 * What can be done to an entry of a discussion, in the built app: one quiet icon each, on the
 * line of its author and time, at every width and in both languages. A comment, a report, a
 * reply and a question all answer through the one Reply, and it leads to the one form.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { drawnColours } from './contrast.ts'
import { expectDateHeld } from './metaLine.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { asked, openQuestion, QUESTION_ID, routeField } from './questionBackend.ts'
import { test } from './test.ts'
import { reply, root, talkedOn } from './threadFixtures.ts'

const LONG = 'an-agent-with-a-remarkably-long-working-name-that-runs-past-the-line'
const ANSWERED_ID = '44444444-4444-4444-8444-444444444445'
const WORDS = {
  en: {
    cancel: 'Cancel',
    change: 'Change answer',
    expand: 'Expand',
    field: 'Your reply',
    outcome: 'Make task outcome',
    reopen: 'Reopen',
    reply: 'Reply',
    resolve: 'Resolve',
    resolved: 'Resolved ·',
  },
  ru: {
    cancel: 'Отмена',
    change: 'Изменить ответ',
    expand: 'Развернуть',
    field: 'Ваш ответ',
    outcome: 'Сделать итогом задачи',
    reopen: 'Снять отметку',
    reply: 'Ответить',
    resolve: 'Разобрано',
    resolved: 'Разобрано ·',
  },
} as const
type Locale = keyof typeof WORDS

const answered = asked({
  request_id: ANSWERED_ID,
  status: 'answered',
  fields: [routeField],
  answers: { route: 'move' },
  own: {},
  field_notes: {},
  note: null,
  answered_by: 'claude',
  by_person: false,
  resolved_at: '2026-10-24T12:00:00Z',
  revision: 2,
  answer_version: 1,
})

async function openDiscussion(page: Page, locale: Locale = 'en', width = 1280) {
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  await page.setViewportSize({ width, height: 900 })
  const opened = await openQuestion(page, [asked(), answered])
  opened.backend.item.comments.push(
    ...talkedOn(),
    root(40, 'Who wrote this?', { author: `${LONG} (session 019a2b3c-4d5e)` }),
    reply(41, 40, 'And this?', { author: `${LONG}-again (session 019a2b3c-4d5e)` }),
  )
  await page.reload()
  const { drawer } = opened
  await expect(drawer.locator('.thread-entry').first()).toBeVisible()
  await expect(drawer).toHaveCSS('transform', 'none')
  const threadOf = (text: string) => drawer.locator('.thread-entry').filter({ hasText: text })
  // By place, since the line this is known by goes away while its answer is being changed.
  const answeredQuestion = drawer.locator('.thread-question').nth(1)
  await expect(answeredQuestion.locator('.request-reply-meta')).toBeVisible()
  return {
    ...opened,
    words: WORDS[locale],
    threadOf,
    comment: threadOf('Should the second report'),
    resolvedThread: threadOf('The export leaves out'),
    report: threadOf('Shipped the export.'),
    waiting: drawer.locator('.thread-question').first(),
    answeredQuestion,
  }
}

const named = (scope: Locator, name: string) => scope.getByRole('button', { name, exact: true })

/** Every press an entry offers but the ones that only show more of what it says. */
const ownActions = (entry: Locator) =>
  entry.locator('button:not(.collapsible-toggle, .replies-toggle, .request-history-toggle)')

const glyph = (press: Locator) => press.locator('svg').evaluate((node) => node.innerHTML)

/** A press at each edge of the box lands on the box, so nothing lies over any of it. */
const answersAcross = (button: Locator) =>
  button.evaluate((node) => {
    node.scrollIntoView({ block: 'center', behavior: 'instant' })
    const box = node.getBoundingClientRect()
    const [middleX, middleY] = [box.left + box.width / 2, box.top + box.height / 2]
    const edges = [
      [box.left + 1, middleY],
      [box.right - 1, middleY],
      [middleX, box.top + 1],
      [middleX, box.bottom - 1],
    ] as const
    return edges.every(([x, y]) => node.contains(document.elementFromPoint(x, y)))
  })

async function expectIcons(actions: Locator, where: string) {
  const count = await actions.count()
  expect(count, `${where}: its actions`).toBeGreaterThan(0)
  for (const action of await actions.all()) {
    const look = await action.evaluate((node) => ({
      glyphs: node.querySelectorAll('svg').length,
      label: node.getAttribute('aria-label') ?? '',
      opacity: getComputedStyle(node).opacity,
      title: node.getAttribute('title') ?? '',
      words: node.textContent?.trim() ?? '',
    }))
    expect(look.words, `${where}: words on a press`).toBe('')
    expect(look.glyphs, `${where}: its glyph`).toBe(1)
    expect(look.label, `${where}: its name`).not.toBe('')
    expect(look.title, `${where}: ${look.label} under the pointer`).toBe(look.label)
    expect(look.opacity, `${where}: ${look.label} at rest`).toBe('1')
    await expect(action).toBeVisible()
  }
}

async function expectBoxes(actions: Locator, floor: number, where: string) {
  for (const action of await actions.all()) {
    await action.scrollIntoViewIfNeeded()
    const box = await action.boundingBox()
    const name = await action.getAttribute('aria-label')
    expect(box?.width ?? 0, `${where}: ${name} wide`).toBeGreaterThanOrEqual(floor)
    expect(box?.height ?? 0, `${where}: ${name} tall`).toBeGreaterThanOrEqual(floor)
    expect(await answersAcross(action), `${where}: ${name} answers across its box`).toBe(true)
  }
}

for (const locale of ['en', 'ru'] as const) {
  for (const width of [1280, 390]) {
    test(`${locale} at ${width}: an entry acts through icons alone, named and always there`, async ({
      page,
    }) => {
      const { answeredQuestion, comment, drawer, report, resolvedThread, waiting, words } =
        await openDiscussion(page, locale, width)
      await page.mouse.move(0, 0)
      await expectIcons(ownActions(comment), 'a comment')
      await expectIcons(ownActions(comment.locator('.reply')), 'a reply')
      await expectIcons(ownActions(report), 'a report')
      await expectIcons(ownActions(resolvedThread), 'a folded thread')
      await expectIcons(ownActions(answeredQuestion), 'an answered question')
      await expect(named(waiting, words.reply)).toBeVisible()
      await expectIcons(named(waiting, words.reply), 'a waiting question')
      await expect(named(drawer, words.change)).toHaveCount(1)
    })

    test(`${locale} at ${width}: the icons stand beside the author and the time, a long name or not`, async ({
      page,
    }) => {
      const { answeredQuestion, comment, drawer, threadOf, words } = await openDiscussion(
        page,
        locale,
        width,
      )
      const beside = async (meta: Locator, actions: Locator, where: string) => {
        await meta.scrollIntoViewIfNeeded()
        const line = await meta.boundingBox()
        expect(line, where).not.toBeNull()
        for (const action of await actions.all()) {
          const box = await action.boundingBox()
          const name = await action.getAttribute('aria-label')
          expect(box?.x ?? 0, `${where}: ${name} after the line`).toBeGreaterThanOrEqual(
            (line?.x ?? 0) + (line?.width ?? 0),
          )
          const top = box?.y ?? 0
          const bottom = top + (box?.height ?? 0)
          expect(top, `${where}: ${name} on the line`).toBeLessThan(
            (line?.y ?? 0) + (line?.height ?? 0),
          )
          expect(bottom, `${where}: ${name} on the line`).toBeGreaterThan(line?.y ?? 0)
        }
      }
      const long = threadOf('Who wrote this?')
      await beside(comment.locator('.thread-meta'), ownActions(comment).first(), 'a comment')
      await beside(long.locator('.thread-meta'), named(long, words.resolve), 'a long name')
      await beside(long.locator('.reply-meta'), ownActions(long.locator('.reply')), 'its reply')
      await beside(
        answeredQuestion.locator('.request-meta'),
        ownActions(answeredQuestion),
        'a question',
      )
      await expectDateHeld(long.locator('.thread-meta'), 'the long root')
      await expectDateHeld(long.locator('.reply-meta'), 'its reply')
      const overflow = await drawer.evaluate((node) => node.scrollWidth - node.clientWidth)
      expect(overflow).toBeLessThanOrEqual(0)
      await expectNoSilentClipping(page, 'the feed')
    })

    test(`${locale} at ${width}: a mark goes on and comes off through one icon`, async ({
      page,
    }) => {
      const { backend, comment, words } = await openDiscussion(page, locale, width)
      await named(comment, words.resolve).click()
      await expect(comment.locator('.resolve-form input')).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(comment).toHaveClass(/is-folded/u)
      await expect(comment.locator('.thread-mark')).toContainText(words.resolved)
      expect(backend.writes.at(-1)).toMatchObject({ comment_id: 3, resolution: '' })

      await expectIcons(ownActions(comment), 'a folded thread')
      // The fold's icon rises to where the mark's stood, and a press with no move between is
      // stopped there as stray; a person going for it moves.
      await page.mouse.move(0, 0)
      await named(comment, words.expand).click()
      const off = named(comment, words.reopen)
      await expect(off).toBeVisible()
      await expectIcons(off, 'the way out of the mark')
      await expect(comment.locator('.thread-mark')).toContainText(words.resolved)
      await off.click()
      await expect(named(comment, words.resolve)).toBeFocused()
      await expect(comment.locator('.thread-mark')).toHaveCount(0)
      expect(backend.writes.at(-1)).toMatchObject({ comment_id: 3, reopen: true })
    })
  }
}

test('at a fine pointer an icon clears 24px, and on a phone it takes the finger', async ({
  page,
}) => {
  const { answeredQuestion, comment, report } = await openDiscussion(page)
  expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(false)
  for (const entry of [comment, report, answeredQuestion])
    await expectBoxes(ownActions(entry), 24, 'a mouse')
  await page.setViewportSize({ width: 390, height: 900 })
  for (const entry of [comment, report, answeredQuestion])
    await expectBoxes(ownActions(entry), 44, 'a phone')
  await expectBoxes(ownActions(comment.locator('.reply')), 44, 'a reply on a phone')
})

test.describe('a coarse pointer on a wide screen', () => {
  test.use({ hasTouch: true })

  test('takes the finger too', async ({ page }) => {
    const { comment } = await openDiscussion(page)
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true)
    await expectBoxes(ownActions(comment), 44, 'touch at 1280')
  })
})

test('Reply is one press on every kind of entry, and leads to the one form', async ({ page }) => {
  const { answeredQuestion, comment, drawer, report, resolvedThread, waiting, words } =
    await openDiscussion(page)
  await expect(drawer.getByRole('button', { name: /in thread/u })).toHaveCount(0)
  await named(resolvedThread, 'Expand').click()
  const places: [string, Locator, Locator][] = [
    ['a comment', comment, named(comment, words.reply).first()],
    ['a reply', comment, named(comment.locator('.reply'), words.reply)],
    ['a report', report, named(report, words.reply)],
    ['a resolved comment', resolvedThread, named(resolvedThread, words.reply).first()],
    ['a waiting question', waiting, named(waiting, words.reply)],
    ['an answered question', answeredQuestion, named(answeredQuestion, words.reply)],
  ]
  for (const [where, thread, press] of places) {
    await press.click()
    const field = thread.getByRole('textbox', { name: words.field })
    await expect(field, where).toBeFocused()
    await expect(field, where).toBeInViewport()
    await expect(drawer.getByRole('textbox', { name: words.field }), where).toHaveCount(1)
    // Under what the thread has said, whichever entry was pressed.
    await expect(
      thread.locator('.thread-replies > .reply-composer:last-child'),
      where,
    ).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(field, where).toBeHidden()
    await expect(press, where).toBeFocused()
  }
})

test('a head with nothing to press gives its words the whole line', async ({ page }) => {
  const { resolvedThread, words } = await openDiscussion(page)
  await named(resolvedThread, words.expand).click()
  const edge = await named(resolvedThread, words.reopen).boundingBox()
  await named(resolvedThread, words.reply).first().click()
  // A form left open holds the fold, so the way to fold it stands aside.
  await expect(named(resolvedThread, 'Collapse')).toHaveCount(0)
  const line = await resolvedThread.locator('.thread-mark').boundingBox()
  expect((line?.x ?? 0) + (line?.width ?? 0)).toBeCloseTo((edge?.x ?? 0) + (edge?.width ?? 0), 0)
})

test('a press elsewhere in a thread with the form open goes back to the form and its words', async ({
  page,
}) => {
  const { comment, words } = await openDiscussion(page)
  await named(comment, words.reply).first().click()
  const field = comment.getByRole('textbox', { name: words.field })
  await page.keyboard.type('Words to keep')
  const under = named(comment.locator('.reply'), words.reply)
  await under.click()
  await expect(field).toBeFocused()
  await expect(field).toHaveValue('Words to keep')
  await expect(comment.getByRole('textbox', { name: words.field })).toHaveCount(1)
  // Back out through the question, and focus returns to what was pressed last.
  await comment.getByRole('button', { name: words.cancel, exact: true }).click()
  await comment.getByRole('button', { name: 'Discard draft', exact: true }).click()
  await expect(under).toBeFocused()
})

test('a reply goes to the root of its thread from wherever it was asked for', async ({ page }) => {
  const { backend, answeredQuestion, comment, requests, waiting, words } =
    await openDiscussion(page)
  const send = async (scope: Locator, press: Locator, body: string) => {
    await press.click()
    await page.keyboard.type(body)
    await page.keyboard.press('Control+Enter')
    await expect(scope.locator('.reply').filter({ hasText: body })).toBeFocused()
  }
  await send(comment, named(comment, words.reply).first(), 'To the comment')
  expect(backend.writes.at(-1)).toMatchObject({ body: 'To the comment', reply_to: 3 })
  await send(comment, named(comment.locator('.reply'), words.reply).first(), 'To the reply')
  expect(backend.writes.at(-1)).toMatchObject({ body: 'To the reply', reply_to: 3 })
  await send(waiting, named(waiting, words.reply), 'To the question')
  expect(backend.writes.at(-1)).toMatchObject({
    body: 'To the question',
    reply_to_request: QUESTION_ID,
  })
  await send(waiting, named(waiting.locator('.reply'), words.reply), 'To its reply')
  expect(backend.writes.at(-1)).toMatchObject({
    body: 'To its reply',
    reply_to_request: QUESTION_ID,
  })
  await send(answeredQuestion, named(answeredQuestion, words.reply), 'To the answered one')
  expect(backend.writes.at(-1)).toMatchObject({
    body: 'To the answered one',
    reply_to_request: ANSWERED_ID,
  })
  // A reply is said under a question, and answers none of it.
  expect(requests.writes).toEqual([])
})

test('an answer is changed from its icon, and the line it stands on does not move', async ({
  page,
}) => {
  const { answeredQuestion, words } = await openDiscussion(page)
  const change = named(answeredQuestion, words.change)
  // Across the line: the form taking focus scrolls the card, which moves all of it down the page.
  const across = async () => {
    const box = await answeredQuestion.locator('.request-meta .meta-when').boundingBox()
    return { x: box?.x, width: box?.width }
  }
  const before = await across()
  await change.click()
  await expect(answeredQuestion.getByRole('radio', { name: 'Move them' })).toBeFocused()
  await expect(change).toHaveCount(0)
  expect(await across()).toEqual(before)
  await named(answeredQuestion, words.cancel).click()
  await expect(change).toBeFocused()
  expect(await across()).toEqual(before)
})

test('a report is made the outcome from its icon', async ({ page }) => {
  const { backend, report, words } = await openDiscussion(page)
  await named(report, words.outcome).click()
  await expect(named(report, words.outcome)).toHaveCount(0)
  expect(backend.writes.at(-1)).toMatchObject({ comment_id: 10 })
})

test('one meaning draws one glyph, wherever it stands, and each meaning its own', async ({
  page,
}) => {
  const { comment, report, resolvedThread, waiting, words } = await openDiscussion(page)
  await named(resolvedThread, 'Expand').click()
  const replying = await glyph(named(comment, words.reply).first())
  for (const press of [
    named(comment.locator('.reply'), words.reply),
    named(report, words.reply),
    named(waiting, words.reply),
  ])
    expect(await glyph(press)).toBe(replying)
  const resolving = await glyph(named(comment, words.resolve))
  const reopening = await glyph(named(resolvedThread, words.reopen))
  expect(new Set([replying, resolving, reopening]).size).toBe(3)
})

test('an icon rests muted and brightens under the pointer and under the keys', async ({ page }) => {
  const { comment, words } = await openDiscussion(page)
  const press = named(comment, words.resolve)
  const ink = () => press.evaluate((node) => getComputedStyle(node).color)
  const ground = () => press.evaluate((node) => getComputedStyle(node).backgroundColor)
  await page.mouse.move(0, 0)
  const rest = await ink()
  expect(await ground()).toBe('rgba(0, 0, 0, 0)')
  // Muted is not faint: an icon that carries a meaning holds WCAG 1.4.11's 3:1.
  const { contrast } = await press.evaluate(drawnColours, 'own' as const)
  expect(contrast).toBeGreaterThanOrEqual(3)
  await press.hover()
  await expect.poll(ink).not.toBe(rest)
  await page.mouse.move(0, 0)
  await expect.poll(ink).toBe(rest)
  await named(comment, words.reply).first().focus()
  await page.keyboard.press('Tab')
  await expect(press).toBeFocused()
  await expect.poll(ink).not.toBe(rest)
})

for (const colorScheme of ['light', 'dark'] as const) {
  test(`an icon keeps its drawing, its edge and its ring in the ${colorScheme} forced palette`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme, forcedColors: 'active' })
    const { comment, words } = await openDiscussion(page)
    const press = named(comment, words.resolve)
    const look = () =>
      press.evaluate((node) => {
        const button = getComputedStyle(node)
        const glyph = getComputedStyle(node.querySelector('svg') as Element)
        return {
          background: button.backgroundColor,
          outline: `${button.outlineStyle} ${button.outlineWidth}`,
          stroke: glyph.stroke,
        }
      })
    const rest = await look()
    expect(rest.outline).toBe('solid 1px')
    // The drawing is in the colour of the words, and stands apart from the button's ground.
    expect(rest.stroke).not.toBe(rest.background)
    await named(comment, words.reply).first().focus()
    await page.keyboard.press('Tab')
    await expect(press).toBeFocused()
    const ringed = await look()
    expect(ringed.outline).toBe('solid 2px')
  })
}
