/**
 * No press on a question nobody has put anything into writes, whatever came to stand under
 * the pointer and whatever the pointer did before. Don't answer is two steps, with the way
 * back where the first press was, and Send with nothing in the form only says so. These
 * presses come from a real mouse.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import type { InputRequestField } from '@/shared/api/inputRequestModel.ts'

import { asRoot } from '../support/threads.ts'
import { centre } from './boardPage.ts'
import { openQuestion, question, send } from './questionBackend.ts'
import {
  answeredElsewhere,
  choices,
  closedElsewhere,
  decline,
  inCard,
  inReach,
  inTheList,
  LOWER,
  LOWER_DECLINE,
  pair,
  pause,
  press,
  under,
  UPPER,
  writesTo,
} from './questionPress.ts'
import { test } from './test.ts'

const ASKED = "The agent gets a refusal, and it can't be taken back."

const back = (scope: Locator) => scope.getByRole('button', { name: 'Back', exact: true })

test('a question rising under a pointer at rest takes nothing from the press that follows', async ({
  page,
}) => {
  const { at, next, requests, stream, top } = await inCard(page)
  await page.mouse.move(at.x, at.y)
  requests.settle(UPPER, closedElsewhere)
  await stream.signal('agents')
  await expect(top.locator('.request-state')).toBeVisible()
  await expect.poll(() => under(page, at)).toBe(LOWER_DECLINE)
  await press(page, at)
  await pause(150)
  expect(writesTo(requests)).toEqual([])
  await expect(back(next)).toBeFocused()
  await expect(next.getByText(ASKED, { exact: true })).toBeVisible()
  // Whatever came there, a second press only goes back.
  await press(page, at, 2)
  await expect(decline(next)).toBeFocused()
  await expect(next.getByRole('radio')).toHaveCount(3)
  expect(writesTo(requests)).toEqual([])
})

test('a new question arriving over a pointer at rest takes nothing from the press that follows', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1680, height: 1050 })
  const fields = [choices(2)]
  const { card, requests, stream } = await openQuestion(page, [
    question({ request_id: LOWER, prompt: 'The old question', fields }),
  ])
  const old = card.filter({ hasText: 'The old question' })
  const at = await inReach(decline(old))
  await page.mouse.move(at.x, at.y)
  requests.entries.push(
    question({
      request_id: UPPER,
      prompt: 'The new question',
      fields,
      created_at: '2026-10-24T11:00:00Z',
    }),
  )
  await stream.signal('agents')
  await expect(card).toHaveCount(2)
  await expect.poll(() => under(page, at)).toBe("The new question: Don't answer")
  await press(page, at)
  await pause(150)
  expect(writesTo(requests)).toEqual([])
})

for (const [hand, shift, wheel] of [
  ['shakes by 4 px', 4, 0],
  ['turns the wheel with nothing to scroll', 0, 1],
] as const) {
  test(`a hand that ${hand} between two presses on Don't answer only takes the step back`, async ({
    page,
  }) => {
    const { at, next, requests, top } = await inCard(page)
    await press(page, at)
    await page.mouse.wheel(0, wheel)
    await press(page, { x: at.x + shift, y: at.y })
    await pause(150)
    expect(writesTo(requests)).toEqual([])
    await expect(decline(top)).toBeVisible()
    await expect(next.getByRole('radio')).toHaveCount(3)
  })
}

const FORMS: { fields: InputRequestField[]; form: string; says: string }[] = [
  {
    form: 'one choice',
    fields: [{ ...choices(3), required: false }],
    says: 'Choose one of the options.',
  },
  {
    form: 'ticks',
    fields: [{ ...choices(3), type: 'multi_choice', required: false }],
    says: 'Tick at least one option.',
  },
  {
    form: 'words',
    fields: [{ id: 'words', label: 'Words', type: 'text', required: false, options: [] }],
    says: 'Write an answer.',
  },
  {
    form: 'yes or no',
    fields: [{ id: 'sure', label: 'Sure', type: 'boolean', required: false, options: [] }],
    says: 'Choose Yes or No.',
  },
  {
    form: 'several fields',
    fields: [
      { ...choices(2), required: false },
      { id: 'sure', label: 'Sure', type: 'boolean', required: false, options: [] },
    ],
    says: 'Choose one of the options.',
  },
]

for (const { fields, form, says } of FORMS) {
  test(`Send with nothing chosen or written says so and writes nothing: ${form}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1680, height: 1050 })
    const { card, requests } = await openQuestion(page, [
      question({ request_id: UPPER, prompt: 'Anything to add?', fields }),
    ])
    const at = await inReach(send(card))
    await press(page, at)
    await press(page, at, 2)
    await pause(150)
    expect(writesTo(requests)).toEqual([])
    await expect(card.getByText(says, { exact: true })).toBeVisible()
    await expect(card.locator('.request-state')).toHaveCount(0)
  })
}

test('spaces in the comment are nothing written, and words are', async ({ page }) => {
  await page.setViewportSize({ width: 1680, height: 1050 })
  const { card, requests } = await openQuestion(page, [
    question({
      request_id: UPPER,
      prompt: 'Anything to add?',
      fields: [{ ...choices(2), required: false }],
    }),
  ])
  await card.getByRole('button', { name: 'Comment on the question', exact: true }).click()
  await page.keyboard.insertText('   ')
  await send(card).click()
  await pause(150)
  expect(writesTo(requests)).toEqual([])
  await card.getByRole('textbox', { name: 'Comment on the question', exact: true }).fill('A word')
  await send(card).click()
  await expect(card.locator('.request-reply')).toContainText('A word')
  expect(writesTo(requests)).toEqual([UPPER])
})

for (const gap of [180, 350]) {
  test(`a double press on Don't answer ${gap} ms apart takes the step back and writes nothing`, async ({
    page,
  }) => {
    const { at, requests, top } = await inCard(page)
    await press(page, at)
    await expect(back(top)).toBeFocused()
    await pause(gap)
    await expect.poll(() => under(page, at)).toBe('The upper question: Back')
    await press(page, at, 2)
    await pause(150)
    expect(writesTo(requests)).toEqual([])
    await expect(decline(top)).toBeFocused()
    await expect(top.getByText(ASKED, { exact: true })).toHaveCount(0)
    await expect(top.getByRole('radio')).toHaveCount(6)
  })
}

test('going ahead by hand writes once, and a second press there reaches nothing', async ({
  page,
}) => {
  const { at, next, requests, top } = await inCard(page)
  await press(page, at)
  const onward = await centre(decline(top))
  await press(page, onward)
  await expect(top.locator('.request-state')).toContainText('You declined')
  await press(page, onward, 2)
  await pause(150)
  expect(writesTo(requests)).toEqual([UPPER])
  expect(requests.writes[0]?.action).toBe('decline')
  await expect(next.getByRole('radio')).toHaveCount(3)
})

test('the keys take the same two steps, and Escape goes back without closing the card', async ({
  page,
}) => {
  const { drawer, requests, top } = await inCard(page)
  await decline(top).focus()
  await page.keyboard.press('Enter')
  await expect(back(top)).toBeFocused()
  await expect(top.getByRole('alert')).toHaveText(ASKED)
  await page.keyboard.press('Enter')
  await expect(decline(top)).toBeFocused()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')
  await expect(decline(top)).toBeFocused()
  await expect(drawer).toBeVisible()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Tab')
  await expect(decline(top)).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(top.getByText(ASKED, { exact: true })).toHaveCount(0)
  await expect(decline(top)).toBeFocused()
  await expect(drawer).toBeVisible()
  expect(writesTo(requests)).toEqual([])
  await page.keyboard.press('Enter')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await expect(top.locator('.request-state')).toBeFocused()
  expect(writesTo(requests)).toEqual([UPPER])
  // With nothing being asked, Escape is the card's again.
  await page.keyboard.press('Escape')
  await expect(drawer).toHaveCount(0)
})

test('choosing or writing takes the step back, so that the place of Send sends again', async ({
  page,
}) => {
  const { at, card, requests, top } = await inCard(page)
  await press(page, at)
  await expect(back(top)).toBeVisible()
  await top.getByRole('radio', { name: 'Choice 2', exact: true }).click()
  await expect(back(top)).toHaveCount(0)
  await expect(send(top)).toBeVisible()
  // Opening the comment moves the buttons, which ends the step by itself.
  await press(page, await inReach(decline(top)))
  await expect(back(top)).toBeVisible()
  await top.getByRole('button', { name: 'Comment on the question', exact: true }).click()
  await expect(back(top)).toHaveCount(0)
  await press(page, await inReach(decline(top)))
  await expect(back(top)).toBeVisible()
  await top.getByRole('textbox', { name: 'Comment on the question', exact: true }).focus()
  await expect(back(top)).toBeVisible()
  await page.keyboard.insertText('A word')
  await expect(back(top)).toHaveCount(0)
  await send(top).click()
  await expect(top.locator('.request-reply')).toContainText('A word')
  expect(requests.writes.map((write) => write.action)).toEqual(['answer'])
  await expect(card).toHaveCount(2)
})

test('an answer arriving from elsewhere ends the step along with the question', async ({
  page,
}) => {
  const { at, requests, stream, top } = await inCard(page)
  await press(page, at)
  await expect(back(top)).toBeVisible()
  requests.settle(UPPER, answeredElsewhere)
  await stream.signal('agents')
  await expect(top.locator('.request-state')).toBeFocused()
  await expect(back(top)).toHaveCount(0)
  await expect(decline(top)).toHaveCount(0)
  await expect(top.getByRole('radio')).toHaveCount(0)
  expect(writesTo(requests)).toEqual([])
})

test('in the list of everything waiting it takes the same two steps', async ({ page }) => {
  await page.setViewportSize({ width: 1680, height: 1050 })
  const opened = await openQuestion(page, pair(6, 3))
  const { dialog, next, top } = await inTheList(page, opened)
  const at = await inReach(decline(top))
  await press(page, at)
  await press(page, at, 2)
  await pause(150)
  expect(writesTo(opened.requests)).toEqual([])
  await expect(decline(top)).toBeFocused()
  await press(page, at)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  await expect(decline(top)).toBeFocused()
  await press(page, at)
  await press(page, await centre(decline(top)))
  await expect(top.locator('.request-state')).toContainText('You declined')
  expect(writesTo(opened.requests)).toEqual([UPPER])
  await expect(next.getByRole('radio', { checked: true })).toHaveCount(0)
})

/** The foot's last two buttons, by place, for the same check in every language. */
const slots = (card: Locator) => {
  const buttons = card.locator('.request-actions button')
  return [buttons.nth(-2), buttons.nth(-1)] as const
}

