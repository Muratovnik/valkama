/**
 * Where the pointer at the latest reading's dot of a step line goes, for a spec to hold on every
 * line «now» follows, as the selector finds them. Each mark is read by the hook `StepLine`
 * documents for it.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { hintAtDot, HIT, latestHint, shareOf } from './stepAhead.ts'
import type { LineAhead } from './stepAhead.ts'

/** Whether a mark is painted, as it is only while pointed at or focused. */
const painted = (mark: Locator) =>
  mark.evaluate((node) => node.checkVisibility({ opacityProperty: true }))

/**
 * Points at the latest reading's dot on each line «now» follows, and says where the pointer went
 * instead of it. A dot farther from «now»'s mark than a mark's reach paints itself and says its
 * own hint, which stands at the dot as a point's does, and «now» stays unpainted. A dot within
 * that reach is found as «now», a place before any reading (`DESIGN.md`, the step line): «now»
 * paints its mark and its hint says the reading's share, the share at that moment.
 */
export async function pointAtLatest(page: Page, lines: LineAhead[], selector: string) {
  const strays: string[] = []
  for (const [at, line] of lines.entries()) {
    if (!line.places.some(({ kind }) => kind === 'now')) continue
    const figure = page.locator(selector).nth(at)
    await figure.evaluate((node) => node.scrollIntoView({ block: 'center' }))
    const latest = figure.locator('[data-reading]').last()
    const dot = latest.locator('[data-mark="reading"]')
    const now = figure.locator('[data-target="now"] [data-mark="place"]')
    const [box, nowBox] = [await dot.boundingBox(), await now.boundingBox()]
    if (!box || !nowBox) {
      strays.push(`line ${at}: no latest reading or no «now»`)
      continue
    }
    const middle = box.x + box.width / 2
    const beside = Math.abs(nowBox.x + nowBox.width / 2 - middle) <= HIT
    await page.mouse.move(middle, box.y + box.height / 2)
    await expect(page.getByRole('tooltip')).toBeVisible()
    const said = beside
      ? await saysBesideNow(page, latest, now)
      : await saysOwnDot(page, { lines: selector, line: at }, dot, now)
    strays.push(...said.map((stray) => `line ${at}: ${stray}`))
    await page.mouse.move(1, 1)
  }
  return strays
}

/** What is wrong where the pointer at the latest dot found «now» beside it. */
async function saysBesideNow(page: Page, latest: Locator, now: Locator) {
  const share = shareOf((await latest.getAttribute('aria-label')) ?? '')
  const words = (await page.getByRole('tooltip').textContent()) ?? ''
  return [
    ...((await painted(now)) ? [] : ['«now» unpainted beside the latest dot']),
    ...(words.includes(share) ? [] : [`«now»'s hint does not say the latest share ${share}`]),
  ]
}

/** What is wrong where the pointer at the latest dot, far from «now», found the reading. */
async function saysOwnDot(
  page: Page,
  at: { line: number; lines: string },
  dot: Locator,
  now: Locator,
) {
  const hint = await page.evaluate(latestHint, at)
  return [
    ...((await painted(dot)) ? [] : ["the latest reading's dot unpainted"]),
    ...((await painted(now)) ? ["«now» took the latest reading's dot"] : []),
    ...(hintAtDot(hint) ? [] : [`the latest reading's hint off its dot ${JSON.stringify(hint)}`]),
  ]
}
