/**
 * The five hours' tile and section in the built app when the account in use reports no five-hour
 * window (DESIGN.md § Analytics): «Work» was read last, two minutes before the page's moment, and
 * sends week readings only; the other accounts' five hours have reset. The tile names «Work» with
 * «no window» beside the section's name, each whole on its line at 1440 and 1024 pixels in both
 * languages and the rail no wider than with the four accounts as they are, and the five hours'
 * section says the current account has no five-hour window over its accounts, cutting nothing. The
 * whole sentence on the tile's line was cut by a third at 1440 pixels. Each run prints what it
 * measured.
 */
import { expect } from '@playwright/test'

import type { Quota } from '@/shared/api/analyticsApi.ts'
import { messages } from '@/shared/i18n/index.ts'

import { quotaAt, share } from '../fixtures/quota.ts'
import { present } from '../support/present.ts'
import { NOW, openPanel, pageAt, record, serve, serveQuota, shortfalls } from './analyticsPage.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { test } from './test.ts'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/** «Work» with its week alone, read two minutes ago; every other five hours reset. */
function weekOnly(): Quota {
  const quota = quotaAt(NOW)
  const moment = NOW.getTime()
  const window = (shape: Parameters<typeof share>[2]) => share(moment, quota.utc_offset, shape)
  const accounts = quota.accounts.map((account, index) => {
    if (index === 0)
      return { ...account, windows: account.windows.filter((one) => one.kind === 'week') }
    return {
      ...account,
      windows: account.windows.map((one) =>
        one.kind === 'five_hour'
          ? window({
              kind: 'five_hour',
              left: -20 * MINUTE,
              source: 'mod',
              readings: [[3 * HOUR, 30]],
              forecast: null,
            })
          : one,
      ),
    }
  })
  return { ...quota, accounts }
}

for (const lang of ['en', 'ru'] as const)
  for (const width of [1440, 1024])
    test(`at ${width}px in ${lang} the five hours say the current account has no five-hour window`, async ({
      page,
    }, info) => {
      const words = messages[lang].analytics.quota
      await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), lang)
      await serve(page)
      await page.setViewportSize({ width, height: 1000 })
      const entry = page.locator('.analytics-rail [data-section="quota_five_hour"]')
      // The rail with the four accounts as they are, for its width.
      await serveQuota(page, quotaAt(NOW))
      await page.goto(pageAt())
      await expect(entry.getByText('a1b2c3d4', { exact: false })).toBeVisible()
      await page.evaluate(() => document.fonts.ready)
      const before = present(await entry.boundingBox(), 'the entry before')

      await serveQuota(page, weekOnly())
      await page.reload()
      await expect(entry.getByText(words.tile.noFiveHours, { exact: true })).toBeVisible()
      await expect(entry.getByText('Work', { exact: true })).toBeVisible()
      await page.evaluate(() => document.fonts.ready)
      const cut = await shortfalls(
        page,
        '.analytics-rail [data-section="quota_five_hour"] .rail-tile-lead',
      )
      const box = present(await entry.boundingBox(), 'the entry')
      await record(info, `no-five-hours-tile-${lang}-${width}`, { cut, box, before })
      // No wider: the words before were the five hours' run-out, a little longer than these.
      expect(box.width, 'the rail no wider than before').toBeLessThan(before.width + 1)
      await expectNoSilentClipping(page, `rail at ${width}px in ${lang}`, '.analytics-rail')

      await openPanel(page, pageAt({ by: 'quota_five_hour' }))
      const note = page.locator('.quota-panel [data-note="no-five-hours"]')
      await expect(note).toHaveCount(1)
      await expect(note).toHaveText(words.panel.noFiveHours.replace('{account}', 'Work'))
      await expectNoSilentClipping(page, `five hours at ${width}px in ${lang}`, '.analytics-panel')
      const noteBox = await note.boundingBox()
      await record(info, `no-five-hours-note-${lang}-${width}`, noteBox)
      // The tile's words are whole: an ellipsis would hide what the tile is for.
      expect(cut).toHaveLength(1)
      expect(cut.filter((one) => one.short > 0)).toEqual([])
    })
