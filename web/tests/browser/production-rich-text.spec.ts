/**
 * A card with a long markdown work report, as an agent writes one.
 *
 * What a unit test cannot see: that the held report ends on a whole line of
 * text rather than through one, that it opens and closes, that Tab into a link
 * below the cut opens it instead of scrolling it out of shape, that markdown
 * headings stay out of the card's outline, and that a reference opens the card
 * or the record it names in the real application.
 */
import { expect } from '@playwright/test'

import { planningSpaceEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { asRoot } from '../support/threads.ts'
import { installDiscussionBackend } from './discussionBackend.ts'
import { expectNoSilentClipping } from './overflow.ts'
import {
  blockedWorkItem,
  now,
  planningSpace,
  projectScope,
  spaceRef,
  workItem,
} from './planningFixtures.ts'
import { pointerBand } from './pointerBand.ts'
import { test } from './test.ts'

const steps = Array.from(
  { length: 18 },
  (_, index) => `- Step ${index + 1}: **checked** with \`npm test\` on a long enough line to wrap`,
)
const report = [
  '## Delivered',
  '',
  'Shipped in `a1b2c3d`, see MAIN-265; MAIN-999 and SHA-256 stay text.',
  '',
  // Code is set smaller than the text, so the lines after it leave the text's grid.
  '```',
  'npm test',
  'npm run build',
  '```',
  '',
  ...steps,
  '',
  '[Notes](https://example.org/notes) and [bad](javascript:alert(1)) <b>raw</b>',
].join('\n')

test('a long markdown report holds on a whole line, opens, and links what resolves', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const backend = await installDiscussionBackend(page)
  backend.item.refs.push({
    kind: 'commit',
    value: 'a1b2c3d4e5f6',
    label: 'fix: wire contract',
    author: 'agent',
    at: now,
  })
  backend.item.comments.push({
    id: 1,
    kind: 'report',
    ...asRoot,
    report: { done: report, next: 'Review MAIN-265', why: '' },
    body: '',
    author: 'agent',
    at: now,
    checklist_item_id: null,
    checklist_item_text: null,
  })
  const lookups: URLSearchParams[] = []
  await page.route('**/api/ref?*', (route) => {
    lookups.push(new URL(route.request().url()).searchParams)
    return route.fulfill({
      json: {
        kind: 'commit',
        value: 'a1b2c3d4e5f6',
        resolved: true,
        repository: '/work/repo',
        detail: 'a1b2c3d agent\nfix: wire contract\n src/a.ts | 2 +-',
      },
    })
  })
  await page.goto(serializePlatformRoute({ module_id: 'planning', scope: projectScope }))
  await page.locator('.work-item-column[data-state="dev"] .work-item-tile').first().click()
  const drawer = page.locator('.drawer')
  const entry = drawer.locator('.thread-entry').filter({ hasText: 'Delivered' })
  const held = entry.locator('.collapsible-text')

  // Headings in the text are emphasised paragraphs, under the card's own outline.
  await expect(entry.locator('h1, h2, h3, h4, h5, h6')).toHaveCount(0)
  await expect(entry.locator('.rich-heading')).toHaveText('Delivered')
  await expect(entry.locator('li')).toHaveCount(18)

  // Held to ten lines of 24px, ending on the last whole line of text.
  const box = await held.evaluate((element) => {
    const range = document.createRange()
    range.selectNodeContents(element)
    const { top } = element.getBoundingClientRect()
    const bottom = top + element.clientHeight
    const crossing = [...range.getClientRects()].filter(
      (rect) => rect.height > 0 && rect.top < bottom - 0.5 && rect.bottom > bottom + 0.5,
    )
    return {
      held: element.clientHeight,
      full: element.scrollHeight,
      crossing: crossing.filter((rect) => rect.height < 40).length,
    }
  })
  expect(box.held).toBeLessThanOrEqual(240)
  expect(box.held).toBeGreaterThan(200)
  expect(box.full).toBeGreaterThan(box.held * 2)
  expect(box.crossing).toBe(0)
  await entry.getByRole('button', { name: 'Show all', exact: true }).click()
  await expect.poll(() => held.evaluate((element) => element.clientHeight)).toBe(box.full)
  await entry.getByRole('button', { name: 'Show less', exact: true }).click()
  await expect.poll(() => held.evaluate((element) => element.clientHeight)).toBe(box.held)

  // References link only where they resolve; unsafe markup stays text.
  await expect(entry.getByRole('link', { name: 'MAIN-265' })).toHaveCount(2)
  for (const role of ['button', 'link'] as const) {
    await expect(entry.getByRole(role, { name: 'MAIN-999' })).toHaveCount(0)
    await expect(entry.getByRole(role, { name: 'SHA-256' })).toHaveCount(0)
  }
  await expect(entry).toContainText('MAIN-999 and SHA-256 stay text.')
  await expect(entry.locator('a[href^="javascript"], b, img')).toHaveCount(0)
  await expect(entry).toContainText('<b>raw</b>')
  const notes = entry.getByRole('link', { name: 'Notes' })
  await expect(notes).toHaveAttribute('target', '_blank')
  await expect(notes).toHaveAttribute('rel', 'noopener noreferrer')

  // Tab into a link below the cut opens the text rather than scrolling it.
  await notes.focus()
  await expect(entry.getByRole('button', { name: 'Show less', exact: true })).toBeVisible()
  expect(await held.evaluate((element) => element.scrollTop)).toBe(0)
  // Opened, the text has moved the link; the reader's place goes with it.
  await expect(notes).toBeInViewport()
  await expectNoSilentClipping(page, 'Markdown report at 1440px')

  // A commit the card carries opens its record; the dialog closes back onto the card.
  await entry.getByRole('button', { name: 'a1b2c3d' }).click()
  const record = page.getByRole('dialog', { name: 'Commit' })
  await expect(record).toContainText('fix: wire contract')
  await expect(record).toContainText('src/a.ts | 2 +-')
  // Asked with the card's exact space, so the project's own repository is searched.
  expect(lookups.map((query) => [query.get('value'), query.get('space')])).toEqual([
    ['a1b2c3d4e5f6', planningSpaceEntity(spaceRef).resource_id],
  ])
  await page.keyboard.press('Escape')
  await expect(record).toHaveCount(0)
  await expect(drawer).toHaveCount(1)

  // Another task of the space opens in the card, and Back returns here.
  await entry.getByRole('link', { name: 'MAIN-265' }).first().click()
  await expect(drawer.locator('.head-reference')).toHaveText('MAIN-265')
  await drawer.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(drawer.locator('.head-reference')).toHaveText('MAIN-264')
})