async function boxes(card: Locator) {
  const [wayOut, onward] = slots(card)
  return {
    fields: await card.locator('.request-fields').boundingBox(),
    onward: await onward.boundingBox(),
    wayOut: await wayOut.boundingBox(),
  }
}

const LIST_TITLE = { en: 'Needs my answer', ru: 'Ждут моего ответа' }

for (const [width, height] of [
  [1680, 1050],
  [1024, 768],
  [390, 844],
] as const) {
  for (const locale of ['en', 'ru'] as const) {
    test(`at ${width} in ${locale} the way back takes the very box of the first press, and nothing moves`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height })
      await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
      const opened = await openQuestion(page, pair(5, 2))
      const inDrawer = opened.card.first()
      const [wayOut] = slots(inDrawer)
      await inReach(wayOut)
      const before = await boxes(inDrawer)
      await wayOut.click()
      // At the foot of the view too, since it takes no room to stand in.
      await expect(inDrawer.getByRole('alert')).toBeInViewport({ ratio: 1 })
      expect(await boxes(inDrawer)).toEqual(before)
      await page.keyboard.press('Escape')
      expect(await boxes(inDrawer)).toEqual(before)
      const { dialog, top } = await inTheList(page, opened, LIST_TITLE[locale])
      await expect(dialog).toHaveCSS('transform', 'none')
      const [inList] = slots(top)
      await inReach(inList)
      const listed = await boxes(top)
      await inList.click()
      await expect(top.getByRole('alert')).toBeInViewport({ ratio: 1 })
      expect(await boxes(top)).toEqual(listed)
    })
  }
}

