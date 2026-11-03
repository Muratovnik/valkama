import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import type { WorkItem } from '@/shared/api/planningModel.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { asRoot } from '../support/threads.ts'
import { installDiscussionBackend } from './discussionBackend.ts'
import { doneState, now, projectScope } from './planningFixtures.ts'
import { test } from './test.ts'

/**
 * Closing an item with no outcome, the one way a person comes to write a report:
 * the server refuses, the refusal offers the form, and saving it finishes the move.
 */

async function refusedClose(page: Page, prepare?: Parameters<typeof seed>[0]) {
  const backend = await installDiscussionBackend(page)
  prepare?.(backend.item)
  await page.goto(serializePlatformRoute({ module_id: 'planning', scope: projectScope }))
  await page.locator('.work-item-column[data-state="dev"] .work-item-tile').first().click()
  const drawer = page.locator('.drawer')
  await drawer.getByRole('combobox', { name: /^State: Dev/u }).click()
  await page.getByRole('option', { name: 'Done', exact: true }).click()
  await expect(drawer.locator('.refusal')).toContainText('There is no closing summary')
  return { backend, drawer }
}
/** The shape of what a test may put on the item before the card opens. */
const seed = (
  prepare: (item: Awaited<ReturnType<typeof installDiscussionBackend>>['item']) => void,
) => prepare

/** The state the card says, from the top of the body, where the head shows its facts. */
async function expectState(drawer: Locator, state: string) {
  await drawer.locator('.drawer-frame-body').evaluate((element) => element.scrollTo({ top: 0 }))
  await expect(drawer.locator('.card-state')).toContainText(state)
}

const transitions = (writes: readonly Record<string, unknown>[]) =>
  writes.filter((write) => write.state !== undefined)

/** An agent's report on the item, ready to be made its outcome. */
const withAgentReport = seed((item) => {
  item.comments.push({
    id: 1,
    kind: 'report',
    ...asRoot,
    author: 'codex',
    at: now,
    body: '',
    report: { done: 'Agent shipped it', next: 'Agent watches it' },
    checklist_item_id: null,
    checklist_item_text: null,
  })
})

/**
 * The form with no move left to promise: named for what it holds, giving no reason,
 * and offering only what its button does. Answers with that button.
 */
async function expectOnlySaves(drawer: Locator) {
  const form = drawer.getByRole('form', { name: 'Task outcome', exact: true })
  await expect(form).toBeVisible()
  await expect(form).not.toContainText('Moving this task')
  await expect(form.getByRole('button', { name: 'Save and close', exact: true })).toHaveCount(0)
  return form.getByRole('button', { name: 'Save outcome', exact: true })
}

