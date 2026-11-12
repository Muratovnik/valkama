/**
 * What the bar keeps whole when its line is short of room, in the real app over the browser
 * double: the age of the newest record is never the part that is cut. A record of an earlier day
 * names its day short, by its date with the month, and says its whole age at 1440 and 1024px.
 *
 * The age is measured where its letters are drawn, against every box that would hide what it
 * covers, rather than by a box's scroll width, which misses a cut of a fraction of a pixel.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { task } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { pageAt, record } from './analyticsPage.ts'
import { NOW, serveLive } from './liveDouble.ts'
import { test } from './test.ts'

/** Two days of work this week. */
const DAYS: TimedStretch[] = [
  { at: new Date(2026, 10, 9, 10), group: { work_item: task(1, 'One') }, spend: { seconds: 3600 } },
  {
    at: new Date(2026, 10, 10, 10),
    group: { work_item: task(2, 'Two') },
    spend: { seconds: 3600 },
  },
]

/**
 * Where the age the freshness ends with is drawn, how wide its words are, and every box that
 * would hide what it covers: each around it up to the bar that does not show what overflows it,
 * and the window. Its words are read from its letters; a short bar draws them after the time
 * (`data-age`), and there they are the time's own box, against their width set in its font.
 */
async function agePlace(page: Page) {
  await page.evaluate(() => document.fonts.ready)
  const time = page.locator('.analytics-bar-fresh time')
  const drawn = await time.evaluate((element: HTMLElement) => {
    const age = element.dataset.age ?? ''
    if (element.closest('.analytics-bar-short')) {
      const copy = document.createElement('span')
      copy.textContent = age
      copy.style.cssText = `position: absolute; white-space: pre; font: ${getComputedStyle(element).font}; font-variant-numeric: tabular-nums`
      document.body.append(copy)
      const need = copy.getBoundingClientRect().width
      copy.remove()
      const { left, right } = element.getBoundingClientRect()
      return { age, need, at: [left, right] }
    }
    const texts: Text[] = []
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) texts.push(node as Text)
    const start = texts
      .map((text) => text.data)
      .join('')
      .lastIndexOf(age)
    const end = start + age.length
    const range = document.createRange()
    let at = 0
    for (const text of texts) {
      if (start >= at && start < at + text.length) range.setStart(text, start - at)
      if (end > at && end <= at + text.length) range.setEnd(text, end - at)
      at += text.length
    }
    const { left, right, width } = range.getBoundingClientRect()
    return { age, need: width, at: [left, right] }
  })
  const around = await time.evaluate((element) => {
    const clips = [{ name: 'the window', left: 0, right: document.documentElement.clientWidth }]
    for (let box: Element | null = element; box; box = box.parentElement) {
      if (getComputedStyle(box).overflowX !== 'visible') {
        const { left, right } = box.getBoundingClientRect()
        clips.push({ name: box.className || box.tagName, left, right })
      }
      if (box.matches('.analytics-bar')) break
    }
    return { words: element.textContent?.trim() ?? '', clips }
  })
  return { ...drawn, ...around }
}

/** The age stands whole, inside every box that would hide what it covers. */
function expectWholeAge(drawn: Awaited<ReturnType<typeof agePlace>>) {
  const [left = 0, right = 0] = drawn.at
  expect(right - left, `«${drawn.age}» drawn narrower than its words`).toBeGreaterThanOrEqual(
    drawn.need - 0.5,
  )
  for (const clip of drawn.clips) {
    expect(left, `«${drawn.age}» starts before ${clip.name}`).toBeGreaterThanOrEqual(
      clip.left - 0.5,
    )
    expect(right, `«${drawn.age}» is cut by ${clip.name}`).toBeLessThanOrEqual(clip.right + 0.5)
  }
}

/**
 * Newest records of an earlier day: last evening, 18 h 30 min before now, the longest age a day
 * gives, and three days back.
 */
const EARLIER_RECORDS = [
  { back: 'yesterday', earlier: new Date(NOW.getTime() - (18 * 60 + 30) * 60_000) },
  { back: 'days ago', earlier: new Date(NOW.getTime() - (3 * 24 + 2) * 3_600_000) },
] as const

/** The freshness of each: the day by its date with the month, short, then the clock and the age. */
const EARLIER_WORDS = {
  en: {
    'yesterday': /^Newest record Nov\s10,\s20:00 · 18\sh\s30\smin\sago$/u,
    'days ago': /^Newest record Nov\s8,\s12:30 · 3\sd\s2\sh\sago$/u,
  },
  ru: {
    'yesterday': /^Последняя запись 10\sнояб\.,\s20:00 · 18\sч\s30\sмин\sназад$/u,
    'days ago': /^Последняя запись 8\sнояб\.,\s12:30 · 3\sдн\.\s2\sч\sназад$/u,
  },
} as const

for (const lang of ['en', 'ru'] as const)
  test.describe(`the bar's room, ${lang}`, () => {
    test.use({ locale: lang === 'ru' ? 'ru-RU' : 'en-US' })

    for (const width of [1440, 1024])
      for (const { back, earlier } of EARLIER_RECORDS)
        test(`a record from ${back} says its date short and its whole age at ${width}px`, async ({
          page,
        }, info) => {
          const double = await serveLive(page, DAYS)
          double.lastEventAt = earlier
          await page.setViewportSize({ width, height: 900 })
          await page.goto(pageAt())
          await expect(page.locator('.analytics-bar-fresh time')).toBeVisible()
          const drawn = await agePlace(page)
          await record(info, `bar-earlier-record ${lang} ${back} ${width}`, drawn)
          expectWholeAge(drawn)
          expect(drawn.words).toMatch(EARLIER_WORDS[lang][back])
        })
  })
