import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { projectScope, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

/**
 * A card's head scrolls with its text, and reading down it changes no layout: what
 * moves is the scroll and nothing else, at every position, in either direction. A
 * head with two layouts flipped at the first scroll is what this exists to refuse.
 */

const CARD = serializePlatformRoute({
  module_id: 'planning',
  scope: projectScope,
  entity: planningWorkItemEntity(workItemRef),
})

async function openLongCard(page: Page, width: number) {
  await page.addInitScript(() => localStorage.setItem('valkama-locale', 'ru'))
  await page.setViewportSize({ width, height: 844 })
  await installBackend(page, { longRead: true })
  await page.goto(CARD)
  const drawer = page.locator('.drawer')
  await expect(drawer.locator('.card-facts')).toBeVisible()
  // The drawer has stopped sliding in: the pointer below lands on what it was aimed at.
  await expect(drawer).toHaveCSS('transform', 'none')
  return drawer
}

/** The body's place, once the wheel that moved it has been drawn. */
function settled(body: Locator) {
  return body.evaluate(async (node) => {
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
    return node.scrollTop
  })
}

async function centreOf(locator: Locator) {
  const bounds = await locator.boundingBox()
  if (!bounds) throw new Error('not laid out')
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
}

interface Shift {
  sources: string[]
  value: number
}

interface Press {
  at: number
  clicked: boolean
  /** Where the click landed, when that was not the control it went down on. */
  missedOn: string
  on: string
}

interface PressLog {
  down: Element | null
  holding: boolean
  presses: Press[]
}

/** Every layout shift from here on, with the elements the browser says moved. */
function watchShifts(page: Page) {
  return page.evaluate(() => {
    const seen: Shift[] = []
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & {
        value: number
        sources?: { node?: Element | null }[]
      })[])
        seen.push({
          sources: (entry.sources ?? []).map((source) => source.node?.className?.toString() ?? ''),
          value: entry.value,
        })
    })
    observer.observe({ type: 'layout-shift', buffered: false })
    Object.assign(window, { shiftsSeen: seen })
  })
}

/** Small steps, so that the head's whole height is crossed one at a time, and back. */
async function readDownAndBack(page: Page, body: Locator) {
  const end = () => body.evaluate((node) => node.scrollHeight - node.clientHeight)
  let at = 0
  while (at < (await end())) {
    await page.mouse.wheel(0, 40)
    const from = at
    await expect.poll(() => settled(body)).toBeGreaterThan(from)
    at = await settled(body)
  }
  while (at > 0) {
    await page.mouse.wheel(0, -40)
    const from = at
    await expect.poll(() => settled(body)).toBeLessThan(from)
    at = await settled(body)
  }
}

for (const width of [1680, 1024, 390]) {
  test(`reading a long card down and back shifts no layout at ${width}px`, async ({ page }) => {
    const drawer = await openLongCard(page, width)
    const body = drawer.locator('.drawer-frame-body')
    const over = await centreOf(body)
    await page.mouse.move(over.x, over.y)
    await watchShifts(page)

    await readDownAndBack(page, body)

    const shifts = await page.evaluate(
      () => (window as unknown as { shiftsSeen: Shift[] }).shiftsSeen,
    )
    expect(
      shifts.reduce((sum, shift) => sum + shift.value, 0),
      JSON.stringify(shifts.slice(0, 6)),
    ).toBe(0)
  })
}

