import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { projectScope, workItemRef } from './planningFixtures.ts'

/** The card head condenses at the body's first scroll: its glide, its hold and its room. */
async function box(locator: Locator) {
  const bounds = await locator.boundingBox()
  if (!bounds) throw new Error('not laid out')
  return bounds
}

/**
 * The head condenses at the body's first scroll, not after a head's worth of
 * scrolling: whole at position 0, compact from the first step down, and a card
 * that scrolls less than its head is tall condenses as well. The condensed head
 * holds still at every position, and condensing does not clamp the reader back
 * to the top, which would flip the head whole again.
 */
async function openReadCard(page: Page, width: number, read: 'long' | 'card') {
  await page.addInitScript(() => localStorage.setItem('valkama-locale', 'ru'))
  await page.setViewportSize({ width, height: 844 })
  await installBackend(page, read === 'long' ? { longRead: true } : {})
  await page.goto(
    serializePlatformRoute({
      module_id: 'planning',
      scope: projectScope,
      entity: planningWorkItemEntity(workItemRef),
    }),
  )
  const drawer = page.locator('.drawer')
  await expect(drawer.locator('.card-facts')).toBeVisible()
  return drawer
}

for (const width of [1440, 390]) {
  test(`the first scroll condenses a read card's head, and the top restores it whole at ${width}px`, async ({
    page,
  }) => {
    const drawer = await openReadCard(page, width, 'long')
    const head = drawer.locator('.drawer-frame-head')
    const body = drawer.locator('.drawer-frame-body')
    const { height: whole } = await box(head)
    await expect(head).not.toHaveClass(/condensed/u)

    await body.evaluate((node) => node.scrollTo({ top: 10 }))
    await expect(head).toHaveClass(/condensed/u)

    await body.evaluate((node) => node.scrollTo({ top: 0 }))
    await expect(head).not.toHaveClass(/condensed/u)
    const restored = await box(head)
    expect(Math.abs(restored.height - whole)).toBeLessThan(1)
  })

  test(`a card that scrolls less than its head is tall condenses at its first scroll at ${width}px`, async ({
    page,
  }) => {
    const drawer = await openReadCard(page, width, 'card')
    const head = drawer.locator('.drawer-frame-head')
    const body = drawer.locator('.drawer-frame-body')
    const { height: whole } = await box(head)
    const rangeOf = () => body.evaluate((node) => node.scrollHeight - node.clientHeight)
    // The same card on a taller viewport scrolls less: about half its head's height
    // is left to scroll, which the old threshold of a head's height plus 24px never reached.
    const first = await rangeOf()
    await page.setViewportSize({
      width,
      height: 844 + Math.max(0, first - Math.round(whole / 2)),
    })
    const range = await rangeOf()
    expect(range).toBeGreaterThan(0)
    expect(range).toBeLessThan(whole)

    await body.evaluate((node) => node.scrollTo({ top: 4 }))
    await expect(head).toHaveClass(/condensed/u)
    // The glide's transform counts toward the scrollable overflow while it runs, so
    // the range is read once the text has settled, and the head with it: the frame
    // after the class lands, the sections' row takes its last 4px.
    await expect
      .poll(() => body.evaluate((node) => node.getAnimations({ subtree: true }).length))
      .toBe(0)
    // The condensed range is the whole range less the room the head gave up, or the
    // 1px the guard needs where that is larger: no blank below a short text, and the
    // reader can still scroll. One pixel of rounding is allowed.
    const condensedHead = await box(head)
    const room = whole - condensedHead.height
    const condensedRange = await rangeOf()
    expect(
      condensedRange,
      `whole range ${range}, room ${room}, whole head ${whole}, condensed head ${condensedHead.height}`,
    ).toBeLessThanOrEqual(Math.max(range - room, 1) + 1)
    expect(condensedRange).toBeGreaterThanOrEqual(1)

    await body.evaluate((node) => node.scrollTo({ top: node.scrollHeight }))
    await expect(head).toHaveClass(/condensed/u)
    const gap = await body.evaluate(
      (node) => node.scrollHeight - node.clientHeight - node.scrollTop,
    )
    expect(Math.abs(gap)).toBeLessThanOrEqual(1)
    // Held condensed while read, not only at the moment of the scroll.
    const seen = await stillSamples(body)
    expect(new Set(seen).size, seen.join(' ; ')).toBe(1)
    expect(seen[0]).toMatch(/^true\|/u)
  })

  test(`the condensed head holds still at every position of a read card at ${width}px`, async ({
    page,
  }) => {
    const drawer = await openReadCard(page, width, 'long')
    const head = drawer.locator('.drawer-frame-head')
    const body = drawer.locator('.drawer-frame-body')
    const STATE = {
      condensed: /condensed/u,
      whole: /^(?!.*condensed)/u,
    } as const
    const positions = [
      [10, 'condensed'],
      [40, 'condensed'],
      ['end', 'condensed'],
      [0, 'whole'],
    ] as const
    for (const [target, state] of positions) {
      await body.evaluate((node, top) => {
        node.scrollTo({ top: top === 'end' ? node.scrollHeight : top })
      }, target)
      await expect(head).toHaveClass(STATE[state])
      const seen = await stillSamples(body)
      expect(new Set(seen).size, `state at ${target}`).toBe(1)
    }
  })
}

