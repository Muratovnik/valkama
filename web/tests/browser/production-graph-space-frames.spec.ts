/**
 * The graph of a space with a goal five levels deep and the work of other spaces, at the
 * graph's widths: a desktop's and a phone's, a phone's in both languages.
 *
 * Every goal and stage is a frame, each inside the one it stands in, five deep. A folded
 * stage whose work is all done says «Ждёт подтверждения» whole on its reference line. The
 * work under no goal is «Без цели». Another space's cards and the far end of a link with a
 * third space stand in a frame of their space, after this space's frames, named as the
 * list's group of that space is; the links to them are drawn to them. A link whose source
 * the read could not read is not drawn, and the graph's key says the links with its space
 * were not read. The camera goes no further out than the whole field.
 *
 * The counts line says another space's cards apart, «и 2 из других пространств»: they are not
 * this space's work, and the far end of a link is not counted at all. «≠ Из другого
 * пространства» takes their frames and the links to them away.
 *
 * Served `served/graphSpaceFrames.ts`.
 */
import { expect } from '@playwright/test'
import type { Page, TestInfo } from '@playwright/test'

import { installBackend } from './backend.ts'
import { graphRoute } from './chainFixtures.ts'
import { settledZoom } from './graphFieldCamera.ts'
import {
  AWAITING,
  END,
  identity,
  LEVELS,
  spaceFramesRead,
  UNREAD_SOURCE,
} from './served/graphSpaceFrames.ts'
import { spaceAnswer } from './servedAnswers.ts'
import { test } from './test.ts'

const ALPHA_FRAME = 'space:ALPHA'
const BETA_FRAME = 'space:BETA'

async function openField(page: Page, width: number, state: Record<string, string> = {}) {
  await page.setViewportSize({ width, height: width > 600 ? 900 : 844 })
  await installBackend(page)
  await page.route('**/api/planning?*', (route) =>
    route.fulfill(spaceAnswer(new URL(route.request().url()).searchParams, spaceFramesRead())),
  )
  await page.goto(graphRoute(state))
  await expect(page.locator('.graph-canvas.settled')).toBeVisible()
}

const frame = (page: Page, id: string) => page.locator(`[data-frame="${id}"]`)

/** Every drawn frame's id, in the order the field lays them in the document. */
const frameIds = (page: Page) =>
  page
    .locator('[data-frame]')
    .evaluateAll((frames) => frames.map((f) => (f as HTMLElement).dataset.frame))

/** Whether the first box lies wholly inside the second, in the page's pixels. */
async function inside(page: Page, inner: string, outer: string) {
  return page.evaluate(
    ([one, two]) => {
      const a = document.querySelector(one)?.getBoundingClientRect()
      const b = document.querySelector(two)?.getBoundingClientRect()
      return Boolean(
        a &&
        b &&
        a.left >= b.left - 0.5 &&
        a.right <= b.right + 0.5 &&
        a.top >= b.top - 0.5 &&
        a.bottom <= b.bottom + 0.5,
      )
    },
    [inner, outer] as const,
  )
}

const card = (id: string) => `[data-walk-target="${id}"]`
const frameBox = (id: string) => `[data-frame="${id}"]`
const edge = (source: string, target: string) => `.vue-flow__edges [data-id="${source}>${target}"]`

async function shoot(page: Page, info: TestInfo, name: string) {
  await page.screenshot({ path: info.outputPath(`${name}.png`) })
}

/** The key, where this width shows it: in the bar on a desktop, under its options on a phone. */
async function key(page: Page, width: number, optionsName: string) {
  if (width < 600) await page.getByRole('button', { name: optionsName, exact: true }).click()
  return page.locator('.graph-legend').filter({ visible: true })
}