/** Both ends of each press, kept from the controls while the log is holding. */
function logPresses(page: Page) {
  return page.evaluate(() => {
    // This body is serialized and evaluated in the page, so a module-scope helper
    // would not be in scope here.
    // A disabled button is no control to reach: the platform gives it no click.
    // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
    const control = (target: EventTarget | null) =>
      target instanceof Element ? target.closest('button:not(:disabled)') : null
    const log: PressLog = { down: null, holding: true, presses: [] }
    const keep = (event: Event) => {
      if (log.holding) event.stopPropagation()
    }
    window.addEventListener(
      'pointerdown',
      (event) => {
        log.down = control(event.target)
        if (log.down)
          log.presses.push({
            at: document.querySelector('.drawer-frame-body')?.scrollTop ?? -1,
            clicked: false,
            missedOn: '',
            on: `${log.down.className} ${log.down.textContent?.trim().slice(0, 24) ?? ''}`,
          })
        keep(event)
      },
      { capture: true },
    )
    for (const kind of ['pointerup', 'mousedown', 'mouseup'])
      window.addEventListener(kind, keep, { capture: true })
    window.addEventListener(
      'click',
      (event) => {
        const press = log.presses.at(-1)
        if (log.down && press) {
          press.clicked = control(event.target) === log.down
          if (!press.clicked && event.target instanceof Element)
            press.missedOn = event.target.className.toString()
        }
        keep(event)
      },
      { capture: true },
    )
    Object.assign(window, { pressLog: log })
  })
}

const pressesSoFar = (page: Page) =>
  page.evaluate(() => (window as unknown as { pressLog: PressLog }).pressLog.presses)

/**
 * The frame's parts, aimed at in turn. Not its buttons: which button a turn pressed used
 * to follow how many the card had, so a button added to the bar moved every press to
 * another control at another place in the scroll.
 */
const PARTS = [
  '.drawer-frame-identity',
  '.drawer-frame-action',
  '.drawer-frame-controls',
  '.drawer-frame-body',
] as const

/**
 * Where a turn's press goes: the first control the pointer can reach right now in the
 * turn's part, or in the next part that has one, so that no turn goes without a press. A
 * part of the bar can begin to fade between this and the press, which is the race the bar
 * must win.
 */
const aim = (page: Page, turn: number) =>
  page.evaluate(
    ({ first, parts }) => {
      for (const step of parts.keys()) {
        const part = parts[(first + step) % parts.length]
        const node = [...document.querySelectorAll<HTMLElement>(`.drawer ${part} button`)].find(
          (each) => {
            const { x, y, width, height } = each.getBoundingClientRect()
            if (width === 0 || height === 0) return false
            const hit = document.elementFromPoint(x + width / 2, y + height / 2)
            return hit !== null && (each === hit || each.contains(hit))
          },
        )
        if (node) {
          const { x, y, width, height } = node.getBoundingClientRect()
          return { x: x + width / 2, y: y + height / 2 }
        }
      }
      return null
    },
    // Two turns to a part, so that each is pressed once with the wheel landed and once
    // with it on its way.
    { first: Math.floor(turn / 2) % PARTS.length, parts: [...PARTS] },
  )

/**
 * Down through the head and on, then back through it. Every other press is aimed once the
 * wheel has landed; the others go in with the wheel still on its way, and what they land
 * on may not be a control, which is why the turns go on until forty have.
 */
async function pressWhileScrolling(page: Page, body: Locator, count: number) {
  const over = await centreOf(body)
  let turn = 0
  let done = 0
  while (done < count) {
    turn += 1
    expect(turn).toBeLessThan(count * 5)
    await page.mouse.move(over.x, over.y)
    const going = turn % 24 < 12 ? 50 : -50
    const landed = turn % 2 === 0
    if (landed) {
      await page.mouse.wheel(0, going)
      await settled(body)
    }
    const at = await aim(page, turn)
    if (!landed) await page.mouse.wheel(0, going)
    if (at) {
      await page.mouse.move(at.x, at.y)
      await page.mouse.down()
      await page.mouse.up()
    }
    const presses = await pressesSoFar(page)
    done = presses.length
  }
}

/**
 * A press belongs to what was under the pointer when it went down. Forty of them, at each
 * part of the card in turn, each started as soon as a wheel has moved the card: every
 * press that went down on a control gets its click there, the bar's fading in and out
 * under them included.
 * The page hears both ends and keeps them from the controls, so that the card stays
 * the same card for the next press; the last press is left alone and does its work.
 */