for (const width of [1024, 390]) {
  test(`condensing at the end keeps the reader at the end at ${width}px`, async ({ page }) => {
    const drawer = await openReadCard(page, width, 'long')
    const head = drawer.locator('.drawer-frame-head')
    const body = drawer.locator('.drawer-frame-body')
    await body.evaluate((node) => node.scrollTo({ top: node.scrollHeight }))
    await expect(head).toHaveClass(/condensed/u)
    const gap = await body.evaluate(
      (node) => node.scrollHeight - node.clientHeight - node.scrollTop,
    )
    expect(Math.abs(gap)).toBeLessThanOrEqual(1)
  })
}

/**
 * Twelve samples of the head's state and the reader's place over 1.2s, the reader
 * still: a state that changes while nothing moves is a flap.
 */
async function stillSamples(body: Locator) {
  return body.evaluate(async (node) => {
    const pinned = node.closest('.drawer')?.querySelector('.drawer-frame-head')
    const samples: string[] = []
    for (let index = 0; index < 12; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      samples.push(
        `${pinned?.classList.contains('condensed')}|${Math.round(pinned?.getBoundingClientRect().height ?? 0)}|${Math.round(node.scrollTop)}`,
      )
    }
    return samples
  })
}

/**
 * The text glides up into the room a condensed head gives back. No band is left
 * under the head: the first line sits the body's padding under the condensed head,
 * less the distance read, and it moved by the room the head gave up plus that
 * distance. The glide runs on the motion token for a surface, and reduced motion
 * makes it instant.
 */
for (const width of [1440, 390]) {
  test(`the text glides up into the room a condensed head gives back, with no band, at ${width}px`, async ({
    page,
  }) => {
    const drawer = await openReadCard(page, width, 'long')
    const head = drawer.locator('.drawer-frame-head')
    const body = drawer.locator('.drawer-frame-body')
    const text = drawer.locator('.drawer-frame-body .overview > :first-child')
    const whole = await box(head)
    const textAtTop = await text.evaluate((node) => node.getBoundingClientRect().top)

    await body.evaluate((node) => node.scrollTo({ top: 10 }))
    await expect(head).toHaveClass(/condensed/u)
    await expect
      .poll(() => body.evaluate((node) => node.getAnimations({ subtree: true }).length))
      .toBe(0)

    const condensed = await box(head)
    const textNow = await text.evaluate((node) => node.getBoundingClientRect().top)
    const pad = await body.evaluate((node) => Number.parseFloat(getComputedStyle(node).paddingTop))
    expect(Math.abs(textNow - (condensed.y + condensed.height + pad - 10))).toBeLessThan(1)
    expect(Math.abs(textAtTop - textNow - (whole.height - condensed.height + 10))).toBeLessThan(1)
  })

  test(`the text glides rather than jumps when the head condenses, at ${width}px`, async ({
    page,
  }) => {
    const drawer = await openReadCard(page, width, 'long')
    const body = drawer.locator('.drawer-frame-body')

    await body.evaluate((node) => node.scrollTo({ top: 10 }))
    const glide = await body.evaluate(async (node) => {
      const deadline = performance.now() + 2000
      while (node.getAnimations({ subtree: true }).length === 0 && performance.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      const effect = node.getAnimations({ subtree: true })[0]?.effect
      if (!(effect instanceof KeyframeEffect)) return null
      const frames = effect.getKeyframes()
      return {
        transform: frames.length === 2 && frames.every((frame) => 'transform' in frame),
        duration: Number(effect.getComputedTiming().duration),
      }
    })
    // A two-frame transform on the surface duration token, 0.24s.
    expect(glide).toEqual({ transform: true, duration: 240 })
  })

  test(`reduced motion moves the text at once, at ${width}px`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const drawer = await openReadCard(page, width, 'long')
    const head = drawer.locator('.drawer-frame-head')
    const body = drawer.locator('.drawer-frame-body')
    const text = drawer.locator('.drawer-frame-body .overview > :first-child')

    await body.evaluate((node) => node.scrollTo({ top: 10 }))
    await expect(head).toHaveClass(/condensed/u)
    const pad = await body.evaluate((node) => Number.parseFloat(getComputedStyle(node).paddingTop))
    // The head is read with the text: the frame after the class lands, the sections'
    // row takes its last 4px.
    await expect
      .poll(async () => {
        const condensed = await box(head)
        const top = await text.evaluate((node) => node.getBoundingClientRect().top)
        return top - (condensed.y + condensed.height + pad - 10)
      })
      .toBeCloseTo(0, 0)
    const durations = await body.evaluate((node) =>
      node
        .getAnimations({ subtree: true })
        .map((animation) => Number(animation.effect?.getComputedTiming().duration)),
    )
    expect(durations.every((duration) => duration <= 1)).toBe(true)
  })
}