test('a line that holds a reference is as tall as a line of plain text', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const backend = await installDiscussionBackend(page)
  backend.item.refs.push({
    kind: 'commit',
    value: 'a1b2c3d4e5f6',
    label: 'fix: wire contract',
    author: 'agent',
    at: now,
  })
  await page.route('**/api/ref?*', (route) =>
    route.fulfill({
      json: {
        kind: 'commit',
        value: 'a1b2c3d4e5f6',
        resolved: true,
        repository: '/work/repo',
        detail: '',
      },
    }),
  )
  backend.item.comments.push({
    id: 2,
    kind: 'report',
    ...asRoot,
    report: {
      done: [
        'Plain line one',
        // A work item reference in prose, and a commit hash as code (monospace, smaller).
        'Line two holds MAIN-265 and `a1b2c3d` in its text',
        'Plain line three',
        '',
        'Plain paragraph one',
        'Plain paragraph two',
        'Plain paragraph three',
      ].join('\n'),
      next: '',
      why: '',
    },
    body: '',
    author: 'agent',
    at: now,
    checklist_item_id: null,
    checklist_item_text: null,
  })
  await page.goto(serializePlatformRoute({ module_id: 'planning', scope: projectScope }))
  await page.locator('.work-item-column[data-state="dev"] .work-item-tile').first().click()
  // The panel slides in from past the screen's edge, where a hit test finds nothing.
  await expect(page.locator('.drawer')).toHaveCSS('transform', 'none')
  const entry = page.locator('.drawer .thread-entry').filter({ hasText: 'Plain line one' })
  // The first paragraph holds the reference in its second of three lines; the
  // second is three lines of plain text, the control.
  const referenced = entry.locator('.rich-paragraph').nth(0)
  const plain = entry.locator('.rich-paragraph').nth(1)
  await expect(referenced.locator('.rich-reference')).toHaveText(['MAIN-265', 'a1b2c3d'])

  const measure = (locator: typeof referenced) =>
    locator.evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      line: Number.parseFloat(getComputedStyle(element).lineHeight),
    }))
  const withReference = await measure(referenced)
  // The pointer target is what the pointer hits, so the line box does not have to grow to
  // hold it.
  const references = referenced.locator('.rich-reference')
  await expect(references).toHaveCount(2)
  const targets = [
    await references.nth(0).evaluate(pointerBand),
    await references.nth(1).evaluate(pointerBand),
  ]
  const control = await measure(plain)

  // Three lines each: a reference must not make its line taller than the text beside it.
  expect(control.height).toBeCloseTo(3 * control.line, 0)
  expect(withReference.height).toBeCloseTo(control.height, 0)
  // Every pointer target, prose and monospace alike, stays at least 24px tall.
  // A reference with a hover card is the same box as one without: the card is not in the text.
  await expect(referenced.locator('.rich-reference').first()).toHaveAttribute(
    'data-reference-preview',
  )
  await expect(referenced.locator('.rich-reference').nth(1)).not.toHaveAttribute(
    'data-reference-preview',
  )
  for (const target of targets) expect(target).toBeGreaterThanOrEqual(24)
})

