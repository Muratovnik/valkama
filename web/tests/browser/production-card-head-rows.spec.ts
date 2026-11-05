/**
 * The head of a card as three labelled rows, in the built application: what holds for the
 * item, who is on it with the action about them, and the labels. The head was one crowded
 * block: the holder stood as a plate of the same weight as the chips around it, under a
 * button on another row, and the rows stood 4px apart.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { finishedCard, heldCard, openPlanFor, shortHolderCard } from './openSessionFixtures.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { blockedWorkItem, projectScope, workItem, workItemRef } from './planningFixtures.ts'
import { asked, installQuestions } from './questionBackend.ts'
import { test } from './test.ts'

const CARD = serializePlatformRoute({
  module_id: 'planning',
  scope: projectScope,
  entity: planningWorkItemEntity(workItemRef),
})

/** The room the head keeps between its rows: `--space-3`. */
const ROW_GAP = 12
/** The height of a compact control, which every fact of a row stands at. */
const ROW_HEIGHT = 36
/** Below this drawer width the action stands under the labels at full width. */
const WIDE = 1280
const PHONE = 390

interface Opened {
  asking?: boolean
  closed?: boolean
  epic?: boolean
  locale?: 'en' | 'ru'
  longRead?: boolean
  width?: number
  card?: (read: Record<string, unknown>) => object
}

/** The item in its epic: the card's read says its id, the space's whose reference that is. */
const inEpic = (model: Record<string, unknown>) => ({
  ...model,
  work_items: (model.work_items as { work_item_id: string }[]).map((item) =>
    item.work_item_id === workItem.work_item_id
      ? { ...item, parent_id: blockedWorkItem.work_item_id }
      : item,
  ),
})

async function openHead(page: Page, opened: Opened = {}) {
  const { asking, card, closed, epic, locale = 'ru', longRead, width = WIDE } = opened
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  await page.setViewportSize({ width, height: 900 })
  await installBackend(page, {
    card: epic
      ? (read) => ({ ...(card?.(read) ?? read), parent_id: blockedWorkItem.work_item_id })
      : card,
    closedWith: closed ? 'It is done.' : undefined,
    longRead,
    openPlan: openPlanFor,
    ...(epic ? { space: inEpic } : {}),
  })
  if (asking) await installQuestions(page, [asked()])
  await page.goto(CARD)
  const drawer = page.locator('.drawer')
  await expect(drawer.locator('.card-facts')).toBeVisible()
  await expect(drawer).toHaveCSS('transform', 'none')
  return drawer
}

async function box(locator: Locator) {
  const bounds = await locator.boundingBox()
  if (!bounds) throw new Error('not laid out')
  return { ...bounds, bottom: bounds.y + bounds.height, right: bounds.x + bounds.width }
}

const inkOf = (target: Locator) => target.evaluate((node) => getComputedStyle(node).color)

/** A token's colour in the form the computed style reports it, read through a probe. */
const tokenInk = (page: Page, token: string) =>
  page.evaluate((name) => {
    const probe = document.createElement('span')
    probe.style.color = `var(${name})`
    document.body.append(probe)
    const ink = getComputedStyle(probe).color
    probe.remove()
    return ink
  }, token)

const middle = (bounds: { height: number; y: number }) => bounds.y + bounds.height / 2

/** Where the words of a holder's name stand, which a button's inset does not move. */
const wordsOf = (name: Locator) =>
  name.evaluate((node) => {
    const range = document.createRange()
    range.selectNodeContents(node)
    const { left, right, top, bottom } = range.getBoundingClientRect()
    return { left, right, top, bottom, middle: (top + bottom) / 2 }
  })

for (const width of [WIDE, PHONE]) {
  test(`with every fact the rows stand apart and each stands at one height, at ${width}px`, async ({
    page,
  }) => {
    const drawer = await openHead(page, {
      asking: true,
      card: shortHolderCard,
      epic: true,
      width,
    })
    const facts = drawer.locator('.card-facts')
    const holder = drawer.locator('.card-holder')
    await expect(drawer.locator('.card-question')).toBeVisible()
    // The state, the question, the priority and the epic are the first row.
    await expect(facts).toContainText(blockedWorkItem.reference)
    const cells = [
      facts.locator('.card-state').first(),
      facts.locator('.card-question'),
      ...(await facts.locator('.card-fact').all()),
    ]
    expect(cells).toHaveLength(4)
    const cellBoxes = await Promise.all(cells.map((cell) => box(cell)))
    for (const cell of cellBoxes) expect(cell.height).toBe(ROW_HEIGHT)
    const firstLine = cellBoxes.filter((cell) => Math.abs(cell.y - cellBoxes[0].y) < 1)
    expect(firstLine.length).toBeGreaterThan(1)
    for (const cell of firstLine) expect(middle(cell)).toBeCloseTo(middle(cellBoxes[0]), 0)

    const factsBox = await box(facts)
    const holderBox = await box(holder)
    const labelsBox = await box(drawer.locator('.card-labels'))
    expect(holderBox.y - factsBox.bottom).toBeCloseTo(ROW_GAP, 0)
    expect(labelsBox.y - holderBox.bottom).toBeCloseTo(ROW_GAP, 0)
    await expectNoSilentClipping(page, `the head with every fact at ${width}px`)
  })
}

