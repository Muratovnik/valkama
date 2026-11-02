/**
 * Under a chain's totals, as an owner reads it in either language: when, at the
 * pace of the last seven days, the open part closes, and only when that can be
 * said; and behind one action, what those days added and closed, and why a
 * verdict cannot be given yet.
 *
 * Every chain here stands on 31 October 2026, the clock fixed to it, and its
 * history is stated directly as the answer's series and seven-day window.
 */
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import InspectorChain from '@/widgets/work-item-inspector/components/InspectorChain.vue'

import type { WorkItemChain } from '@/shared/api/planningChainApi.ts'
import { messages, pluralRules } from '@/shared/i18n/index.ts'

import { chainOf, historyOf, mapId, mapMember } from '../fixtures/chainMap.ts'
import type { DayChanges } from '../fixtures/chainMap.ts'

const TODAY = '2026-10-31'
const ROOT = { id: mapId(1), reference: 'MAIN-1', title: 'Root' }

/**
 * A chain with `open` open members whose history is `changes`, keyed by days
 * before today, and whose seven-day window is summed from them.
 */
function chainWith(open: number, changes: DayChanges, scope: 'chain' | 'epic' = 'chain') {
  const members = [
    mapMember('MAIN-10', 'done', ROOT.reference),
    ...Array.from({ length: open }, (_, index) =>
      mapMember(`MAIN-${100 + index}`, 'backlog', ROOT.reference),
    ),
  ]
  const { series, recent } = historyOf(TODAY, changes)
  return { ...chainOf(ROOT, members, { scope, recent }), series }
}

/** The verdict on the first screen and the pace behind the action, as rendered. */
async function rendered(chain: unknown, locale: 'en' | 'ru') {
  const wrapper = mount(InspectorChain, {
    props: {
      chain: chain as WorkItemChain,
      container: true,
      failed: false,
      loading: false,
      readable: true,
      scope: 'chain',
    },
    global: { plugins: [createI18n({ legacy: false, locale, messages, pluralRules })] },
  })
  const line = wrapper.find('.chain-forecast')
  const toggle = wrapper.find('.chain-details-toggle')
  if (toggle.exists()) {
    await toggle.trigger('click')
    await flushPromises()
  }
  const said = {
    pace: wrapper.get('.chain-pace').text(),
    verdict: line.exists() ? line.text() : null,
  }
  wrapper.unmount()
  return said
}

/** The two as read: where they may wrap is the business of one test below. */
async function read(chain: unknown, locale: 'en' | 'ru') {
  const { pace, verdict: said } = await rendered(chain, locale)
  return {
    pace: pace.replaceAll('\u{A0}', ' '),
    verdict: said === null ? null : said.replaceAll('\u{A0}', ' '),
  }
}

/** The verdict alone, for a test about its wording. */
async function verdict(chain: unknown, locale: 'en' | 'ru') {
  const said = await read(chain, locale)
  return said.verdict
}

const BEFORE: DayChanges = { 40: [200, 100] }
const everyDay = (created: number, closed: number): DayChanges =>
  Object.fromEntries(Array.from({ length: 7 }, (_, ago) => [ago, [created, closed]]))