for (const width of [1680, 1024, 390]) {
  test(`forty presses during and right after a scroll all reach their control at ${width}px`, async ({
    page,
  }) => {
    const drawer = await openLongCard(page, width)
    const body = drawer.locator('.drawer-frame-body')
    await logPresses(page)

    await pressWhileScrolling(page, body, 40)

    // A press that lost its click is named: where it went down, what was there, where
    // the click landed instead. This is rare enough to be read once, from the report.
    const presses = await pressesSoFar(page)
    expect(
      presses.filter((press) => !press.clicked),
      `of ${presses.length} presses`,
    ).toEqual([])

    await page.evaluate(() => {
      ;(window as unknown as { pressLog: PressLog }).pressLog.holding = false
    })
    const edit = drawer.getByRole('button', { name: 'Изменить описание', exact: true })
    await edit.evaluate((node) => node.scrollIntoView({ block: 'center' }))
    const over = await centreOf(body)
    await page.mouse.move(over.x, over.y)
    await page.mouse.wheel(0, 20)
    await settled(body)
    const seen = await centreOf(edit)
    await page.mouse.move(seen.x, seen.y)
    await page.mouse.down()
    await page.mouse.up()
    await expect(drawer.getByRole('textbox', { name: 'Описание', exact: true })).toBeVisible()
  })
}

const inBar = (drawer: Locator) => drawer.locator('.drawer-frame-bar')

/** Where everything in the bar stands, whether it shows or not. */
function barGeometry(drawer: Locator) {
  return inBar(drawer).evaluate((bar) =>
    [
      bar,
      ...bar.querySelectorAll(
        '.drawer-frame-close, .drawer-frame-identity, .drawer-frame-pinned-title, .drawer-frame-action',
      ),
    ].map((node) => {
      const { x, y, width, height } = node.getBoundingClientRect()
      return [x, y, width, height].map((value) => Math.round(value))
    }),
  )
}

for (const width of [1680, 1024, 390]) {
  test(`the bar has one height and everything in it one place at every position at ${width}px`, async ({
    page,
  }) => {
    const drawer = await openLongCard(page, width)
    const body = drawer.locator('.drawer-frame-body')
    const top = await barGeometry(drawer)
    for (const position of [1, 20, 60, 120, 200, 320, 480, 10_000, 40, 0]) {
      await body.evaluate((node, at) => node.scrollTo({ top: at }), position)
      await settled(body)
      expect(await barGeometry(drawer)).toEqual(top)
    }
  })
}

test('the title takes the bar once the big title has passed, and the action once its place has', async ({
  page,
}) => {
  const drawer = await openLongCard(page, 1024)
  const body = drawer.locator('.drawer-frame-body')
  const bar = inBar(drawer)
  const identity = bar.locator('.card-identity')
  const title = bar.locator('.drawer-frame-pinned-title')
  const action = bar.locator('.drawer-frame-action').getByRole('button')
  await expect(identity).toBeVisible()
  await expect(title).toBeHidden()
  await expect(action).toBeHidden()

  // Read from the card itself: how far each has to go to have passed the scroller's top.
  const past = (selector: string) =>
    drawer
      .locator(selector)
      .first()
      .evaluate((node) => {
        const scroller = node.closest('.drawer-frame-body')
        return (
          node.getBoundingClientRect().bottom -
          (scroller?.getBoundingClientRect().top ?? 0) +
          (scroller?.scrollTop ?? 0)
        )
      })
  const titleGone = await past('.drawer-frame-name')
  const actionGone = await past('.card-action')
  expect(actionGone).toBeGreaterThan(titleGone)

  await body.evaluate((node, at) => node.scrollTo({ top: at }), Math.floor(titleGone) - 2)
  await settled(body)
  await expect(identity).toBeVisible()
  await expect(title).toBeHidden()

  await body.evaluate((node, at) => node.scrollTo({ top: at }), Math.ceil(titleGone) + 1)
  await expect(title).toBeVisible()
  await expect(identity).toBeHidden()
  await expect(action).toBeHidden()

  await body.evaluate((node, at) => node.scrollTo({ top: at }), Math.ceil(actionGone) + 1)
  await expect(action).toBeVisible()

  // Coming back gives each its place again, in the other order.
  await body.evaluate((node, at) => node.scrollTo({ top: at }), Math.floor(actionGone) - 2)
  await expect(action).toBeHidden()
  await expect(title).toBeVisible()
  await body.evaluate((node) => node.scrollTo({ top: 0 }))
  await expect(title).toBeHidden()
  await expect(identity).toBeVisible()
})

