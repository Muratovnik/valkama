/**
 * The week's tile on the Analytics rail in the built app names the window nearest its limit by its
 * forecast, not the one most spent (DESIGN.md § Analytics): «Work»'s week stands at 72 % and its
 * forecast ends at 81 % by a reset twelve hours on, so it lasts; the unnamed account's week stands
 * at 6 % and its slower pace spends it before its reset four days on. The tile names the second,
 * at 6 %, and says when it runs out, by its day alone, where it said its state; its bar's words
 * add the part of the day. The most-spent rule named «Work» at 72 %.
 *
 * Its slower pace runs from 6 % at the answer's moment to 194 % at the reset 96 hours on, so it
 * reaches 100 % (100 − 6) / (194 − 6) = half the way along: 48 hours on, 14:30 of 13 November,
 * that day's afternoon. At 1440 and 1024 pixels, in both languages, the tile holds those words
 * whole inside its entry, the rail no wider than with the state it says in their place, and cuts
 * nothing; each run prints what it measured.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import type { Quota } from '@/shared/api/analyticsApi.ts'

import { quotaAt, share } from '../fixtures/quota.ts'
import { present } from '../support/present.ts'
import { NOW, pageAt, record, serve, serveQuota } from './analyticsPage.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { test } from './test.ts'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/** The four accounts, «Work»'s week at 72 % that lasts, the unnamed account's at 6 % that runs out. */
function atRisk(): Quota {
  const quota = quotaAt(NOW)
  const moment = NOW.getTime()
  const [work, night] = quota.accounts
  if (!work || !night) throw new Error('«Work» first, the unnamed account second')
  const window = (shape: Parameters<typeof share>[2]) => share(moment, quota.utc_offset, shape)
  const weekOf = (windows: typeof work.windows) =>
    windows.findIndex((one) => one.kind === 'week' && one.model === null)
  work.windows[weekOf(work.windows)] = window({
    kind: 'week',
    left: 12 * HOUR,
    source: 'poll',
    readings: [
      [2 * HOUR, 70],
      [2 * MINUTE, 72],
    ],
    forecast: { low_percent: 78, high_percent: 81 },
  })
  night.windows[weekOf(night.windows)] = window({
    kind: 'week',
    left: 96 * HOUR,
    source: 'statusline',
    readings: [
      [HOUR, 2],
      [3 * MINUTE, 6],
    ],
    forecast: { low_percent: 194, high_percent: 210 },
  })
  return quota
}

const SAID = {
  en: {
    runsOut: 'runs out ~Nov 13',
    bar: 'Forecast · Limit runs out before the reset, by the afternoon of Nov 13',
  },
  ru: {
    runsOut: 'закончится ~13 нояб.',
    bar: 'Прогноз · Лимит закончится до сброса, примерно к середине дня 13 нояб.',
  },
} as const

/** The week's entry on the rail, once its figures have come and its font is laid out. */
async function weekEntry(page: Page) {
  const entry = page.locator('.analytics-rail [data-section="quota_week"]')
  await expect(entry).toContainText('7e6d5c4b')
  await page.evaluate(() => document.fonts.ready)
  return entry
}

for (const lang of ['en', 'ru'] as const)
  for (const width of [1440, 1024])
    test(`at ${width}px in ${lang} the week's tile names the window that runs out before its reset, not the most spent`, async ({
      page,
    }, info) => {
      await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), lang)
      await serve(page)
      await page.setViewportSize({ width, height: 1000 })
      // The same page with the four accounts as they are, its week's tile saying its state.
      await page.goto(pageAt())
      const first = await weekEntry(page)
      const before = present(await first.boundingBox(), 'the entry before')

      await serveQuota(page, atRisk())
      await page.reload()
      const said = SAID[lang]
      const entry = await weekEntry(page)
      await expect(entry.getByText(/^6\s?%$/u)).toBeVisible()
      await expect(entry).not.toContainText('72')
      const runsOut = entry.getByText(said.runsOut, { exact: true })
      await expect(runsOut).toBeVisible()
      // Its bar's words say the part of the day the tile leaves out.
      const label = await entry.locator('[data-mark="track"]').getAttribute('aria-label')
      expect(label?.endsWith(said.bar), `the bar's words: ${label}`).toBe(true)

      // The words stand whole inside their entry, on the line of the section's name, and the rail
      // is as wide as it was: the part of the day once widened it by a fifth.
      const words = present(await runsOut.boundingBox(), 'the run-out words')
      const box = present(await entry.boundingBox(), 'the week’s entry')
      const name = present(
        await entry.getByText(lang === 'en' ? 'Week' : 'Неделя', { exact: true }).boundingBox(),
        'the section’s name',
      )
      await record(info, `risk-tile-${lang}-${width}`, { words, box, before, name })
      expect(Math.abs(box.width - before.width), 'the rail as wide as before').toBeLessThan(1)
      expect(words.x, 'the words start inside the entry').toBeGreaterThanOrEqual(box.x)
      expect(words.x + words.width, 'the words end inside the entry').toBeLessThanOrEqual(
        box.x + box.width,
      )
      expect(words.x, 'the words after the name').toBeGreaterThan(name.x + name.width)
      expect(Math.abs(words.y + words.height / 2 - (name.y + name.height / 2))).toBeLessThan(2)
      await expectNoSilentClipping(page, `rail at ${width}px in ${lang}`, '.analytics-rail')
    })