test('the holder and the action about it stand on one row, the action at its end', async ({
  page,
}) => {
  const drawer = await openHead(page, { card: shortHolderCard })
  const holder = drawer.locator('.card-holder')
  const action = drawer.locator('.card-action').getByRole('button')
  await expect(action).toHaveText('Забрать себе')
  const holderBox = await box(holder)
  const actionBox = await box(action)
  expect(actionBox.y).toBeCloseTo(holderBox.y, 0)
  expect(actionBox.height).toBe(ROW_HEIGHT)
  expect(holderBox.height).toBe(ROW_HEIGHT)
  const blockBox = await box(drawer.locator('.card-facts-block'))
  expect(actionBox.right).toBeCloseTo(blockBox.right, 0)

  // The label, in the quiet ink, a word's room from the words of the holder.
  const label = holder.locator('.card-holder-label')
  await expect(label).toHaveText('Исполняет')
  const name = holder.locator('.open-action-name')
  const labelWords = await wordsOf(label)
  const nameWords = await wordsOf(name)
  expect(nameWords.left - labelWords.right).toBeCloseTo(8, 0)
  expect(Math.abs(nameWords.middle - labelWords.middle)).toBeLessThanOrEqual(1.5)
  expect(await inkOf(label)).not.toBe(await inkOf(name))

  // A link and no plate: nothing under its words until the pointer is.
  const link = holder.locator('button.open-action')
  await expect(link).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(link).toHaveAttribute('title', /claude \(session /u)
  // The label is on the screen, so nothing hidden says it again.
  await expect(holder.locator('.visually-hidden').getByText('Ответственный')).toHaveCount(0)
  expect(await holder.ariaSnapshot()).not.toContain('Ответственный')
})

test('with no labels there is no row and none of its room', async ({ page }) => {
  const drawer = await openHead(page, {
    card: (read) => ({ ...shortHolderCard(read), labels: [] }),
  })
  await expect(drawer.locator('.card-labels')).toHaveCount(0)
  const blockBox = await box(drawer.locator('.card-facts-block'))
  const actionBox = await box(drawer.locator('.card-action'))
  expect(blockBox.bottom).toBeCloseTo(actionBox.bottom, 0)
})

for (const width of [WIDE, PHONE]) {
  test(`with one fact the head keeps its rows and adds no room, at ${width}px`, async ({
    page,
  }) => {
    const drawer = await openHead(page, {
      width,
      closed: true,
      card: (read) => ({ ...read, claim: null, claim_ref: '', claim_state: null, labels: [] }),
    })
    // Finished, held by nobody, with nothing to do: a state, a priority and that word.
    await expect(drawer.locator('.card-action .write-actions')).toHaveCount(0)
    const holder = drawer.locator('.card-holder')
    await expect(holder).toContainText('Никто не взял')
    await expect(holder.locator('.card-holder-label')).toHaveCount(0)
    const blockBox = await box(drawer.locator('.card-facts-block'))
    const holderBox = await box(holder)
    expect(blockBox.bottom).toBeCloseTo(holderBox.bottom, 0)
    const factsBox = await box(drawer.locator('.card-facts'))
    expect(holderBox.y - factsBox.bottom).toBeCloseTo(ROW_GAP, 0)
  })
}

test('with nobody on the item the row keeps its label, its word and its action', async ({
  page,
}) => {
  const drawer = await openHead(page, {
    card: (read) => ({ ...read, claim: null, claim_ref: '', claim_state: null, links: [] }),
  })
  const holder = drawer.locator('.card-holder')
  await expect(holder.locator('.card-holder-label')).toHaveText('Исполняет')
  await expect(holder).toContainText('Никто не взял')
  const action = drawer.locator('.card-action').getByRole('button', { name: 'Взять', exact: true })
  const actionBox = await box(action)
  const holderBox = await box(holder)
  expect(actionBox.y).toBeCloseTo(holderBox.y, 0)
})

for (const locale of ['ru', 'en'] as const) {
  test(`on a closed item the past takes the label's place, in ${locale}`, async ({ page }) => {
    const drawer = await openHead(page, { card: finishedCard, closed: true, locale })
    const label = drawer.locator('.card-holder .card-holder-label')
    await expect(label).toHaveText(locale === 'ru' ? 'Ранее отвечал' : 'Previously responsible')
    await expect(label).toHaveCSS('font-size', '13px')
    await expect(drawer.locator('.card-holder button.open-action')).toBeVisible()
    // Said once, with no colon left over from the sentence it was.
    await expect(drawer.locator('.card-holder')).not.toContainText(':')
    await expect(drawer.locator('.card-action .write-actions')).toHaveCount(0)
  })
}

test('a holder nobody can press is the same line, and the stale mark stays beside it', async ({
  page,
}) => {
  const drawer = await openHead(page, {
    card: (read) => ({
      ...read,
      claim_state: 'stale',
      claim: { ...(read.claim as object), state: 'stale' },
    }),
  })
  const holder = drawer.locator('.card-holder')
  await expect(holder.locator('.card-holder-label')).toHaveText('Исполняет')
  await expect(holder.locator('.card-holder-name')).toHaveText('codex')
  await expect(holder.locator('.card-holder-stale')).toBeVisible()
  await expect(holder).toHaveAttribute('title', /^codex\n/u)
  const labelWords = await wordsOf(holder.locator('.card-holder-label'))
  const nameWords = await wordsOf(holder.locator('.card-holder-name'))
  expect(nameWords.left - labelWords.right).toBeCloseTo(8, 0)
  expect(Math.abs(nameWords.middle - labelWords.middle)).toBeLessThanOrEqual(1.5)
})

for (const width of [WIDE, PHONE]) {
  test(`a claim is a bare action in the text ink, filled only under the pointer, at ${width}px`, async ({
    page,
  }) => {
    const drawer = await openHead(page, {
      width,
      card: (read) => ({ ...read, claim: null, claim_ref: '', claim_state: null, links: [] }),
    })
    const action = drawer
      .locator('.card-action')
      .getByRole('button', { name: 'Взять', exact: true })
    await expect(action).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    expect(await inkOf(action)).toBe(await tokenInk(page, '--color-text'))
    const actionBox = await box(action)
    expect(actionBox.height).toBe(ROW_HEIGHT)
    await action.hover()
    await expect(action).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    expect(await inkOf(action)).toBe(await tokenInk(page, '--color-text'))
  })

  test(`a takeover is a bare action in the quiet ink, at ${width}px`, async ({ page }) => {
    const drawer = await openHead(page, { card: shortHolderCard, width })
    const takeover = drawer
      .locator('.card-action')
      .getByRole('button', { name: 'Забрать себе', exact: true })
    await expect(takeover).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    expect(await inkOf(takeover)).toBe(await tokenInk(page, '--color-text-muted'))
    const takeoverBox = await box(takeover)
    expect(takeoverBox.height).toBe(ROW_HEIGHT)
  })
}

test('on a phone the action stands under the labels at the whole width', async ({ page }) => {
  const drawer = await openHead(page, { card: shortHolderCard, width: PHONE })
  const action = await box(drawer.locator('.card-action').getByRole('button'))
  const labels = await box(drawer.locator('.card-labels'))
  const block = await box(drawer.locator('.card-facts-block'))
  expect(action.y - labels.bottom).toBeCloseTo(ROW_GAP, 0)
  expect(action.width).toBeCloseTo(block.width, 0)
})

test('on a phone a long holder gives way with an ellipsis and stays whole in its tooltip', async ({
  page,
}) => {
  const drawer = await openHead(page, { card: heldCard, width: PHONE })
  const holder = drawer.locator('.card-holder')
  const name = holder.locator('.open-action-name')
  await expect(name).toHaveCSS('text-overflow', 'ellipsis')
  const cut = await name.evaluate((node) => node.scrollWidth > node.clientWidth)
  expect(cut, 'a name wider than the line is cut').toBe(true)
  await expect(holder).toHaveAttribute('title', /a-coordinator-with-a-name-long-enough-to-run-out/u)
  const block = await box(drawer.locator('.card-facts-block'))
  const link = await box(holder.locator('button.open-action'))
  expect(link.right).toBeLessThanOrEqual(block.right)
  await expectNoSilentClipping(page, 'a long holder on a phone')
})

for (const width of [WIDE, PHONE]) {
  test(`the bar takes the action over only once its row has gone, at ${width}px`, async ({
    page,
  }) => {
    const drawer = await openHead(page, { card: shortHolderCard, longRead: true, width })
    const body = drawer.locator('.drawer-frame-body')
    const inBar = drawer.locator('.drawer-frame-bar .drawer-frame-action').getByRole('button')
    await expect(inBar).toBeHidden()
    const gone = await drawer.locator('.card-action').evaluate((cell) => {
      const scroller = cell.closest('.drawer-frame-body')
      return (
        cell.getBoundingClientRect().bottom -
        (scroller?.getBoundingClientRect().top ?? 0) +
        (scroller?.scrollTop ?? 0)
      )
    })
    await body.evaluate((node, at) => node.scrollTo({ top: at }), Math.floor(gone) - 2)
    await expect(drawer.locator('.card-action').getByRole('button')).toBeInViewport()
    await expect(inBar).toBeHidden()
    await body.evaluate((node, at) => node.scrollTo({ top: at }), Math.ceil(gone) + 2)
    await expect(inBar).toBeVisible()
    await expect(inBar).toHaveText('Забрать себе')
    // The bar takes the head's action as it is: the same bare, quiet takeover.
    await expect(inBar).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    expect(await inkOf(inBar)).toBe(await tokenInk(page, '--color-text-muted'))
    await inBar.click()
    await expect(drawer.locator('.drawer-frame-notices .confirm-strip')).toBeVisible()
  })
}