/**
 * A press that lands while the text glides reaches the control it went down on. The
 * glide is lengthened so a press from outside the page is certain to fall inside it,
 * and the pointer is held long enough for an unheld glide to carry the control away.
 * The press focuses the control, and a glide ended by that focus did the same at once.
 * The hold starts with the press: a glide that went on one more frame took the control
 * from under a pointer on its edge.
 */
test('a press during the glide reaches its control, and the glide goes on after it', async ({
  page,
}) => {
  const drawer = await openReadCard(page, 390, 'long')
  const body = drawer.locator('.drawer-frame-body')
  const text = drawer.locator('.drawer-frame-content')
  const edit = drawer.getByRole('button', { name: 'Изменить описание', exact: true })
  await text.evaluate((node) => node.style.setProperty('--duration-surface', '4s'))
  const { x, y } = await box(body)
  await page.mouse.move(x + 40, y + 40)
  await page.mouse.wheel(0, 100)
  await expect
    .poll(() => body.evaluate((node) => node.getAnimations({ subtree: true }).length))
    .toBe(1)

  // What the press found drawn, and what is drawn twenty frames on: a third of a
  // second, as a person's press lasts, in which the glide would have gone on under it.
  const drawn = text.evaluate(
    (node) =>
      new Promise<string[]>((done) => {
        document.addEventListener(
          'pointerdown',
          async () => {
            const atPress = getComputedStyle(node).transform
            for (let frame = 0; frame < 20; frame += 1) {
              await new Promise(requestAnimationFrame)
            }
            done([atPress, getComputedStyle(node).transform])
          },
          { once: true },
        )
      }),
  )
  const seen = await box(edit)
  await page.mouse.move(seen.x + seen.width / 2, seen.y + seen.height / 2)
  await page.mouse.down()
  const [atPress, after] = await drawn
  expect(atPress).not.toBe('none')
  expect(after).toBe(atPress)
  await page.mouse.up()

  await expect(drawer.getByRole('textbox', { name: 'Описание', exact: true })).toBeVisible()
  const heldStill = await body.evaluate(
    (node) =>
      node.getAnimations({ subtree: true }).filter((glide) => glide.playState === 'paused').length,
  )
  expect(heldStill).toBe(0)
})

/**
 * Opens a long card and starts a glide long enough for whatever comes next to fall
 * inside it. The first scroll is the mouse wheel's, whatever the test goes on with.
 */
async function glidingCard(page: Page) {
  const drawer = await openReadCard(page, 390, 'long')
  const body = drawer.locator('.drawer-frame-body')
  const text = drawer.locator('.drawer-frame-content')
  await text.evaluate((node) => node.style.setProperty('--duration-surface', '4s'))
  const { x, y } = await box(body)
  await page.mouse.move(x + 40, y + 40)
  return { body, drawer, start: () => page.mouse.wheel(0, 100) }
}

const glides = (body: Locator) =>
  body.evaluate((node) => node.getAnimations({ subtree: true }).map((glide) => glide.playState))

test.describe('on a touch screen', () => {
  test.use({ hasTouch: true })

  /**
   * A tap reports its release before its mouse events and the focus they give, and
   * a glide ended by that focus took the control from under the tap's own mouseup.
   */
  test('a tap during the glide reaches its control', async ({ page }) => {
    const { body, drawer, start } = await glidingCard(page)
    await start()
    await expect.poll(() => glides(body)).toEqual(['running'])
    const edit = await box(drawer.getByRole('button', { name: 'Изменить описание', exact: true }))
    await page.touchscreen.tap(edit.x + edit.width / 2, edit.y + edit.height / 2)
    await expect(drawer.getByRole('textbox', { name: 'Описание', exact: true })).toBeVisible()
  })
})

/** A focus move by the keyboard still ends the glide: the control is placed by where the text will rest. */
test('a Tab during the glide ends it', async ({ page }) => {
  const { body, drawer, start } = await glidingCard(page)
  await drawer.getByRole('button', { name: 'Изменить описание', exact: true }).focus()
  await start()
  await expect.poll(() => glides(body)).toEqual(['running'])
  await page.keyboard.press('Tab')
  await expect.poll(() => glides(body)).toEqual([])
  await expect(body.locator(':focus')).toHaveCount(1)
})

/** A window that loses focus may never hear the release: the text does not wait for it. */
test('a held glide goes on when the window loses focus', async ({ page }) => {
  const { body, drawer, start } = await glidingCard(page)
  await start()
  await expect.poll(() => glides(body)).toEqual(['running'])
  const edit = await box(drawer.getByRole('button', { name: 'Изменить описание', exact: true }))
  await page.mouse.move(edit.x + edit.width / 2, edit.y + edit.height / 2)
  await page.mouse.down()
  await expect.poll(() => glides(body)).toEqual(['paused'])
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await expect.poll(() => glides(body)).toEqual(['running'])
  await page.mouse.up()
})
