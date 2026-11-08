import { expect } from '@playwright/test'

import { planningSpaceEntity, planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { present } from '../support/present.ts'
import { installBackend } from './backend.ts'
import { installDiscussionBackend } from './discussionBackend.ts'
import { enableExecutionTab } from './executionFixtures.ts'
import { installInputRequestBackend } from './inputRequestBackend.ts'
import { expectNoSilentClipping } from './overflow.ts'
import {
  attachedDataScopeId,
  attachedSpaceRef,
  attachedWorkItemRef,
  projectId,
  projectScope,
  spaceRef,
  workItem,
} from './planningFixtures.ts'
import { test } from './test.ts'

test('root keyboard finder opens the exact attached result with partial coverage', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 900 })
  // On, so what keeps the attempts unread here is the attached store and not the default.
  await enableExecutionTab(page)
  const backend = await installBackend(page, { includeAttachedDuplicate: true })
  const executionReads: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/execution/'))
      executionReads.push(request.url())
  })
  await page.route('**/api/modules/planning/search?*', async (route) => {
    const query = new URL(route.request().url()).searchParams
    expect(query.get('q')).toBe('MAIN-264')
    expect(query.get('limit')).toBe('50')
    return route.fulfill({
      json: {
        interface_version: 'valkama-planning-search',
        query: 'MAIN-264',
        limit: 50,
        has_more: true,
        items: [
          {
            target: {
              project_id: projectId,
              space_ref: attachedSpaceRef,
              reference: 'MAIN-264',
              writable: false,
            },
            item: {
              work_item_id: workItem.work_item_id,
              planning_space_id: workItem.planning_space_id,
              reference: 'MAIN-264',
              title: 'Attached duplicate task',
              state: { name: 'Dev' },
              claim_ref: '',
            },
          },
        ],
        coverage: [
          { project_id: projectId, space_ref: attachedSpaceRef, status: 'searched', reason: null },
          {
            project_id: 'offline-project',
            space_ref: spaceRef,
            status: 'unavailable',
            reason: 'offline',
          },
        ],
      },
    })
  })
  await page.goto(
    serializePlatformRoute({
      module_id: 'planning',
      scope: projectScope,
      entity: planningSpaceEntity(spaceRef),
    }),
  )
  await expect(page.locator('.work-item-board')).toBeVisible()
  await page.keyboard.press('Control+k')
  const dialog = page.getByRole('dialog', { name: 'Go to a task', exact: true })
  const search = dialog.getByRole('combobox')
  await expect(search).toBeFocused()
  await search.fill('MAIN-264')
  await expect(dialog.getByRole('option')).toContainText('Read only')
  await expect(dialog.getByRole('status')).toContainText(
    'Could not be read: offline-project · MAIN',
  )
  await expect(dialog.getByRole('status')).toContainText('More matches are available.')
  await expectNoSilentClipping(page, 'Finder at 390px')
  await page.screenshot({ path: testInfo.outputPath('finder-narrow.png') })
  executionReads.length = 0
  // The first row is already the one Enter opens; no arrow key is needed.
  await page.keyboard.press('Enter')
  await expect(dialog).toBeHidden()
  await expect(page).toHaveURL(
    serializePlatformRoute({
      module_id: 'planning',
      scope: projectScope,
      entity: planningWorkItemEntity(attachedWorkItemRef),
    }),
  )
  await expect(page.locator('.drawer')).toContainText(`Attached: ${workItem.title}`)
  await expect(
    page.locator('.drawer').getByRole('button', { name: 'Edit description', exact: true }),
  ).toHaveCount(0)
  expect(
    backend.platformReads.findLast((entry) => entry.startsWith('/api/modules/planning/work-item?')),
  ).toContain(`data_scope_id=${attachedDataScopeId}`)
  expect(executionReads).toEqual([])
})

