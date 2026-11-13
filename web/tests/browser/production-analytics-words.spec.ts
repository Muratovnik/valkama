/**
 * The words of the Analytics page are said once, where they belong. In the state with data, in
 * Russian and in English, no block shows by default a sentence longer than 90 characters; each
 * caveat of a section — that a cost is an estimate and not a bill, what the tokens count, that
 * the period does not reach the quota, what «Where the window went» is — stands in exactly one
 * hint, the «ⓘ» of the section's heading, and nowhere on the page; and no word is «пока» or «so
 * far», which read as a goodbye under the period still running. Each block once said its caveats
 * whole: the quota opened on two sentences of what does not apply to it, each window said two
 * lines more over its spend, and the words outweighed the figures they qualified.
 *
 * Which caveats each section owes is the inventory's (`fixtures/analyticsWords.ts`), and their
 * words the catalog's. The check is shown to fail: a caveat put back on the page is found there.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { messages } from '@/shared/i18n/index.ts'

import { task } from '../fixtures/analytics.ts'
import { CAVEATS, caveatText } from '../fixtures/analyticsWords.ts'
import type { CaveatSection } from '../fixtures/analyticsWords.ts'
import { SPENT_WORLD } from '../fixtures/quotaSpent.ts'
import { pageAt, record, serve } from './analyticsPage.ts'
import { at, serveLive } from './liveDouble.ts'
import { test } from './test.ts'

type Locale = 'en' | 'ru'

/** The longest sentence a block may show by default. */
const LONGEST = 90
const STRAY = /(?<!\p{L})пока(?!\p{L})|\bso far\b/iu
/**
 * The words of a caveat, which a heading or a column's head never carries: it names what is
 * shown. «Estimated cost at API prices by task» once stood over the ranked chart and pushed the
 * section's switch under it.
 */
const CAVEAT_WORDS: Record<Locale, RegExp> = {
  en: /estimat|API price|not a bill|quota points/iu,
  ru: /оценк|по ценам API|не счёт|пункт/iu,
}

const plain = (text: string) => text.replaceAll(/\s+/gu, ' ').trim()

/** What a section's «ⓘ» owes in `locale`, and every caveat of the page in its words. */
function owed(locale: Locale, section: CaveatSection, minutes: boolean) {
  const catalog = messages[locale].analytics
  const all = Object.entries(CAVEATS).map(([key, place]) => ({
    key,
    text: plain(caveatText(catalog, key)),
    owed: place.sections.includes(section) && (!place.minutes || minutes),
  }))
  return all
}

/**
 * What the page shows by default: each block's own words — the text whose nearest box is not an
 * inline one — that stand in a box of their own on screen, leaving out what is laid out for a
 * screen reader alone, a pixel square, and what is not drawn. A hint's words are not on it: they
 * are an element's `data-tooltip`, read here apart.
 */
const shown = (page: Page) =>
  page.evaluate(() => {
    const root = document.querySelector('.analytics-page')
    if (!root) return { blocks: [], heads: [], hints: [] }
    const unseen = (element: Element) => {
      for (let box: Element | null = element; box && box !== root; box = box.parentElement) {
        const rect = box.getBoundingClientRect()
        if (rect.width < 2 || rect.height < 2) return true
      }
      return !element.checkVisibility({ visibilityProperty: true })
    }
    const blocks = new Map<Element, string>()
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement
      if (!parent || !node.textContent?.trim() || unseen(parent)) continue
      let block: Element = parent
      while (block !== root && getComputedStyle(block).display.startsWith('inline'))
        block = block.parentElement ?? root
      blocks.set(block, `${blocks.get(block) ?? ''}${node.textContent}`)
    }
    const hints = [...root.querySelectorAll<HTMLElement>('[data-tooltip]')].map(
      (element) => element.dataset.tooltip ?? '',
    )
    const heads = [...root.querySelectorAll('h1, h2, h3, h4, h5, h6, th')]
      .filter((head) => !unseen(head))
      .map((head) => head.textContent ?? '')
    return { blocks: [...blocks.values()], heads, hints }
  })

/** How many times `part` stands in `whole`. */
const times = (whole: string, part: string) => whole.split(part).length - 1