describe('the forecast of a chain', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(`${TODAY}T15:00:00Z`))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('says when a steadily shrinking open part closes, and on what day', async () => {
    // 7 added and 70 closed: 9 a day, every day alike; 81 open is 9 days, 9 November.
    const steady = chainWith(81, { ...BEFORE, ...everyDay(1, 10) })
    expect(await read(steady, 'en')).toEqual({
      pace: 'Last 7 days: +7 added, −70 done',
      verdict: 'At this pace the open work closes in about 9 days (by Nov 9)',
    })
    expect(await read(steady, 'ru')).toEqual({
      pace: 'За 7 дней: +7 добавлено, −70 выполнено',
      verdict: 'При таком темпе открытое закроется примерно за 9 дней (к 9 нояб.)',
    })
  })

  it('gives a range, in weeks and days of the month, when the pace came in bursts', async () => {
    // 6 to 26 days (see the arithmetic's own test): one to four weeks.
    const bursts = chainWith(90, { ...BEFORE, 6: [0, 30], 3: [0, 30], 0: [0, 3] })
    expect(await verdict(bursts, 'en')).toMatch(/closes in 1–4 weeks \(Nov 6\s–\s26\)$/u)
    expect(await verdict(bursts, 'ru')).toMatch(/закроется за 1–4 недели \(6–26 нояб\.\)$/u)
  })

  it('says the open part grows, and what would turn it, when more is added than done', async () => {
    const growing = chainWith(132, { ...BEFORE, 5: [70, 50], 1: [56, 57] })
    expect(await read(growing, 'ru')).toEqual({
      pace: 'За 7 дней: +126 добавлено, −107 выполнено',
      verdict:
        'Новое появляется быстрее, чем закрывается: чтобы сойтись, нужно закрывать больше 18 в день',
    })
    expect(await read(growing, 'en')).toEqual({
      pace: 'Last 7 days: +126 added, −107 done',
      verdict: 'New work arrives faster than it closes: to converge, more than 18 a day must close',
    })
  })

  it('writes a zero without a sign', async () => {
    // Nothing closed: 5 ÷ 7 ≈ 0.71 a day, rounded up to 0.8.
    expect(await read(chainWith(20, { ...BEFORE, 3: [5, 0] }), 'en')).toEqual({
      pace: 'Last 7 days: +5 added, 0 done',
      verdict:
        'New work arrives faster than it closes: to converge, more than 0.8 a day must close',
    })
    // Nothing open, so nothing to forecast: no verdict, and the facts behind the action.
    expect(await read(chainWith(0, { ...BEFORE, 2: [0, 3] }), 'ru')).toEqual({
      pace: 'За 7 дней: 0 добавлено, −3 выполнено',
      verdict: null,
    })
  })

  it('holds no verdict when nothing moved, and says so only behind the action', async () => {
    const quiet = chainWith(20, BEFORE)
    expect(await read(quiet, 'en')).toEqual({
      pace: 'Nothing added or done in the last 7 days',
      verdict: null,
    })
    expect(await read(quiet, 'ru')).toEqual({
      pace: 'За 7 дней ничего не добавлено и не выполнено',
      verdict: null,
    })
  })

  it('says the open part holds when as much closes as is added', async () => {
    expect(await read(chainWith(20, { ...BEFORE, ...everyDay(2, 2) }), 'ru')).toEqual({
      pace: 'За 7 дней: +14 добавлено, −14 выполнено',
      verdict: 'Открытое не убывает: чтобы сойтись, нужно закрывать больше 2 в день',
    })
  })

  it('holds no verdict for a young chain, and names its days behind the action', async () => {
    expect(await read(chainWith(30, { 2: [40, 5], 0: [0, 5] }), 'ru')).toEqual({
      pace: 'Первые 3 дня: +40 добавлено, −10 выполнено. Для прогноза нужно 7 дней истории',
      verdict: null,
    })
    // A chain of one day, today: no history to chart, so nothing to fold, and the
    // pace stands as its one line.
    expect(await read(chainWith(16, { 0: [20, 4] }), 'en')).toEqual({
      pace: 'First day: +20 added, −4 done. A forecast needs 7 days of history',
      verdict: null,
    })
    expect(await read(chainWith(16, { 0: [20, 4] }), 'ru')).toEqual({
      pace: 'Первый день: +20 добавлено, −4 выполнено. Для прогноза нужно 7 дней истории',
      verdict: null,
    })
  })

  it('says an epic’s count in the chain’s words, because it is the same measure', async () => {
    // Both scopes count the members created and closed in the window; only
    // which members differs, and the scope switch beside the heading says that.
    const days = { ...BEFORE, ...everyDay(1, 10) }
    expect(await read(chainWith(81, days, 'epic'), 'en')).toEqual(
      await read(chainWith(81, days), 'en'),
    )
    expect(await read(chainWith(81, days, 'epic'), 'ru')).toEqual(
      await read(chainWith(81, days), 'ru'),
    )
    expect(await read(chainWith(20, BEFORE, 'epic'), 'ru')).toEqual({
      pace: 'За 7 дней ничего не добавлено и не выполнено',
      verdict: null,
    })
  })

  it('keeps a number with its unit and a date with its preposition when it wraps', async () => {
    const steady = chainWith(81, { ...BEFORE, ...everyDay(1, 10) })
    expect(await rendered(steady, 'ru')).toEqual({
      pace: 'За 7\u{A0}дней: +7 добавлено, −70 выполнено',
      verdict: 'При таком темпе открытое закроется примерно за 9\u{A0}дней (к\u{A0}9\u{A0}нояб.)',
    })
    const english = await rendered(steady, 'en')
    expect(english.verdict).toContain('in about 9\u{A0}days (by\u{A0}Nov\u{A0}9)')
  })

  it('leaves an open-ended range open, and gives no figure past a year', async () => {
    // One day did all the closing: 5 days at the earliest.
    expect(await verdict(chainWith(90, { ...BEFORE, 2: [0, 63] }), 'ru')).toMatch(
      /закроется не раньше чем через 5 дней: темп неровный$/u,
    )
    // 400 open at one a day.
    expect(await verdict(chainWith(400, { ...BEFORE, ...everyDay(0, 1) }), 'en')).toMatch(
      /takes more than a year to close$/u,
    )
  })
})
