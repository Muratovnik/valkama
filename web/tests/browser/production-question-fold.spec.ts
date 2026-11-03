/**
 * How a question reads once it has ended, whose doing the card says that was, and what
 * the form looks like while a write is out.
 */
import { expect } from '@playwright/test'

import type { InputRequestEntry, InputRequestField } from '@/shared/api/inputRequestModel.ts'

import {
  asked,
  openQuestion,
  question,
  QUESTION_ID,
  ROUTE_ASKED,
  routeField,
  send,
} from './questionBackend.ts'
import { test } from './test.ts'

const RESOLVED = '2026-10-24T10:30:00Z'
const CUT = 'Shown are the newest questions and those still waiting; older ones are left out.'

const ended = (id: string, prompt: string, change: Partial<InputRequestEntry['request']>) =>
  question({
    request_id: `66666666-6666-4666-8666-66666666666${id}`,
    prompt,
    fields: [routeField],
    resolved_at: RESOLVED,
    ...change,
  })

const options = (...labels: string[]) =>
  labels.map((text, index) => ({ id: `o${index}`, label: text }))

const pick = (id: string, list: InputRequestField['options'], type: InputRequestField['type']) =>
  ({ id, label: id, type, required: false, options: list }) as InputRequestField

test('the card says "you" only of a write this interface made, whatever the writer signed', async ({
  page,
}) => {
  const answered = { status: 'answered', answers: { route: 'keep' } } as const
  const { card } = await openQuestion(page, [
    ended('1', 'Answered by a script', {
      ...answered,
      answered_by: 'user',
      author: 'user',
      by_person: false,
    }),
    ended('2', 'Declined by a script', {
      status: 'declined',
      answered_by: 'user',
      by_person: false,
    }),
    ended('3', 'Withdrawn by a script', {
      status: 'expired',
      expired_reason: 'withdrawn',
      answered_by: 'user',
      by_person: false,
    }),
    ended('4', 'Answered in a session', {
      ...answered,
      answered_by: 'codex (session 1baa03d7)',
      by_person: false,
    }),
    ended('5', 'Answered here', { ...answered, answered_by: 'this client', by_person: true }),
    ended('6', 'Declined here', { status: 'declined', answered_by: 'user', by_person: true }),
  ])
  const outcome = (prompt: string) => card.filter({ hasText: prompt }).locator('.request-state')
  await expect(outcome('Answered by a script')).toContainText('Answered by agent user')
  await expect(outcome('Declined by a script')).toContainText('Declined by agent user')
  await expect(outcome('Withdrawn by a script')).toContainText('Resolved by agent user')
  await expect(outcome('Answered in a session')).toContainText('Answered by agent codex')
  await expect(outcome('Answered here')).toContainText('You answered')
  await expect(outcome('Declined here')).toContainText('You declined')
  for (const prompt of ['Answered by a script', 'Declined by a script', 'Withdrawn by a script'])
    await expect(card.filter({ hasText: prompt })).not.toContainText('You ')
  // A question always comes from an agent, and one may sign it with the person's name.
  await expect(
    card.filter({ hasText: 'Answered by a script' }).locator('.request-meta'),
  ).toContainText('user')
})

test('an option label stays the text it was in the form, while written words are markdown', async ({
  page,
}) => {
  const label = '**stars** and _under_ a_b_c `code`'
  const { card } = await openQuestion(page, [
    ended('1', 'One field', {
      status: 'answered',
      fields: [pick('one', options(label), 'choice')],
      answers: { one: 'o0' },
      note: 'A *note* beside it',
      by_person: true,
    }),
    ended('2', 'Several fields', {
      status: 'answered',
      fields: [
        pick('one', options('1. not a list'), 'choice'),
        pick('many', options('**a**', '_b_'), 'multi_choice'),
        pick('sure', [], 'boolean'),
        pick('words', [], 'text'),
      ],
      answers: { one: 'o0', many: ['o0', 'o1'], sure: true, words: 'Use **v2**' },
      by_person: true,
    }),
  ])
  const one = card.filter({ hasText: 'One field' }).locator('.request-state')
  await expect(one).toContainText(label)
  await expect(one.locator('strong, code')).toHaveCount(0)
  await expect(one.locator('em')).toHaveText('note')
  const values = card.filter({ hasText: 'Several fields' }).locator('.request-value')
  await expect(values.nth(0)).toHaveText('1. not a list')
  await expect(values.nth(0).locator('ol')).toHaveCount(0)
  await expect(values.nth(1)).toHaveText('**a**, _b_')
  await expect(values.nth(2)).toHaveText('Yes')
  await expect(values.nth(3).locator('strong')).toHaveText('v2')
})