test('native skip link focuses content and preserves the canonical route', async ({ page }) => {
  await installBackend(page)
  await page.goto(serializePlatformRoute({ module_id: 'planning', scope: projectScope }))
  await expect(page.locator('.work-item-board')).toBeVisible()
  const original = page.url()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('#main-content')).toBeFocused()
  await expect(page).toHaveURL(original)
  await expect(page.locator('.work-item-board')).toBeVisible()
})

test('a required boolean remains unanswered until No is submitted and confirmed', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 900 })
  const backend = await installBackend(page)
  const requests = await installInputRequestBackend(page)
  await page.goto('/')
  // In the compact rail the waiting count rides the icon's corner as a badge:
  // it used to stay in the row and squeeze the glyph, in the hint's grey.
  const opener = page.getByRole('button', { name: /^Needs my answer/ })
  await expect(opener.locator('.action-count')).toHaveText('1')
  const [box, glyph, count] = await Promise.all(
    [opener, opener.locator('svg'), opener.locator('.action-count')].map(async (part) =>
      present(await part.boundingBox(), 'a laid-out box'),
    ),
  )
  expect(glyph.width).toBe(20)
  expect(glyph.x + glyph.width / 2).toBeCloseTo(box.x + box.width / 2, 0)
  expect([count.y - box.y, box.x + box.width - (count.x + count.width)]).toEqual([0, 0])
  await expect(opener.locator('.action-count')).toHaveCSS('font-weight', '600')
  await opener.click()
  const dialog = page.getByRole('dialog', { name: 'Needs my answer', exact: true })
  const choice = dialog.getByRole('radiogroup', { name: /Should deployment proceed\?/u })
  const no = choice.getByRole('radio', { name: 'No', exact: true })
  await expect(choice.getByRole('radio')).toHaveCount(3)
  await expect(choice.getByRole('radio', { checked: true })).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Send', exact: true }).click()
  // The refusal stands at the field, which takes focus, and brings no second Refresh.
  await expect(choice).toHaveAttribute('aria-invalid', 'true')
  await expect(choice).toHaveAccessibleDescription('Choose Yes or No.')
  await expect(choice.getByRole('radio', { name: 'Yes', exact: true })).toBeFocused()
  await expect(dialog.getByRole('button', { name: /^(Refresh|Check status)$/ })).toHaveCount(1)
  expect(requests.writes).toEqual([])
  // One key answers it, and the message leaves with the fix.
  await page.keyboard.press('ArrowDown')
  await expect(no).toBeChecked()
  await expect(choice).not.toHaveAttribute('aria-invalid')
  await expectNoSilentClipping(page, 'Question at 390px')
  await page.screenshot({ path: testInfo.outputPath('question-narrow.png') })
  // Past the way not to answer at all: the comment on the block stands in its head, and the
  // way to the task is the number there.
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: 'Send', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(dialog.locator('.request-state')).toContainText('You answered')
  await expect(dialog.locator('.request-option.is-chosen')).toContainText('No')
  // Nothing is left to answer: focus stays on the card just answered, described by how
  // it ended, with its ring showing, rather than on the count line at the top.
  const answered = dialog.locator('.request-card')
  await expect(answered).toBeFocused()
  await expect(answered).toHaveCSS('outline-style', 'solid')
  await expect(
    dialog.getByText('Waiting for an answer: 0 — the blocks of questions below have closed.'),
  ).toBeVisible()
  expect(requests.writes).toEqual([
    {
      project_id: projectId,
      data_scope_id: spaceRef.data_scope_id,
      space_key: 'MAIN',
      id: requests.entry.request.request_id,
      expected_revision: 1,
      author: 'user',
      answers: { proceed: false },
    },
  ])
  await dialog.getByRole('button', { name: 'Close questions', exact: true }).click()
  await page.getByRole('button', { name: /^Needs my answer/ }).click()
  await expect(dialog.locator('.request-state')).toContainText('You answered')
  await expect(dialog.locator('.request-option.is-chosen')).toContainText('No')
  // The number in the head of the block is the way to its task.
  await dialog.locator('.request-header').getByRole('link').click()
  const inCard = page.locator('.drawer .request-card')
  await expect(inCard.locator('.request-state')).toContainText('You answered')
  await page.reload()
  await expect(inCard.locator('.request-option.is-chosen')).toContainText('No')
  expect(backend.attachCommands).toEqual([])
  expect(requests.executionWrites).toEqual([])
})

