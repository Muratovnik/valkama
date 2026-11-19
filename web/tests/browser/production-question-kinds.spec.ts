/**
 * The kinds of question in «Needs my answer», at the widths its layout changes at: each purpose
 * the owner answers is drawn as its kind, with the content and the answers of the kinds table, and
 * one press writes the option it names; «Later…» puts a question off to a day or to a card's
 * close; a question its card's close took away says so; and the tabs over the list show one
 * kind's questions, drop a kind with none, give way to «All» when the open kind empties, and are
 * what «Question N of M» counts.
 */
import { expect } from '@playwright/test'

import { everyKind, ofPurpose, openKinds } from './questionKindsPage.ts'
import { test } from './test.ts'

const WIDTHS = [1280, 620, 390] as const
const POLL = 30_000

/**
 * What each kind's buttons say, in order, and a line of its content: the kinds table. A return
 * says all it needs in its own words, so its content is empty.
 */
const KINDS = [
  { prompt: 'The review question', answers: ['Accept', 'Return to work'], shows: 'Task outcome' },
  { prompt: 'The triage question', answers: ['Do', 'Later…', 'Don’t do'], shows: 'MAIN-311' },
  {
    prompt: 'The goal question',
    answers: ['Do', 'Later…', 'Don’t do'],
    shows: 'Open work under it: 0',
  },
  {
    prompt: 'The task question',
    answers: ['Do', 'Later…', 'Move out of the goal', 'Don’t do'],
    shows: 'Deliver the exact project vertical slice.',
  },
  {
    prompt: 'The condition question',
    answers: ['Allow', 'Keep'],
    shows: 'Checked on two channels',
  },
  { prompt: 'The cancel question', answers: ['Cancel', 'Keep'], shows: 'MAIN-301' },
  {
    prompt: 'The confirm question',
    answers: ['I confirm', 'Leave it open'],
    shows: 'The adapter delivers to the tray.',
  },
  { prompt: 'The return question', answers: ['Do', 'Later…', 'Don’t do'], shows: '' },
]

