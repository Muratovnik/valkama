import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import {
  dayAfter,
  forecastChain,
  forecastSpan,
  historyDays,
} from '@/widgets/work-item-inspector/utils/chainForecast.ts'
import type { ChainForecast } from '@/widgets/work-item-inspector/utils/chainForecast.ts'
import { dayFormat, seriesDate } from '@/widgets/work-item-inspector/utils/chainSummary.ts'

import type { WorkItemChain } from '@/shared/api/planningChainApi.ts'

/** Today on the UTC calendar the chain's days are written in. */
function utcToday(): string {
  return new Date().toISOString().slice(0, 10)
}

/** A count with the sign of what it did to the open part, and zero with none. */
function signed(count: number, sign: '+' | '−'): string {
  return count === 0 ? '0' : `${sign}${count}`
}

/**
 * The chain's last seven days in one line: what was added and closed, and what
 * that pace says about when the open part closes.
 *
 * The facts come first because the forecast is only as good as they are; the
 * forecast replaces a bare "growing" or "converging" with the question the
 * reader has — whether, and when. A chain younger than the window says so
 * instead, and a window in which nothing moved says that and nothing more.
 */
export function useChainForecast(chain: () => WorkItemChain | null) {
  const { t, locale } = useI18n()

  /** A rate a day, to a tenth and rounded up, so "more than" it is enough. */
  function rate(perDay: number): string {
    return new Intl.NumberFormat(locale.value, { maximumFractionDigits: 1 }).format(
      Math.ceil(perDay * 10) / 10,
    )
  }

  /** The day or days a forecast lands on, kept on one line. */
  function dates(today: string, low: number, high: number): string {
    const format = dayFormat(locale.value)
    const from = seriesDate(dayAfter(today, low))
    const text =
      low === high
        ? format.format(from)
        : format.formatRange(from, seriesDate(dayAfter(today, high)))
    return text.replaceAll(' ', '\u{A0}')
  }

  function converging(forecast: Extract<ChainForecast, { kind: 'converging' }>, today: string) {
    const span = forecastSpan(forecast.low, forecast.high)
    if (!span) return t('workItem.chain.forecast.year')
    const key = `workItem.chain.forecast.${span.unit}`
    if (span.high === null)
      return t('workItem.chain.forecast.earliest', { span: t(key, { count: span.low }, span.low) })
    const point = span.low === span.high
    const count = point ? span.low : `${span.low}–${span.high}`
    const words = { span: t(key, { count }, span.high) }
    // A date is as exact as a day or a week; a month away it is not.
    if (span.unit === 'month')
      return t(point ? 'workItem.chain.forecast.about' : 'workItem.chain.forecast.range', words)
    const date = dates(today, forecast.low, forecast.high ?? forecast.low)
    return t(point ? 'workItem.chain.forecast.aboutBy' : 'workItem.chain.forecast.rangeOn', {
      ...words,
      date,
    })
  }

  function verdict(forecast: ChainForecast, today: string, days: number): string | null {
    switch (forecast.kind) {
      case 'converging': {
        return converging(forecast, today)
      }
      case 'growing':
      case 'steady': {
        return t(`workItem.chain.forecast.${forecast.kind}`, { rate: rate(forecast.needed) })
      }
      case 'young': {
        return t('workItem.chain.forecast.young', { days })
      }
      default: {
        return null
      }
    }
  }

  return computed(() => {
    const current = chain()
    if (!current) return ''
    const today = utcToday()
    const { days, created, closed } = current.recent
    const epic = current.scope === 'epic'
    if (created === 0 && closed === 0)
      return t(epic ? 'workItem.chain.forecast.quietEpic' : 'workItem.chain.forecast.quiet', {
        days,
      })
    const history = historyDays(current.series, today) ?? days
    const period =
      history < days
        ? t('workItem.chain.forecast.first', { count: history }, history)
        : t('workItem.chain.forecast.window', { days })
    const facts = t(epic ? 'workItem.chain.forecast.factsEpic' : 'workItem.chain.forecast.facts', {
      period,
      created: signed(created, '+'),
      closed: signed(closed, '−'),
    })
    const said = verdict(forecastChain(current, today), today, days)
    return said ? t('workItem.chain.forecast.line', { facts, verdict: said }) : facts
  })
}