async function reportUnder(page: Page, options: number) {
  await page.setViewportSize({ width: 390, height: 844 })
  const opened = await openQuestion(page, [
    question({ request_id: UPPER, prompt: 'The only question', fields: [choices(options)] }),
  ])
  opened.backend.item.comments.push({
    id: 901,
    kind: 'report',
    ...asRoot,
    author: 'codex',
    at: '2020-01-01T10:00:00Z',
    body: '',
    report: { done: 'Something done', next: 'Something next' },
    checklist_item_id: null,
    checklist_item_text: null,
  })
  await opened.stream.signal('agents')
  await expect(opened.drawer.getByRole('button', { name: /outcome/u })).toBeVisible()
  const top = opened.card
  const { y } = await inReach(decline(top))
  // The button stands at the card's left, which the foot's way out reaches with its left end.
  const box = await decline(top).boundingBox()
  return { ...opened, at: { x: (box?.x ?? 0) + 10, y }, top }
}

const OUTCOME_OPTIONS = 2

test('a second press lands on nothing in the thread, such as a report rising under it on a phone', async ({
  page,
}) => {
  const { at, backend, requests, stream, top } = await reportUnder(page, OUTCOME_OPTIONS)
  await press(page, at)
  // However the question came to fold, the point has not been left.
  requests.settle(UPPER, closedElsewhere)
  await stream.signal('agents')
  await expect(top.locator('.request-state')).toBeVisible()
  await expect.poll(() => under(page, at)).toContain('outcome')
  await press(page, at, 2)
  await pause(150)
  expect(backend.writes).toEqual([])
  expect(backend.item.summary_comment_id).toBeNull()
})
