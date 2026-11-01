import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { parsePlatformRoute, serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { largeChainHere, serve } from './chainFixtures.ts'
import { expectNoSilentClipping } from './overflow.ts'
import {
  blockedWorkItem,
  projectId,
  projectScope,
  spaceRef,
  workItem,
  workItemRef,
} from './planningFixtures.ts'

for (const width of [1440, 390]) {
  test(`inspector overlays the unchanged board and Escape returns focus at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await installBackend(page)
    await page.goto(serializePlatformRoute({ module_id: 'planning', scope: projectScope }))
    const workspace = page.locator('.workspace')
    const opener = page.locator('.work-item-column[data-state="dev"] .tile-open').first()
    await expect(opener).toBeVisible()
    const before = await workspace.boundingBox()
    await opener.click()
    const drawer = page.locator('.drawer')
    await expect(drawer).toBeVisible()
    await expect(drawer).toHaveCSS('transform', 'none')
    await expect(drawer.locator('.head-reference')).toHaveText(workItemRef.reference)
    expect(await workspace.boundingBox()).toEqual(before)
    const bounds = await drawer.boundingBox()
    expect(bounds).not.toBeNull()
    expect(bounds?.x).toBeGreaterThanOrEqual(0)
    expect((bounds?.x ?? Infinity) + (bounds?.width ?? Infinity)).toBeLessThanOrEqual(width)
    await page.keyboard.press('Escape')
    await expect(drawer).toHaveCount(0)
    await expect(opener).toBeFocused()
    await expect.poll(() => parsePlatformRoute(page.url()).entity?.kind).toBe('planning-space')
    expect(await workspace.boundingBox()).toEqual(before)
  })
}

test('Russian relations keep one hierarchy, aligned controls, and narrow content readable', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('valkama-locale', 'ru'))
  await page.setViewportSize({ width: 1440, height: 1000 })
  await installBackend(page)
  await page.goto(serializePlatformRoute({ module_id: 'planning', scope: projectScope }))
  await page.locator('.work-item-column[data-state="dev"] .work-item-tile').first().click()
  const drawer = page.locator('.drawer')
  // The holder is named once, among the facts in the head, and the body holds
  // no fact grid that says it again (a step's own holder is the step's).
  await expect(drawer.locator('.drawer-frame-head .card-holder')).toContainText(
    /Ответственный:\s*codex/u,
  )
  await expect(drawer.locator('.drawer-frame-body')).not.toContainText('Ответственный')
  await drawer.getByRole('button', { name: 'Отчёт о работе', exact: true }).click()
  const result = drawer.getByRole('textbox', { name: 'Что сделано', exact: true })
  const longDraft =
    'Проверены связи между задачами, история решений и подробное описание результата. '.repeat(8)
  await result.fill(longDraft)
  await expect(result).toHaveValue(longDraft)
  await expect(result).toHaveCSS('font-size', '15px')
  const resultBox = await result.boundingBox()
  expect(resultBox?.height).toBeGreaterThanOrEqual(140)
  await drawer.getByRole('button', { name: 'Связи', exact: true }).click()
  await expect(drawer.getByRole('heading', { name: /^Связанная работа/ })).toHaveCount(1)
  await expect(drawer.getByRole('heading', { name: 'Свидетельства', exact: true })).toHaveCount(1)
  await expect(drawer.getByRole('heading', { name: 'Внешние ресурсы', exact: true })).toHaveCount(0)
  const splitter = drawer.getByRole('separator')
  await splitter.press('End')
  const add = drawer.getByRole('button', { name: 'Добавить связь', exact: true })
  await add.click()
  const picker = page.getByRole('dialog', { name: 'Связанная задача', exact: true })
  await expect(picker).toBeVisible()
  await expect(picker.getByRole('combobox', { name: 'Тип связи', exact: true })).toBeVisible()
  await expect(picker.getByRole('combobox', { name: 'Направление', exact: true })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 900 })
  await expectNoSilentClipping(page, 'Russian inspector relations at 390px')
  await expect(
    picker.getByRole('textbox', { name: 'Ссылка, номер или название', exact: true }),
  ).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(picker).toHaveCount(0)
  await expect(drawer).toBeVisible()
  await expect(add).toBeFocused()
})

test('an unsent comment survives browser Back, global search and a reload until it is let go', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  await page.route('**/api/modules/planning/search?*', (route) =>
    route.fulfill({
      json: {
        interface_version: 'valkama-planning-search',
        query: blockedWorkItem.reference,
        limit: 50,
        has_more: false,
        items: [
          {
            target: {
              project_id: projectId,
              space_ref: spaceRef,
              reference: blockedWorkItem.reference,
              writable: true,
            },
            item: {
              work_item_id: blockedWorkItem.work_item_id,
              planning_space_id: workItem.planning_space_id,
              reference: blockedWorkItem.reference,
              title: blockedWorkItem.title,
              state: { name: 'Todo' },
              claim_ref: '',
            },
          },
        ],
        coverage: [
          { project_id: projectId, space_ref: spaceRef, status: 'searched', reason: null },
        ],
      },
    }),
  )
  await page.goto(serializePlatformRoute({ module_id: 'planning', scope: projectScope }))
  await page.locator('.work-item-column[data-state="dev"] .work-item-tile').first().click()
  const drawer = page.locator('.drawer')
  await expect(drawer.locator('.head-reference')).toHaveText(workItemRef.reference)
  const itemUrl = page.url()
  const strip = drawer.locator('.confirm-strip')
  const comment = drawer.getByRole('textbox', { name: 'Comment', exact: true })
  /** What a reload or a closing tab sends: whether the page holds it. */
  const reloadHeld = () =>
    page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(event)
      return event.defaultPrevented
    })
  const findAndOpen = async () => {
    await page.keyboard.press('Control+k')
    const finder = page.getByRole('dialog', { name: 'Find a task', exact: true })
    await finder.getByRole('combobox').fill(blockedWorkItem.reference)
    await expect(finder.getByRole('option')).toContainText(blockedWorkItem.title)
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(finder).toBeHidden()
  }

  expect(await reloadHeld()).toBe(false)
  await comment.fill('Half a thought')
  expect(await reloadHeld()).toBe(true)

  // Browser Back asks; keeping the draft steps history back to the item.
  await page.goBack()
  await expect(strip).toContainText('Unsaved changes will be lost: comment')
  await strip.getByRole('button', { name: 'Keep editing', exact: true }).click()
  await expect(strip).toHaveCount(0)
  await expect(page).toHaveURL(itemUrl)
  await expect(comment).toHaveValue('Half a thought')

  // A route change the inspector did not start asks the same question.
  await findAndOpen()
  await expect(strip).toContainText('Unsaved changes will be lost: comment')
  await strip.getByRole('button', { name: 'Keep editing', exact: true }).click()
  await expect(page).toHaveURL(itemUrl)
  await expect(comment).toHaveValue('Half a thought')

  // Discarding lets the same move through, and the next item opens.
  await findAndOpen()
  await strip.getByRole('button', { name: 'Discard', exact: true }).click()
  await expect(page).toHaveURL(
    serializePlatformRoute({
      module_id: 'planning',
      scope: projectScope,
      entity: planningWorkItemEntity({ space_ref: spaceRef, reference: blockedWorkItem.reference }),
    }),
  )
  await expect(drawer.locator('.head-reference')).toHaveText(blockedWorkItem.reference)
  expect(await reloadHeld()).toBe(false)

  // With nothing typed, Back simply goes back.
  await page.goBack()
  await expect(drawer.locator('.head-reference')).toHaveText(workItemRef.reference)
  await expect(strip).toHaveCount(0)
})

async function topOf(locator: Locator): Promise<number> {
  const box = await locator.boundingBox()
  return box?.y ?? 0
}

async function heightOf(locator: Locator): Promise<number> {
  const box = await locator.boundingBox()
  return box?.height ?? 0
}

async function rightOf(locator: Locator): Promise<number> {
  const box = await locator.boundingBox()
  return (box?.x ?? 0) + (box?.width ?? 0)
}

for (const width of [1440, 390]) {
  test(`the card's head names every section and gives its room back while the body is read at ${width}px`, async ({
    page,
  }) => {
    await page.addInitScript(() => localStorage.setItem('valkama-locale', 'ru'))
    await page.setViewportSize({ width, height: 700 })
    await installBackend(page, { longRead: true })
    await page.goto(serializePlatformRoute({ module_id: 'planning', scope: projectScope }))
    await page.locator('.work-item-column[data-state="dev"] .work-item-tile').first().click()
    const drawer = page.locator('.drawer')
    const head = drawer.locator('.drawer-frame-head')
    await expect(drawer.locator('.head-reference')).toHaveText(workItemRef.reference)

    // Every section is named whole on the strip: no scrollbar, nothing cut off.
    const tabs = drawer.locator('.inspector-tabs')
    const strip = await tabs.evaluate((node) => ({
      overflow: node.scrollWidth - node.clientWidth,
      bar: getComputedStyle(node).overflowX,
    }))
    expect(strip).toEqual({ overflow: 0, bar: 'visible' })
    const edge = await rightOf(tabs)
    for (const tab of await tabs.getByRole('button').all())
      expect(await rightOf(tab)).toBeLessThanOrEqual(edge + 0.5)
    await expect(tabs.getByRole('button', { name: 'Системные события', exact: true })).toBeVisible()

    // Read down the body: the head condenses, and the text glides up into the room
    // it gave back. The first step moves the text by the distance scrolled and by
    // that room; each step after moves it by the distance scrolled alone.
    const whole = await heightOf(head)
    const body = drawer.locator('.drawer-frame-body')
    await body.hover()
    const probe = drawer.locator('.drawer-frame-body .overview > :first-child')
    let before = await topOf(probe)
    await page.mouse.wheel(0, 80)
    await expect(head).toHaveClass(/condensed/u)
    // The head is read with the text: the frame after the class lands, the sections'
    // row takes its last 4px.
    await expect
      .poll(async () => (await topOf(probe)) - (before - 80 - (whole - (await heightOf(head)))))
      .toBeCloseTo(0, 0)
    expect(whole - (await heightOf(head))).toBeGreaterThan(20)
    before = await topOf(probe)
    for (let step = 0; step < 5; step += 1) {
      await page.mouse.wheel(0, 80)
      await expect.poll(() => topOf(probe)).toBeCloseTo(before - 80, 0)
      before -= 80
    }
    await expect(head).toHaveClass(/condensed/u)
    await expect(drawer.locator('.head-reference')).toBeHidden()

    // Back at the top the head is whole again.
    await body.evaluate((node) => node.scrollTo({ top: 0 }))
    await expect(head).not.toHaveClass(/condensed/u)
    await expect.poll(() => heightOf(head)).toBeCloseTo(whole, 0)
  })
}