const fadeOf = (drawer: Locator) =>
  inBar(drawer)
    .locator('.drawer-frame-pinned-title')
    .evaluate((node) => {
      const { transitionDuration, transitionProperty } = getComputedStyle(node)
      return { duration: transitionDuration, property: transitionProperty }
    })

test('what the bar shows arrives by a fade on the surface tokens, and at once under reduced motion', async ({
  page,
}) => {
  const drawer = await openLongCard(page, 1024)
  // Reach goes with the fade: it turns half way in, and at once on the way out.
  expect(await fadeOf(drawer)).toEqual({
    duration: '0.24s, 0.24s, 0.24s',
    property: 'opacity, visibility, pointer-events',
  })

  await page.emulateMedia({ reducedMotion: 'reduce' })
  const reduced = await fadeOf(drawer)
  expect(Number.parseFloat(reduced.duration)).toBeLessThan(0.001)
})

test('in a window too short to show the facts, they have not gone anywhere yet', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('valkama-locale', 'ru'))
  await page.setViewportSize({ width: 1024, height: 240 })
  await installBackend(page, { longRead: true })
  await page.goto(CARD)
  const drawer = page.locator('.drawer')
  await expect(drawer.locator('.card-facts')).toBeAttached()
  await expect(drawer).toHaveCSS('transform', 'none')
  await settled(drawer.locator('.drawer-frame-body'))
  await expect(inBar(drawer).locator('.drawer-frame-action').getByRole('button')).toBeHidden()
  await expect(inBar(drawer).locator('.drawer-frame-pinned-title')).toBeHidden()
})

test('a control the keyboard holds in the bar stays until the keyboard moves on', async ({
  page,
}) => {
  const drawer = await openLongCard(page, 1024)
  const bar = inBar(drawer)
  const reference = bar.locator('.head-reference')
  await drawer.locator('.drawer-frame-close').focus()
  await page.keyboard.press('Tab')
  await expect(reference).toBeFocused()

  await drawer.locator('.drawer-frame-body').evaluate((node) => node.scrollTo({ top: 400 }))
  await settled(drawer.locator('.drawer-frame-body'))
  await expect(reference).toBeVisible()
  await expect(reference).toBeFocused()
  await expect(bar.locator('.drawer-frame-pinned-title')).toBeHidden()

  // The link's turn and the source's, the last control of the identity; then the first fact's
  // menu, the priority's in the registry's order, which brings the facts back into view on its
  // way. Read down from there, the identity makes way.
  await page.keyboard.press('Tab')
  await expect(bar.locator('.identity-link')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(bar.locator('.identity-source')).toBeFocused()
  await page.keyboard.press('Tab')
  const first = drawer.locator('.card-facts-block').getByRole('combobox').first()
  await expect(first).toBeFocused()
  await expect(first).toBeInViewport()
  await drawer.locator('.drawer-frame-body').evaluate((node) => node.scrollTo({ top: 400 }))
  await expect(reference).toBeHidden()
  await expect(bar.locator('.drawer-frame-pinned-title')).toBeVisible()
})

for (const width of [1680, 390]) {
  test(`what is scrolled into view rests under the sticky tabs at ${width}px`, async ({ page }) => {
    const drawer = await openLongCard(page, width)
    const tabs = drawer.locator('.drawer-frame-tabs')
    const section = drawer.locator('.description-section')
    await section.evaluate((node) => node.scrollIntoView({ block: 'start' }))
    const [sectionBox, tabsBox] = await Promise.all([section.boundingBox(), tabs.boundingBox()])
    expect(sectionBox?.y).toBeCloseTo((tabsBox?.y ?? 0) + (tabsBox?.height ?? 0), 0)
  })
}