test('a new task is described in the markdown editor, inside the dialog that owns Escape', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await installDiscussionBackend(page)
  const searched: URLSearchParams[] = []
  await page.route('**/api/planning/search?*', (route) => {
    searched.push(new URL(route.request().url()).searchParams)
    return route.fulfill({
      json: {
        interface_version: 'valkama-planning-api',
        work_items: [
          {
            work_item_id: blockedWorkItem.work_item_id,
            planning_space_id: planningSpace.planning_space_id,
            reference: blockedWorkItem.reference,
            title: blockedWorkItem.title,
            state: { name: 'Doing' },
            claim_ref: '',
          },
        ],
      },
    })
  })
  const created: Record<string, unknown>[] = []
  await page.route('**/api/planning/work-items', (route) => {
    created.push(route.request().postDataJSON() as Record<string, unknown>)
    return route.fulfill({ json: workItem })
  })
  await page.goto(serializePlatformRoute({ module_id: 'planning', scope: projectScope }))
  const opener = page.getByRole('button', { name: 'New work item' })
  await opener.click()
  const dialog = page.getByRole('dialog', { name: 'New work' })
  await dialog.getByRole('textbox', { name: 'Title' }).fill('Ship the parser')
  const description = dialog.getByRole('textbox', { name: 'Description' })
  await description.click()
  await page.keyboard.type('After @blo')
  const list = dialog.getByRole('listbox', { name: 'Mentions' })
  await expect(list).toContainText(blockedWorkItem.title)
  expect(searched.at(-1)?.get('space')).toBe(planningSpace.planning_space_id)
  await expectNoSilentClipping(page, 'New task with @ suggestions at 390px')

  // Escape closes the list and leaves the dialog and the text as they were.
  await page.keyboard.press('Escape')
  await expect(list).toHaveCount(0)
  await expect(dialog).toBeVisible()
  await expect(description).toHaveValue('After @blo')
  await expect(description).toBeFocused()

  // The list again, and Enter writes the chosen reference in place of the query.
  await page.keyboard.type('c')
  await expect(list).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(description).toHaveValue(`After ${blockedWorkItem.reference} `)
  await page.keyboard.type('**first**')

  // The preview is the text as the card will draw it, and Write returns to it.
  await dialog.getByRole('tab', { name: 'Preview', exact: true }).click()
  await expect(dialog.locator('.markdown-preview strong')).toHaveText('first')
  // A reference stays text here: opening a card from a modal put it behind the dialog.
  await expect(dialog.locator('.markdown-preview')).toContainText(blockedWorkItem.reference)
  await expect(dialog.getByRole('button', { name: blockedWorkItem.reference })).toHaveCount(0)
  await expect(dialog.getByRole('link', { name: blockedWorkItem.reference })).toHaveCount(0)
  await dialog.getByRole('tab', { name: 'Write', exact: true }).click()

  // Ctrl+Enter is the dialog's Create.
  await description.focus()
  await page.keyboard.press('Control+Enter')
  await expect(dialog).toHaveCount(0)
  expect(created).toEqual([
    expect.objectContaining({
      title: 'Ship the parser',
      description: `After ${blockedWorkItem.reference} **first**`,
    }),
  ])
})

test('Escape closes the new-task dialog once no list is open, and focus goes back', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installDiscussionBackend(page)
  await page.goto(serializePlatformRoute({ module_id: 'planning', scope: projectScope }))
  const opener = page.getByRole('button', { name: 'New work item' })
  await opener.click()
  const dialog = page.getByRole('dialog', { name: 'New work' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('textbox', { name: 'Description' }).fill('A draft')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(opener).toBeFocused()
})