// A card's chain members walked from the keyboard: a long group opened and
// closed again without focus falling out of the drawer, and a member opened and
// left by Back, which brings the reader to the same place.
async function openChain(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 })
  await installBackend(page)
  await serve(page, largeChainHere())
  await page.goto(
    serializePlatformRoute({
      module_id: 'planning',
      scope: projectScope,
      entity: planningWorkItemEntity(workItemRef),
    }),
  )
  const section = page.locator('.drawer section.chain')
  await expect(section).toBeVisible()
  return section
}

const focusOnPage = (page: Page) => page.evaluate(() => document.activeElement === document.body)

for (const width of [1440, 390]) {
  test(`a long member group opens and closes from the keyboard, focus held, at ${width}px`, async ({
    page,
  }) => {
    const section = await openChain(page, width)
    const group = section.locator('section.chain-group[aria-label="Backlog"]')
    const toggle = group.locator('.chain-more')
    await expect(toggle).toHaveText('Show all · 107')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    const list = await toggle.getAttribute('aria-controls')
    await expect(group.locator('ul')).toHaveAttribute('id', list ?? '')

    // Opened: focus moves to the first row it revealed, inside the drawer's view.
    await toggle.focus()
    await page.keyboard.press('Enter')
    const revealed = group.locator('.chain-row').nth(8)
    await expect(revealed).toBeFocused()
    await expect(revealed).toBeInViewport()
    await expect(toggle).toHaveText('Show fewer')
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(await focusOnPage(page)).toBe(false)

    // Closed: the short list, and focus back on the toggle, brought into view.
    await toggle.focus()
    await page.keyboard.press('Enter')
    await expect(toggle).toBeFocused()
    await expect(toggle).toBeInViewport()
    await expect(group.locator('.chain-row')).toHaveCount(8)
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(await focusOnPage(page)).toBe(false)
  })

  test(`Back reopens the parent where it was read, focus on the member it opened, at ${width}px`, async ({
    page,
  }) => {
    const section = await openChain(page, width)
    const drawer = page.locator('.drawer')
    const body = drawer.locator('.drawer-frame-body')
    const group = section.locator('section.chain-group[aria-label="Backlog"]')
    await group.locator('.chain-more').click()
    const row = group.locator('.chain-row').nth(20)
    const reference = (await row.getAttribute('data-reference')) ?? ''
    await row.evaluate((element) => element.scrollIntoView({ block: 'center' }))
    // The head condensed under the scroll glides its text into place; the row's place is read once it has settled.
    await expect
      .poll(() => body.evaluate((element) => element.getAnimations({ subtree: true }).length))
      .toBe(0)
    const before = await body.evaluate((element) => element.scrollTop)
    const rowTop = () =>
      drawer
        .locator(`.chain-row[data-reference="${reference}"]`)
        .evaluate((element) => element.getBoundingClientRect().top)
    const topBefore = await rowTop()
    expect(before).toBeGreaterThan(300)

    await row.focus()
    await page.keyboard.press('Enter')
    await expect(drawer.locator('.head-back')).toBeVisible()
    await drawer.locator('.head-back').click()

    // The parent is read again from the same depth, with the member's row under focus.
    const back = drawer.locator(`.chain-row[data-reference="${reference}"]`)
    await expect(back).toBeFocused()
    expect(Math.abs((await body.evaluate((element) => element.scrollTop)) - before)).toBeLessThan(2)
    expect(Math.abs((await rowTop()) - topBefore)).toBeLessThan(2)
  })
}