for (const width of [1680, 390]) {
  test(`closing with no outcome leads to its form, and saving it completes the close, at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    const { backend, drawer } = await refusedClose(page)
    expect(transitions(backend.writes)).toHaveLength(1)

    await drawer.getByRole('button', { name: 'Write the outcome', exact: true }).click()
    const form = drawer.getByRole('form', { name: 'Outcome before closing' })
    await expect(form).toBeInViewport()
    await expect(form).toContainText('Moving this task to “Done” needs its outcome')
    await expect(drawer.locator('.refusal')).toHaveCount(0)
    await expect(drawer.getByRole('textbox', { name: 'Comment', exact: true })).toHaveCount(0)

    // Only what the server refuses to close without, ready to be written in.
    await expect(form.getByRole('textbox')).toHaveCount(2)
    const done = form.getByRole('textbox', { name: 'What was done', exact: true })
    const next = form.getByRole('textbox', { name: 'What comes next', exact: true })
    await expect(done).toBeFocused()
    const save = form.getByRole('button', { name: 'Save and close', exact: true })
    await expect(save).toBeDisabled()
    await done.fill('Shipped the parser')
    await expect(save).toBeDisabled()
    await next.fill('Watch it for a week')

    await save.click()
    await expect(form).toHaveCount(0)
    await expect(drawer.locator('.outcome')).toContainText('Shipped the parser')
    await expectState(drawer, 'Done')
    await expect(drawer.locator('.refusal')).toHaveCount(0)
    const [report, closing] = backend.writes.slice(-2)
    expect(report).toEqual({
      author: 'user',
      id: backend.item.work_item_id,
      report: { done: 'Shipped the parser', next: 'Watch it for a week' },
      make_current: true,
      expected_revision: 3,
    })
    expect(closing).toMatchObject({ state: 'done' })
    expect(closing?.force).toBeUndefined()
  })
}

test('a refused outcome keeps the form and its text, says why in the foot, and can be retried', async ({
  page,
}) => {
  const { backend, drawer } = await refusedClose(page)
  await drawer.getByRole('button', { name: 'Write the outcome', exact: true }).click()
  const form = drawer.getByRole('form', { name: 'Outcome before closing' })
  await form.getByRole('textbox', { name: 'What was done', exact: true }).fill('Shipped')
  await form.getByRole('textbox', { name: 'What comes next', exact: true }).fill('Watch')
  backend.failNextWrite()
  await form.getByRole('button', { name: 'Save and close', exact: true }).click()
  await expect(form.getByRole('alert')).toContainText('The task changed.')
  await expect(form.getByRole('textbox', { name: 'What was done', exact: true })).toHaveValue(
    'Shipped',
  )
  expect(transitions(backend.writes)).toHaveLength(1)
  await form.getByRole('button', { name: 'Refresh task', exact: true }).click()
  await form.getByRole('button', { name: 'Save and close', exact: true }).click()
  await expect(form).toHaveCount(0)
  expect(transitions(backend.writes)).toHaveLength(2)
})

test('the way out goes back to the comment with its draft, and the item stays where it was', async ({
  page,
}) => {
  const { backend, drawer } = await refusedClose(page)
  await drawer.getByRole('button', { name: 'Write the outcome', exact: true }).click()
  const form = drawer.getByRole('form', { name: 'Outcome before closing' })
  await form.getByRole('textbox', { name: 'What was done', exact: true }).fill('Half an outcome')
  await form.getByRole('button', { name: 'Back to comment', exact: true }).click()
  await expect(form).toHaveCount(0)
  await expect(drawer.getByRole('textbox', { name: 'Comment', exact: true })).toBeVisible()
  await expectState(drawer, 'Dev')
  expect(transitions(backend.writes)).toHaveLength(1)
  expect(backend.item.summary).toBeNull()
})

test('an outcome written and stepped back from is not lost without a question', async ({
  page,
}) => {
  const { drawer } = await refusedClose(page)
  await drawer.getByRole('button', { name: 'Write the outcome', exact: true }).click()
  const form = drawer.getByRole('form', { name: 'Outcome before closing' })
  await expect(form.getByRole('textbox', { name: 'What was done', exact: true })).toBeFocused()
  await page.keyboard.type('Half an outcome')
  await form.getByRole('button', { name: 'Back to comment', exact: true }).click()
  await expect(form).toHaveCount(0)

  // Leaving now would lose it, so the way out asks, and it names what would go.
  await drawer.getByRole('button', { name: 'Close', exact: true }).click()
  const question = drawer.locator('.drawer-frame-notices')
  await expect(question).toContainText('Unsaved changes will be lost: task outcome')
  await expect(drawer).toBeVisible()

  // Keeping it has to lead somewhere: the comment says it is there and goes back to it.
  await question.getByRole('button', { name: 'Keep editing', exact: true }).click()
  await drawer.getByRole('button', { name: 'Back to the unsent outcome', exact: true }).click()
  await expect(form.getByRole('textbox', { name: 'What was done', exact: true })).toHaveValue(
    'Half an outcome',
  )
  await expect(form.getByRole('textbox', { name: 'What was done', exact: true })).toBeFocused()

  // And answering the question is what lets it go.
  await form.getByRole('button', { name: 'Back to comment', exact: true }).click()
  await drawer.getByRole('button', { name: 'Close', exact: true }).click()
  await question.getByRole('button', { name: 'Discard', exact: true }).click()
  await expect(drawer).toHaveCount(0)
})

test('an empty outcome stepped back from holds nothing, and asks nothing', async ({ page }) => {
  const { drawer } = await refusedClose(page)
  await drawer.getByRole('button', { name: 'Write the outcome', exact: true }).click()
  const form = drawer.getByRole('form', { name: 'Outcome before closing' })
  await form.getByRole('button', { name: 'Back to comment', exact: true }).click()
  await expect(form).toHaveCount(0)
  await expect(drawer.getByRole('button', { name: 'Back to the unsent outcome' })).toHaveCount(0)
  await drawer.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(drawer).toHaveCount(0)
})

test('an outcome being written outlives a report made the outcome, and is still asked about', async ({
  page,
}) => {
  const { backend, drawer } = await refusedClose(page, withAgentReport)
  await drawer.getByRole('button', { name: 'Write the outcome', exact: true }).click()
  const form = drawer.getByRole('form', { name: 'Outcome before closing' })
  await form.getByRole('textbox', { name: 'What was done', exact: true }).fill('My own words')
  await drawer
    .locator('.thread-entry')
    .filter({ hasText: 'Agent shipped it' })
    .getByRole('button', { name: 'Make task outcome', exact: true })
    .click()
  await expect(form).toHaveCount(0)
  await expectState(drawer, 'Done')
  expect(backend.item.summary_comment_id).toBe(1)
  await drawer.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(drawer.locator('.drawer-frame-notices')).toContainText('task outcome')
})

const SENDS = {
  'the button': (form: Locator) =>
    form.getByRole('button', { name: 'Save and close', exact: true }).click(),
  'Ctrl+Enter': (form: Locator) =>
    form.getByRole('textbox', { name: 'What comes next', exact: true }).press('Control+Enter'),
}

test('an outcome held past its move says nothing of the move, and saving it only saves', async ({
  page,
}) => {
  const { backend, drawer } = await refusedClose(page, withAgentReport)
  await drawer.getByRole('button', { name: 'Write the outcome', exact: true }).click()
  const opened = drawer.getByRole('form', { name: 'Outcome before closing' })
  await opened.getByRole('textbox', { name: 'What was done', exact: true }).fill('My own words')
  await opened.getByRole('textbox', { name: 'What comes next', exact: true }).fill('My own next')
  await drawer
    .locator('.thread-entry')
    .filter({ hasText: 'Agent shipped it' })
    .getByRole('button', { name: 'Make task outcome', exact: true })
    .click()
  await expect(opened).toHaveCount(0)
  await expectState(drawer, 'Done')
  const moves = transitions(backend.writes).length

  await drawer.getByRole('button', { name: 'Back to the unsent outcome', exact: true }).click()
  const save = await expectOnlySaves(drawer)
  await save.click()
  await expect(drawer.locator('.closing-form')).toHaveCount(0)
  // The person replaces the agent's outcome by that press, and nothing moves.
  expect(backend.item.summary).toEqual({ done: 'My own words', next: 'My own next' })
  expect(transitions(backend.writes)).toHaveLength(moves)
  await expectState(drawer, 'Done')
})

/**
 * What another hand did while the form stood, which the card learns by reading again: the
 * write is refused because the item changed, and the form's own button reads it.
 */
for (const [what, change, state] of [
  [
    'closed the item',
    (item: WorkItem) => {
      item.state = { ...doneState }
      item.summary = { done: 'Agent shipped it', next: 'Agent watches it' }
    },
    'Done',
  ],
  [
    'gave it an outcome',
    (item: WorkItem) => {
      item.summary = { done: 'Agent shipped it', next: 'Agent watches it' }
    },
    'Dev',
  ],
  [
    'moved it past the need for this move',
    (item: WorkItem) => {
      item.state = { ...doneState, key: 'cancelled', name: 'Cancelled' }
    },
    'Cancelled',
  ],
] as const) {
  test(`once read again after an agent ${what}, the form says nothing of the move and only saves`, async ({
    page,
  }) => {
    const { backend, drawer } = await refusedClose(page)
    await drawer.getByRole('button', { name: 'Write the outcome', exact: true }).click()
    const opened = drawer.getByRole('form', { name: 'Outcome before closing' })
    const done = opened.getByRole('textbox', { name: 'What was done', exact: true })
    await done.fill('My own words')
    await opened.getByRole('textbox', { name: 'What comes next', exact: true }).fill('My own next')
    backend.failNextWrite()
    await opened.getByRole('button', { name: 'Save and close', exact: true }).click()
    await expect(opened.getByRole('alert')).toContainText('The task changed.')
    const moves = transitions(backend.writes).length

    change(backend.item)
    await opened.getByRole('button', { name: 'Refresh task', exact: true }).click()
    const save = await expectOnlySaves(drawer)
    await expect(drawer.getByRole('textbox', { name: 'What was done', exact: true })).toHaveValue(
      'My own words',
    )
    await save.click()
    await expect(drawer.locator('.closing-form')).toHaveCount(0)
    expect(backend.item.summary).toEqual({ done: 'My own words', next: 'My own next' })
    expect(transitions(backend.writes)).toHaveLength(moves)
    await expectState(drawer, state)
  })
}

for (const [how, send] of Object.entries(SENDS)) {
  test(`sending the outcome with ${how} keeps focus in the card, on the comment that stands there now`, async ({
    page,
  }) => {
    const { drawer } = await refusedClose(page)
    await drawer.getByRole('button', { name: 'Write the outcome', exact: true }).click()
    const form = drawer.getByRole('form', { name: 'Outcome before closing' })
    await form.getByRole('textbox', { name: 'What was done', exact: true }).fill('Shipped')
    await form.getByRole('textbox', { name: 'What comes next', exact: true }).fill('Watch')
    await send(form)
    await expect(form).toHaveCount(0)
    await expectState(drawer, 'Done')
    await expect(drawer.locator('.discussion-form')).toBeFocused()
  })
}

test('a refused outcome sent with the button keeps focus in its form', async ({ page }) => {
  const { backend, drawer } = await refusedClose(page)
  await drawer.getByRole('button', { name: 'Write the outcome', exact: true }).click()
  const form = drawer.getByRole('form', { name: 'Outcome before closing' })
  await form.getByRole('textbox', { name: 'What was done', exact: true }).fill('Shipped')
  const next = form.getByRole('textbox', { name: 'What comes next', exact: true })
  await next.fill('Watch')
  backend.failNextWrite()
  await form.getByRole('button', { name: 'Save and close', exact: true }).click()
  await expect(form.getByRole('alert')).toContainText('The task changed.')
  await expect(next).toBeFocused()
})

test('an agent’s report still shows, and making it the outcome answers the same question', async ({
  page,
}) => {
  const { backend, drawer } = await refusedClose(page, withAgentReport)
  const entry = drawer.locator('.thread-entry').filter({ hasText: 'Agent shipped it' })
  await expect(entry.locator('.thread-label')).toHaveText('Work report')
  await drawer.getByRole('button', { name: 'Write the outcome', exact: true }).click()
  const form = drawer.getByRole('form', { name: 'Outcome before closing' })
  await expect(form).toBeVisible()
  await entry.getByRole('button', { name: 'Make task outcome', exact: true }).click()
  await expect(form).toHaveCount(0)
  await expectState(drawer, 'Done')
  expect(backend.item.summary_comment_id).toBe(1)
  expect(backend.writes.at(-1)).toMatchObject({ state: 'done' })
  await expect(drawer.locator('.discussion-form')).toBeFocused()
})