for (const status of [409, 503]) {
  test(`question draft survives ${status}, reopen and explicit revision refresh`, async ({
    page,
  }) => {
    await installBackend(page)
    const requests = await installInputRequestBackend(page)
    requests.failNext(status)
    await page.goto('/')
    await page.getByRole('button', { name: /^Needs my answer/ }).click()
    const dialog = page.getByRole('dialog', { name: 'Needs my answer', exact: true })
    const card = dialog.locator('.request-card')
    const no = card.getByRole('radio', { name: 'No', exact: true })
    await no.check()
    await card.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(card.getByRole('alert')).toContainText('your draft is kept.')
    await expect(no).toBeChecked()
    await expect(card.getByRole('button', { name: 'Send', exact: true })).toBeDisabled()
    await card.getByRole('button', { name: 'Check status', exact: true }).click()
    await expect(card.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
    await dialog.getByRole('button', { name: 'Close questions', exact: true }).click()
    await page.getByRole('button', { name: /^Needs my answer/ }).click()
    await expect(no).toBeChecked()
    await expect(card.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
    await card.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(card.locator('.request-state')).toContainText('You answered')
    expect(requests.writes.map((write) => write.expected_revision)).toEqual([1, 2])
    expect(requests.writes.at(-1)?.answers).toEqual({ proceed: false })
    expect(
      requests.reads.some((read) => read.startsWith('GET /api/modules/planning/request?')),
    ).toBe(true)
  })
}

test('Discuss step reveals the composer and retains a frozen quote after rename and deletion', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 })
  const backend = await installDiscussionBackend(page)
  await page.goto(serializePlatformRoute({ module_id: 'planning', scope: projectScope }))
  await page.locator('.work-item-column[data-state="dev"] .work-item-tile').first().click()
  const drawer = page.locator('.drawer')
  const discuss = drawer.getByRole('button', {
    name: 'Discuss step “Frontend contract”',
    exact: true,
  })
  // An icon-only ghost has no label to read as a control, so it stays bare at rest.
  expect(await discuss.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
    'rgba(0, 0, 0, 0)',
  )
  await discuss.click()
  const composer = drawer.getByRole('form', { name: 'Write a comment', exact: true })
  await expect(composer).toBeFocused()
  await expect(composer).toBeInViewport({ ratio: 0.5 })
  await expect(composer.locator('.step-quote')).toContainText('Frontend contract')
  await composer
    .getByRole('textbox', { name: 'Comment', exact: true })
    .fill('Keep the acceptance criterion explicit')
  await composer.locator('button[type="submit"]').click()
  await expect(drawer.locator('.thread-entry .thread-quote')).toContainText('Frontend contract')
  expect(backend.writes.at(-1)).toMatchObject({
    checklist_item_id: backend.item.checklist[0].id,
    body: 'Keep the acceptance criterion explicit',
  })
  backend.item.checklist[0].text = 'Renamed criterion'
  await page.reload()
  await expect(drawer.locator('.thread-entry .thread-quote')).toContainText('Step text has changed')
  await expect(drawer.locator('.thread-entry .thread-quote')).toContainText('Frontend contract')
  backend.item.checklist = []
  await page.reload()
  await expect(drawer.locator('.thread-entry .thread-quote')).toContainText('Step has been removed')
  await expect(drawer.locator('.thread-entry .thread-quote')).toContainText('Frontend contract')
  await expectNoSilentClipping(page, 'Frozen checklist discussion at 390px')
})