for (const width of WIDTHS) {
  test(`at ${width}px each kind shows its content and answers, and one press writes its option`, async ({
    page,
  }) => {
    const { dialog, record, requests } = await openKinds(page, everyKind(), width)
    // The choice of options keeps its form.
    const choice = record('Where should the comments go?')
    await expect(choice.getByRole('radio')).toHaveCount(3)
    await expect(choice.getByRole('button', { name: 'Send', exact: true })).toBeVisible()
    for (const kind of KINDS) {
      const one = record(kind.prompt)
      // What a kind reads from its card is read once its record comes into view.
      await one.scrollIntoViewIfNeeded()
      await expect(one.getByRole('radio')).toHaveCount(0)
      await expect(one.locator('.request-pair').getByRole('button')).toHaveText(kind.answers)
      await expect(one.locator('[data-kind-subject]')).toContainText(kind.shows)
    }
    await expect(record('The return question').locator('[data-kind-subject]')).toHaveText('')
    // A condition says what each rewritten step was and becomes, and why.
    const condition = record('The condition question').locator('[data-kind-subject]')
    await expect(condition.locator('[data-kind-part="removed"]')).toContainText('Sound is checked')
    await expect(condition.locator('[data-kind-part="rewritten"]')).toContainText(
      'Checked on three channels',
    )
    await expect(condition.locator('[data-kind-part="why"]')).toContainText('third channel')
    // A cancel names who holds what closes, and what the sessions at work answered.
    const cancel = record('The cancel question').locator('[data-kind-subject]')
    await expect(cancel.locator('[data-kind-part="closes"]')).toContainText('codex · 71aa0000')
    await expect(cancel.locator('[data-kind-part="consent"]')).toContainText(
      'objects: Two thirds are done.',
    )

    await record('The review question').getByRole('button', { name: 'Accept', exact: true }).click()
    await expect
      .poll(() => requests.writes.map((write) => write.body.answers))
      .toEqual([{ answer: 'accept' }])
    await expect(record('The review question').locator('.request-state')).toContainText(
      'You answered',
    )
    // Cancel asks first: its first press writes nothing.
    await record('The cancel question').getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(record('The cancel question').getByRole('alert')).toHaveText(
      '«Cancel» — are you sure?',
    )
    expect(requests.writes).toHaveLength(1)
    await expect(dialog.getByRole('tablist', { name: 'Kinds of question' })).toBeVisible()
  })

  test(`at ${width}px «Later…» puts a question off to a day, or until a card closes`, async ({
    page,
  }) => {
    const byDay = ofPurpose('return', { prompt: 'Put off by a day' })
    const byCard = ofPurpose('goal', { prompt: 'Put off by a card' })
    const { record, requests } = await openKinds(page, [byDay, byCard], width)

    const day = record('Put off by a day')
    await day.getByRole('button', { name: 'Later…', exact: true }).click()
    const putOff = day.getByRole('button', { name: 'Put off', exact: true })
    await expect(putOff).toBeDisabled()
    await expect(day.locator('.request-later-reason')).toHaveText(
      'Choose a day, or a card whose closing brings it back.',
    )
    await day.getByLabel('Until a day').fill('2099-03-01')
    await putOff.click()

    const card = record('Put off by a card')
    await card.getByRole('button', { name: 'Later…', exact: true }).click()
    const combo = card.getByRole('combobox', { name: 'Until a card closes' })
    await combo.click()
    await combo.pressSequentially('tray')
    // Only the open card of the question's space is offered; a closed one is not.
    const options = page.getByRole('option')
    await expect(options).toHaveText(['MAIN-320 Tray delivery adapter'])
    await options.first().click()
    await expect(combo).toHaveValue('MAIN-320 Tray delivery adapter')
    await card.getByRole('button', { name: 'Put off', exact: true }).click()

    await expect
      .poll(() => requests.writes.map((write) => write.body.answers))
      .toEqual([
        { answer: 'later', until: '2099-03-01' },
        { answer: 'later', until: 'MAIN-320' },
      ])
  })

  test(`at ${width}px a question its card's close withdrew says why, with what was left unsent`, async ({
    page,
  }) => {
    const withdrawn = ofPurpose('goal', { prompt: 'Withdrawn by a close' })
    const { record, requests } = await openKinds(page, [withdrawn, ofPurpose('review')], width)
    const one = record('Withdrawn by a close')
    await one.getByRole('button', { name: 'Later…', exact: true }).click()
    await one.getByLabel('Until a day').fill('2099-03-01')

    requests.settle(withdrawn.request.request_id, {
      status: 'expired',
      expired_reason: 'item_cancelled',
      resolved_at: '2026-10-24T11:00:00Z',
    })
    await page.clock.runFor(POLL)

    await expect(one.locator('.request-state')).toContainText(
      'Question withdrawn: MAIN-264 was closed',
    )
    await expect(one.locator('.request-unsent-text')).toContainText('2099-03-01')
    expect(requests.writes).toHaveLength(0)
  })

  test(`at ${width}px the tabs show one kind, count it, and give way to All when it empties`, async ({
    page,
  }) => {
    const reviews = [
      ofPurpose('review', { prompt: 'First review' }),
      ofPurpose('review', { prompt: 'Second review' }),
    ]
    const entries = [ofPurpose(null), ...reviews, ofPurpose('goal', { prompt: 'A goal' })]
    const { dialog, record, requests } = await openKinds(page, entries, width)
    const tabs = dialog.getByRole('tablist', { name: 'Kinds of question' }).getByRole('tab')
    // A tab per kind the list holds, with how many of it wait; none for a kind it does not hold.
    await expect(tabs).toHaveText(['All 4', 'Choice 1', 'Review 2', 'Goals 1'])
    const place = dialog.locator('.request-navigator-now')
    await expect(place).toHaveText('Question 1 of 4')

    await tabs.filter({ hasText: 'Review' }).click()
    await expect(tabs.filter({ hasText: 'Review' })).toHaveAttribute('aria-selected', 'true')
    const panel = dialog.getByRole('tabpanel', { name: 'Review 2' })
    await expect(panel.locator('.request-card')).toHaveCount(2)
    await expect(record('A goal')).toHaveCount(0)
    await expect(place).toHaveText('Question 1 of 2')

    // Both reviews are answered in another window, and nobody here touched them: the kind empties.
    for (const review of reviews)
      requests.settle(review.request.request_id, {
        status: 'answered',
        answers: { answer: 'accept' },
        answered_by: 'user',
        by_person: true,
        resolved_at: '2026-10-24T11:00:00Z',
      })
    await page.clock.runFor(POLL)
    await expect(record('First review')).toHaveCount(0)
    await expect(tabs).toHaveText(['All 2', 'Choice 1', 'Goals 1'])
    await expect(tabs.filter({ hasText: 'All' })).toHaveAttribute('aria-selected', 'true')
    await expect(record('A goal')).toHaveCount(1)
    await expect(place).toHaveText('Question 1 of 2')
  })
}

test('a list of one kind offers no tabs: All would be that kind again', async ({ page }) => {
  const { dialog, record } = await openKinds(page, [ofPurpose(null), ofPurpose(null)], 1280)
  await expect(record('Where should the comments go?')).toHaveCount(2)
  await expect(dialog.getByRole('tablist')).toHaveCount(0)
})