for (const { width, locale, words } of [
  {
    width: 1280,
    locale: 'ru-RU',
    words: {
      awaiting: 'Ждёт подтверждения',
      noGoal: 'Без цели',
      alpha: 'Пространство ALPHA · Alpha',
      beta: 'Пространство BETA · Beta',
      unread: 'Связи с GAMMA не прочитаны',
      options: 'Параметры и легенда графа',
      fit: 'Весь граф',
      zoomOut: 'Отдалить',
      elsewhere: 'и 2 из других пространств',
    },
  },
  {
    width: 390,
    locale: 'ru-RU',
    words: {
      awaiting: 'Ждёт подтверждения',
      noGoal: 'Без цели',
      alpha: 'Пространство ALPHA · Alpha',
      beta: 'Пространство BETA · Beta',
      unread: 'Связи с GAMMA не прочитаны',
      options: 'Параметры и легенда графа',
      fit: 'Весь граф',
      zoomOut: 'Отдалить',
      elsewhere: 'и 2 из других пространств',
    },
  },
  {
    width: 390,
    locale: 'en-US',
    words: {
      awaiting: 'Awaiting confirmation',
      noGoal: 'No goal',
      alpha: 'Space ALPHA · Alpha',
      beta: 'Space BETA · Beta',
      unread: 'Links with GAMMA were not read',
      options: 'Graph options and key',
      fit: 'Fit whole graph',
      zoomOut: 'Zoom out',
      elsewhere: 'and 2 from other spaces',
    },
  },
] as const) {
  test.describe(`at ${width}px in ${locale}`, () => {
    test.use({ locale })

    test('draws a frame on each of five levels, each inside the one above it', async ({
      page,
    }, info) => {
      await openField(page, width)
      for (const level of LEVELS) await expect(frame(page, identity(level))).toBeVisible()
      for (let depth = 1; depth < LEVELS.length; depth += 1)
        expect(
          await inside(
            page,
            frameBox(identity(LEVELS[depth])),
            frameBox(identity(LEVELS[depth - 1])),
          ),
        ).toBe(true)
      expect(await inside(page, card(identity(1006)), frameBox(identity(1005)))).toBe(true)
      await expect(frame(page, 'none').locator('header')).toContainText(words.noGoal)
      await shoot(page, info, `graph-${width}-five-levels-${locale}`)
    })

    test('says «awaiting confirmation» whole on the folded stage’s reference line', async ({
      page,
    }, info) => {
      await openField(page, width)
      const awaiting = frame(page, identity(AWAITING))
      await expect(awaiting).toHaveClass(/folded/u)
      const state = awaiting.locator('[data-state="awaiting_confirmation"]')
      await expect(state).toHaveText(words.awaiting)
      const room = await state.evaluate((element) => {
        const line = element.parentElement?.getBoundingClientRect()
        const box = element.getBoundingClientRect()
        const clipped = [element, ...element.querySelectorAll('*')].some(
          (part) => part.scrollWidth > part.clientWidth + 0.5,
        )
        return { clipped, beyond: line ? box.right - line.right : Number.NaN }
      })
      expect(room.clipped).toBe(false)
      expect(room.beyond).toBeLessThanOrEqual(0.5)
      await awaiting.scrollIntoViewIfNeeded()
      await shoot(page, info, `graph-${width}-awaiting-confirmation-${locale}`)
    })

    test('stands other spaces’ work in their frames, last, and draws the links to it', async ({
      page,
    }, info) => {
      await openField(page, width)
      const ids = await frameIds(page)
      expect(ids).toHaveLength(LEVELS.length + 3 + 1)
      // This space's frames, then the work under no goal, then each other space by key.
      expect(ids.slice(-3)).toEqual(['none', ALPHA_FRAME, BETA_FRAME])
      await expect(frame(page, ALPHA_FRAME).locator('header')).toContainText(words.alpha)
      await expect(frame(page, BETA_FRAME).locator('header')).toContainText(words.beta)
      // Another space's goal is a card in its space's frame, and so is the far end of a link.
      for (const n of [41, 42])
        expect(await inside(page, card(identity(n)), frameBox(ALPHA_FRAME))).toBe(true)
      expect(await inside(page, card(END.work_item_id), frameBox(BETA_FRAME))).toBe(true)
      // Nothing of this space opens from those frames' headers.
      await expect(frame(page, ALPHA_FRAME).locator('header button[data-walk-target]')).toHaveCount(
        1,
      )

      await expect(page.locator(edge(identity(1006), END.work_item_id))).toHaveCount(1)
      await expect(page.locator(edge(identity(41), identity(1006)))).toHaveCount(1)
      await expect(page.locator(edge(identity(1010), identity(42)))).toHaveCount(1)
      await expect(page.locator(`.vue-flow__edges [data-id^="${UNREAD_SOURCE}"]`)).toHaveCount(0)
      await expect(page.locator('.vue-flow__edges [data-id]')).toHaveCount(3)

      const legend = await key(page, width, words.options)
      await expect(legend).toContainText(words.unread)
      await shoot(page, info, `graph-${width}-space-frame-${locale}`)
    })

    test('counts another space’s cards apart, never a link’s far end, and «≠» takes their frames away', async ({
      page,
    }, info) => {
      await openField(page, width)
      // ALPHA-41 and ALPHA-42 name this space's project; BETA-7 is only a link's far end.
      const counts = page.locator('.workspace-figures')
      await expect(counts).toHaveText(new RegExp(` ${words.elsewhere}$`, 'u'))
      await shoot(page, info, `graph-${width}-counts-elsewhere-${locale}`)

      // «≠ From another space», as its chip writes it into the route.
      await openField(page, width, { elsewhere: '%-other' })
      await expect(counts).not.toContainText(words.elsewhere)
      const ids = await frameIds(page)
      expect(ids).not.toContain(ALPHA_FRAME)
      expect(ids).not.toContain(BETA_FRAME)
      expect(ids).toContain('none')
      for (const id of [identity(41), identity(42), END.work_item_id])
        await expect(page.locator(card(id))).toHaveCount(0)
      // The three links each reach another space's card, so none is left.
      await expect(page.locator('.vue-flow__edges [data-id]')).toHaveCount(0)
      await shoot(page, info, `graph-${width}-not-elsewhere-${locale}`)
    })

    test('goes no further out than the whole field', async ({ page }) => {
      await openField(page, width)
      await page.getByRole('button', { name: words.fit, exact: true }).click()
      const whole = await settledZoom(page)
      await expect(page.getByRole('button', { name: words.zoomOut, exact: true })).toBeDisabled()
      const flow = await page.locator('.graph-flow').boundingBox()
      await page.mouse.move((flow?.x ?? 0) + (flow?.width ?? 0) / 2, (flow?.y ?? 0) + 120)
      for (let turn = 0; turn < 6; turn += 1) await page.mouse.wheel(0, 240)
      expect(await settledZoom(page)).toBe(whole)
    })
  })
}
