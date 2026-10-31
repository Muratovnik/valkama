/**
 * The line under a chain's totals, as an owner reads it in either language:
 * what the last seven days added and closed, and when, at that pace, the open
 * part closes — or why that cannot be said yet.
 *
 * Every chain here stands on 31 October 2026, the clock fixed to it, and its
 * history is stated directly as the answer's series and seven-day window.
 */
import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
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

/** The line as rendered, no-break spaces included. */
function rendered(chain: unknown, locale: 'en' | 'ru') {
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
  const text = wrapper.get('.chain-forecast').text()
  wrapper.unmount()
  return text
}

/** The line as read: where it may wrap is the business of one test below. */
function line(chain: unknown, locale: 'en' | 'ru') {
  return rendered(chain, locale).replaceAll('\u{A0}', ' ')
}

const BEFORE: DayChanges = { 40: [200, 100] }
const everyDay = (created: number, closed: number): DayChanges =>
  Object.fromEntries(Array.from({ length: 7 }, (_, ago) => [ago, [created, closed]]))

describe('the forecast line of a chain', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(`${TODAY}T15:00:00Z`))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('says when a steadily shrinking open part closes, and on what day', () => {
    // 7 added and 70 closed: 9 a day, every day alike; 81 open is 9 days, 9 November.
    const steady = chainWith(81, { ...BEFORE, ...everyDay(1, 10) })
    expect(line(steady, 'en')).toBe(
      'Last 7 days: +7 discovered, −70 closed. At this pace the open work closes in about 9 days (by Nov 9)',
    )
    expect(line(steady, 'ru')).toBe(
      'За 7 дней: +7 обнаружено, −70 закрыто. При таком темпе открытое закроется примерно за 9 дней (к 9 нояб.)',
    )
  })

  it('gives a range, in weeks and days of the month, when the pace came in bursts', () => {
    // 6 to 26 days (see the arithmetic's own test): one to four weeks.
    const bursts = chainWith(90, { ...BEFORE, 6: [0, 30], 3: [0, 30], 0: [0, 3] })
    expect(line(bursts, 'en')).toMatch(/closes in 1–4 weeks \(Nov 6\s–\s26\)$/u)
    expect(line(bursts, 'ru')).toMatch(/закроется за 1–4 недели \(6–26 нояб\.\)$/u)
  })

  it('says the open part grows, and what would turn it, when more is added than closed', () => {
    const growing = chainWith(132, { ...BEFORE, 5: [70, 50], 1: [56, 57] })
    expect(line(growing, 'ru')).toBe(
      'За 7 дней: +126 обнаружено, −107 закрыто. Новое появляется быстрее, чем закрывается: чтобы сойтись, нужно закрывать больше 18 в день',
    )
    expect(line(growing, 'en')).toBe(
      'Last 7 days: +126 discovered, −107 closed. New work arrives faster than it closes: to converge, more than 18 a day must close',
    )
  })

  it('writes a zero without a sign', () => {
    // Nothing closed: 5 ÷ 7 ≈ 0.71 a day, rounded up to 0.8.
    expect(line(chainWith(20, { ...BEFORE, 3: [5, 0] }), 'en')).toBe(
      'Last 7 days: +5 discovered, 0 closed. New work arrives faster than it closes: to converge, more than 0.8 a day must close',
    )
    // Nothing open, so nothing to forecast: the facts alone.
    expect(line(chainWith(0, { ...BEFORE, 2: [0, 3] }), 'ru')).toBe(
      'За 7 дней: 0 обнаружено, −3 закрыто',
    )
  })

  it('says that nothing moved, and only that, when nothing did', () => {
    const quiet = chainWith(20, BEFORE)
    expect(line(quiet, 'en')).toBe('Nothing discovered or closed in the last 7 days')
    expect(line(quiet, 'ru')).toBe('За 7 дней ничего не обнаружено и не закрыто')
  })

  it('says the open part holds when as much closes as is added', () => {
    expect(line(chainWith(20, { ...BEFORE, ...everyDay(2, 2) }), 'ru')).toBe(
      'За 7 дней: +14 обнаружено, −14 закрыто. Открытое не убывает: чтобы сойтись, нужно закрывать больше 2 в день',
    )
  })

  it('names a young chain’s days and asks for a week before it forecasts', () => {
    expect(line(chainWith(30, { 2: [40, 5], 0: [0, 5] }), 'ru')).toBe(
      'Первые 3 дня: +40 обнаружено, −10 закрыто. Для прогноза нужно 7 дней истории',
    )
    // A chain of one day, today.
    expect(line(chainWith(16, { 0: [20, 4] }), 'en')).toBe(
      'First day: +20 discovered, −4 closed. A forecast needs 7 days of history',
    )
    expect(line(chainWith(16, { 0: [20, 4] }), 'ru')).toBe(
      'Первый день: +20 обнаружено, −4 закрыто. Для прогноза нужно 7 дней истории',
    )
  })

  it('reads an epic’s own children as added rather than discovered', () => {
    const epic = chainWith(81, { ...BEFORE, ...everyDay(1, 10) }, 'epic')
    expect(line(epic, 'en')).toBe(
      'Last 7 days: +7 added, −70 closed. At this pace the open work closes in about 9 days (by Nov 9)',
    )
    expect(line(chainWith(20, BEFORE, 'epic'), 'ru')).toBe(
      'За 7 дней ничего не добавлено и не закрыто',
    )
  })

  it('keeps a number with its unit and a date with its preposition when it wraps', () => {
    const steady = chainWith(81, { ...BEFORE, ...everyDay(1, 10) })
    expect(rendered(steady, 'ru')).toBe(
      'За 7\u{A0}дней: +7 обнаружено, −70 закрыто. При таком темпе открытое закроется примерно за 9\u{A0}дней (к\u{A0}9\u{A0}нояб.)',
    )
    expect(rendered(steady, 'en')).toContain('in about 9\u{A0}days (by\u{A0}Nov\u{A0}9)')
  })

  it('leaves an open-ended range open, and gives no figure past a year', () => {
    // One day did all the closing: 5 days at the earliest.
    expect(line(chainWith(90, { ...BEFORE, 2: [0, 63] }), 'ru')).toMatch(
      /закроется не раньше чем через 5 дней: темп неровный$/u,
    )
    // 400 open at one a day.
    expect(line(chainWith(400, { ...BEFORE, ...everyDay(0, 1) }), 'en')).toMatch(
      /takes more than a year to close$/u,
    )
  })
})