test('the ring on how a question ended stands clear of its words and moves none of them', async ({
  page,
}) => {
  const { card, requests } = await openQuestion(page, [asked()])
  const decline = card.getByRole('button', { name: "Don't answer", exact: true })
  requests.failNext(503)
  await decline.click()
  await decline.click()
  const error = card.locator('.request-error')
  await expect(error).toBeFocused()
  await expect(error).toHaveCSS('outline-offset', '4px')
  await card.getByRole('button', { name: 'Check status', exact: true }).click()
  await decline.click()
  await decline.click()
  const state = card.locator('.request-state')
  await expect(state).toBeFocused()
  await expect(state).toHaveCSS('outline-offset', '4px')
  const held = await state.boundingBox()
  await state.blur()
  expect(await state.boundingBox()).toEqual(held)
})

test('while a write is out the buttons read as busy, and the keyboard stays on the one pressed', async ({
  page,
}) => {
  const { card, requests } = await openQuestion(page, [asked()])
  const answers: (() => void)[] = []
  requests.holdWrites(new Promise<void>((done) => answers.push(done)))
  await card.getByRole('radio', { name: 'Move them', exact: true }).click()
  await send(card).focus()
  await page.keyboard.press('Enter')
  await expect(send(card)).toHaveAttribute('aria-disabled', 'true')
  await expect(card.getByRole('button', { name: "Don't answer", exact: true })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
  await expect(send(card)).toBeFocused()
  await page.keyboard.press('Enter')
  answers[0]?.()
  await expect(card.locator('.request-state')).toBeFocused()
  expect(requests.writes).toHaveLength(1)
})

test('a deadline passed offers to check the status, until the question has closed', async ({
  page,
}) => {
  const { card, requests } = await openQuestion(page, [
    asked({ expires_at: '2020-01-01T10:00:00Z' }),
  ])
  const check = card.getByRole('button', { name: 'Check status', exact: true })
  await expect(check).toBeVisible()
  requests.settle(QUESTION_ID, { status: 'expired', expired_reason: 'deadline' })
  await check.click()
  await expect(card.locator('.request-state')).toContainText('Closed')
  await expect(card.getByRole('button')).toHaveCount(0)
})

test('a question waiting stands under the form past the first hundred, and the cut is said', async ({
  page,
}) => {
  const closed = Array.from({ length: 100 }, (_, index) =>
    question({
      request_id: `55555555-5555-4555-8555-${String(index).padStart(12, '0')}`,
      prompt: `Closed ${index}`,
      fields: [routeField],
      status: 'declined',
      answered_by: 'user',
      by_person: true,
      resolved_at: RESOLVED,
    }),
  )
  const { drawer, requests } = await openQuestion(page, [
    ...closed,
    asked({ created_at: '2020-01-01T10:00:00Z' }),
  ])
  const first = drawer.locator('.thread > li').first()
  await expect(first).toContainText(ROUTE_ASKED)
  await expect(first.getByRole('radio')).toHaveCount(3)
  await expect(drawer.getByText(CUT, { exact: true })).toBeVisible()
  expect(requests.reads.filter((read) => read.includes('reference=')).join(' ')).toContain(
    'status=pending',
  )
})

test('with all of a card’s questions in one read nothing more is read or said', async ({
  page,
}) => {
  const { drawer, requests, card } = await openQuestion(page, [asked()])
  await expect(card.getByRole('radio')).toHaveCount(3)
  await expect(drawer.getByText(CUT, { exact: true })).toHaveCount(0)
  expect(requests.reads.filter((read) => read.includes('reference=')).join(' ')).not.toContain(
    'status=pending',
  )
})