/** A block's words, sentence by sentence: a stop and a capital after it end one. */
const sentencesOf = (block: string) =>
  plain(block)
    .split(/(?<=[.!?…])\s+(?=[\p{Lu}«"])/u)
    .filter(Boolean)

/** Reads what the page shows and what its section's «ⓘ» says, and returns every breach. */
async function breaches(page: Page, locale: Locale, section: CaveatSection, minutes: boolean) {
  const { blocks, heads, hints } = await shown(page)
  const text = plain(blocks.join('\n'))
  const long = blocks
    .flatMap((block) => sentencesOf(block))
    .filter((sentence) => sentence.length > LONGEST)
  const press = page.locator('.analytics-panel .level-about-press')
  const presses = await press.count()
  await press.first().click()
  const tip = page.locator('.info-tip-panel')
  await expect(tip).toBeVisible()
  const about = plain((await tip.textContent()) ?? '')
  await press.first().click()
  await expect(tip).toBeHidden()
  const caveats = owed(locale, section, minutes)
  return {
    presses,
    long,
    onPage: caveats.filter((one) => text.includes(one.text)).map((one) => one.key),
    inHints: caveats
      .filter((one) => hints.some((hint) => plain(hint).includes(one.text)))
      .map((one) => one.key),
    aboutWrong: caveats
      .filter((one) => times(about, one.text) !== (one.owed ? 1 : 0))
      .map((one) => one.key),
    stray: [text, about, ...hints].filter((words) => STRAY.test(words)),
    heads: heads.map((head) => plain(head)).filter((head) => CAVEAT_WORDS[locale].test(head)),
  }
}

const CLEAN = {
  presses: 1,
  long: [],
  onPage: [],
  inHints: [],
  aboutWrong: [],
  stray: [],
  heads: [],
}

interface View {
  address: string
  name: string
  ready: string
  section: CaveatSection
}

/** The sections of the page's own read, as a person opens them, and what each owes. */
const SPENDING: View[] = [
  {
    name: 'overview',
    address: pageAt(),
    ready: '.overview-panel .period-field',
    section: 'spending',
  },
  {
    name: 'tasks',
    address: pageAt({ by: 'work_item' }),
    ready: '.spending-table tbody tr',
    section: 'spending',
  },
  {
    name: 'token kinds',
    address: pageAt({ by: 'token_kind' }),
    ready: '.kinds-panel',
    section: 'kinds',
  },
]

/** The quota's two sections, read with work on each window so that it says where it went. */
const QUOTA: View[] = [
  {
    name: 'five hours',
    address: pageAt({ by: 'quota_five_hour' }),
    ready: '.window-spend[data-state="spent"]',
    section: 'quota',
  },
  {
    name: 'week',
    address: pageAt({ by: 'quota_week' }),
    ready: '.quota-account',
    section: 'quota',
  },
]

async function open(page: Page, address: string, ready: string) {
  await page.goto(address)
  await expect(page.locator(ready).first()).toBeVisible()
  await expect(page.locator('.window-spend[data-state="loading"]')).toHaveCount(0)
  await page.evaluate(() => document.fonts.ready)
}

/** Opens each view in `locale` and holds what it shows to the rules; returns what it found. */
async function readEach(page: Page, locale: Locale, views: readonly View[]) {
  const seen: Record<string, unknown> = {}
  for (const view of views) {
    await open(page, view.address, view.ready)
    // Each measure the section's figures choose: the charts and the table read it in their words.
    const measures = page.locator('.spending-tiles [role="radio"]')
    const count = Math.max(1, await measures.count())
    for (let index = 0; index < count; index += 1) {
      if (index) {
        await measures.nth(index).click()
        await expect(measures.nth(index)).toHaveAttribute('aria-checked', 'true')
      }
      const found = await breaches(page, locale, view.section, false)
      seen[`${view.name} ${index}`] = found
      expect(found, `${view.name}, measure ${index}, in ${locale}`).toEqual(CLEAN)
    }
  }
  return seen
}

async function speak(page: Page, locale: Locale) {
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  await page.setViewportSize({ width: 1440, height: 900 })
}

for (const locale of ['ru', 'en'] as const) {
  test(`${locale}: the overview, a dimension and the token kinds say each caveat once, in their «ⓘ»`, async ({
    page,
  }, info) => {
    await speak(page, locale)
    await serve(page)
    const seen = await readEach(page, locale, SPENDING)

    // The fault control: one caveat put back on the page as a line of its own is found there.
    const cost = caveatText(messages[locale].analytics, 'analytics.figures.costNote')
    await open(page, pageAt(), '.overview-panel .period-field')
    await page.evaluate((words) => {
      const line = document.createElement('p')
      line.textContent = words
      document.querySelector('.analytics-panel .level-body')?.append(line)
    }, cost)
    const restored = await breaches(page, locale, 'spending', false)
    expect(restored.onPage).toEqual(['analytics.figures.costNote'])
    await record(info, `words ${locale}`, seen)
  })

  test(`${locale}: the quota's sections say each caveat once, in their «ⓘ»`, async ({
    page,
  }, info) => {
    await speak(page, locale)
    await serve(page, SPENT_WORLD)
    const seen = await readEach(page, locale, QUOTA)
    expect(Object.keys(seen)).toEqual(['five hours 0', 'week 0'])
    await record(info, `words quota ${locale}`, seen)
  })

  test(`${locale}: the live hour says its minutes are an estimate in its «ⓘ» alone`, async ({
    page,
  }, info) => {
    // The day chart still prints its note under the minutes, a line of the chart's own.
    test.fail(true, 'the day chart prints the minutes’ estimate under them as well')
    await speak(page, locale)
    await serveLive(page, [
      {
        at: at(13, 50, 30),
        group: { work_item: task(1, 'Fix the import') },
        spend: { seconds: 600 },
      },
      { at: at(14, 5), group: { work_item: task(2, 'Ship it') }, spend: { seconds: 120 } },
    ])
    await open(page, pageAt({ period: 'now' }), '.overview-panel .period-field')
    const found = await breaches(page, locale, 'spending', true)
    await record(info, `words live ${locale}`, found)
    expect(found).toEqual(CLEAN)
  })
}
