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

/** Whether anything moved in the window: a chain that stood still has no forecast at all. */
const moved = (current: WorkItemChain) => current.recent.created + current.recent.closed > 0

/**
 * The chain's last seven days, as two answers. The `verdict` is what that pace says
 * about when the open part closes, and it is empty where the pace says nothing, so
 * the first screen holds a forecast only when there is one. The `pace` is what was
 * added and closed, the evidence behind it: a chain younger than the window also
 * says there why it has no verdict, and a window in which nothing moved says that
 * and nothing more.
 *
 * The verdict replaces a bare "growing" or "converging" with the question the
 * reader has — whether, and when.
 *
 * Both scopes count the same thing — members created inside the window, and
 * members closed inside it — so both say it in the same words. The chain scope
 * used to call its new work "discovered", which a child filed as planned is
 * not, and the epic scope "added", for one and the same count.
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

  function said(forecast: ChainForecast, today: string): string {
    switch (forecast.kind) {
      case 'converging': {
        return converging(forecast, today)
      }
      case 'growing':
      case 'steady': {
        return t(`workItem.chain.forecast.${forecast.kind}`, { rate: rate(forecast.needed) })
      }
      default: {
        return ''
      }
    }
  }

  const verdict = computed(() => {
    const current = chain()
    if (!current || !moved(current)) return ''
    const today = utcToday()
    return said(forecastChain(current, today), today)
  })

  const pace = computed(() => {
    const current = chain()
    if (!current) return ''
    const today = utcToday()
    const { days, created, closed } = current.recent
    if (!moved(current)) return t('workItem.chain.forecast.quiet', { days })
    const history = historyDays(current.series, today) ?? days
    const period =
      history < days
        ? t('workItem.chain.forecast.first', { count: history }, history)
        : t('workItem.chain.forecast.window', { days })
    const facts = t('workItem.chain.forecast.facts', {
      period,
      created: signed(created, '+'),
      closed: signed(closed, '−'),
    })
    return forecastChain(current, today).kind === 'young'
      ? t('workItem.chain.forecast.line', {
          facts,
          verdict: t('workItem.chain.forecast.young', { days }),
        })
      : facts
  })

  return { pace, verdict }
}
