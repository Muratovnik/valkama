/**
 * The Analytics sweep's readings of a page, each one call into the helpers `sweepInPage.ts`
 * installs there (`installHelpers`), so every reading names an element the same way.
 */
import type { BrowserContext, Page } from '@playwright/test'

import type { Hinted, MarkAround, Surface } from './sweepInPage.ts'
import { helperScript } from './sweepInPage.ts'
import type { Occurrence, Overflowing } from './sweepInPageLayout.ts'
import type { Point } from './sweepRules.ts'

/** Installs the helpers into every page of `context`, before the page's own scripts. */
export async function installHelpers(context: BrowserContext) {
  await context.addInitScript({ content: helperScript() })
}

/**
 * Every element of `scope`, or of the page and its panel, with a hint the pointer could raise
 * there now, each given a `data-sweep` id the later readings name it by. A hint of words the
 * element shows counts only while they are cut, since it shows only then.
 */
export function readHinted(page: Page, scope: string | null): Promise<Hinted[]> {
  return page.evaluate((scope) => window.sweepHelpers.readHinted(scope), scope)
}

/**
 * Brings the mark `id` into view and reads where to point at it: its centre and `nudge` off it
 * on each axis, a sector also a quarter and three quarters along its band, and at each point
 * every hinted element near enough to answer.
 */
export function readAround(page: Page, id: string, nudge: number): Promise<MarkAround | null> {
  return page.evaluate(([id, nudge]) => window.sweepHelpers.readAround(id, nudge), [
    id,
    nudge,
  ] as const)
}

/** The shown hint, if any, and the marks of the chart around `aimed` painted as pointed at. */
export function readSurface(page: Page, aimed: string): Promise<Surface | null> {
  return page.evaluate((aimed) => window.sweepHelpers.readSurface(aimed), aimed)
}

/**
 * Every box of the page and the panel, and the document, that scrolls sideways and is wider
 * inside than out, each said to be in `scope` where it, or what widens it, stands there.
 */
export function readOverflow(page: Page, scope: string | null): Promise<Overflowing[]> {
  return page.evaluate((scope) => window.sweepHelpers.readOverflow(scope), scope)
}

/** Every visible text of `scope`, or of the page and its panel, that holds one of `texts`. */
export function readForbidden(
  page: Page,
  texts: readonly string[],
  scope: string | null,
): Promise<Occurrence[]> {
  return page.evaluate(([texts, scope]) => window.sweepHelpers.readForbidden(texts, scope), [
    texts,
    scope,
  ] as const)
}

/**
 * Marks what a reader may press to open a value (`data-sweep-press`) and answers their paths, and
 * how many of them are marks of a chart that act.
 */
export function markPressables(page: Page): Promise<{ acting: number; paths: string[] }> {
  return page.evaluate(() => window.sweepHelpers.markPressables())
}

/** Brings the pressable `index` into view and answers a point where the pointer reaches it. */
export function pressPoint(page: Page, index: number): Promise<Point | null> {
  return page.evaluate((index) => window.sweepHelpers.pressPoint(index), index)
}
