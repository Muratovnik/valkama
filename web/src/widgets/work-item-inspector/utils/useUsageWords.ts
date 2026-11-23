import { useI18n } from 'vue-i18n'

import type { ItemUsage, UsageTokens } from '@/shared/api/planningUsageApi.ts'
import { spanWords, spanWordsOf } from '@/shared/lib/timeSpan.ts'
import { tokensAnew } from '@/shared/lib/tokensAnew.ts'

/**
 * The words of a usage read, in the one way the card says them. A number the server has
 * no data for reads as no data and never as a zero; what is only an estimate says so with
 * «≈», and a cost that leaves models out with «+».
 */

/** What a line of the read says of time and spending, whichever line it is. */
export type UsageFigures = Pick<ItemUsage, 'estimated_api_cost_usd' | 'tokens'> & {
  /** What this line's time is, in seconds: the clock's or the sum of its agents'. */
  seconds: number
}

const ESTIMATE = '≈\u{A0}'
const INCOMPLETE = '+'
/** The least cost a figure counts, a cent: under it a cost reads «< $0.01». */
export const LEAST_COST = 0.01
/** From here a count is said in thousands, whose word takes the same form at any number. */
const COMPACT_FROM = 1000

/** Whether a line has anything to say: a read with nothing in it is no line and no zeros. */
export function saysAnything(line: UsageFigures): boolean {
  return (
    line.seconds > 0 ||
    line.estimated_api_cost_usd !== null ||
    Boolean(tokensAnew(line.tokens)) ||
    Boolean(line.tokens.cached_read)
  )
}

/** Whether the read's time is, in whole or in part, rebuilt rather than observed. */
export const isEstimated = (usage: Pick<ItemUsage, 'quality'>) =>
  usage.quality === 'estimated' || usage.quality === 'mixed'

export function useUsageWords() {
  const { locale, t } = useI18n()

  const compact = (value: number) =>
    new Intl.NumberFormat(locale.value, { notation: 'compact', maximumFractionDigits: 1 }).format(
      value,
    )
  const money = (value: number) =>
    new Intl.NumberFormat(locale.value, { style: 'currency', currency: 'USD' }).format(value)
  const span = (seconds: number) => spanWords(seconds * 1000, spanWordsOf(t))

  /** A span of work, marked when it is an estimate; empty where no time was counted. */
  function time(seconds: number, estimated = false): string {
    if (seconds <= 0) return ''
    return `${estimated ? ESTIMATE : ''}${span(seconds)}`
  }

  /**
   * A cost, marked as the estimate it always is, and as incomplete when models are left out
   * of it; empty where no request had a price. Under a cent it says so rather than «$0.00».
   */
  function cost(usd: number | null, incomplete = false): string {
    if (usd === null) return ''
    if (usd > 0 && usd < LEAST_COST) return `<\u{A0}${money(LEAST_COST)}`
    return `${ESTIMATE}${money(usd)}${incomplete ? INCOMPLETE : ''}`
  }

  /** The tokens processed anew with their word; empty when no request reported any. */
  function tokens(spent: UsageTokens): string {
    const anew = tokensAnew(spent)
    return anew
      ? t('workItem.usage.tokens', { count: compact(anew) }, Math.min(anew, COMPACT_FROM))
      : ''
  }

  /** The tokens processed anew alone, for a place that already names them. */
  const tokenFigure = (spent: UsageTokens) => {
    const anew = tokensAnew(spent)
    return anew === null ? '' : compact(anew)
  }

  /** The three figures of a row, in their own columns: nothing is left blank or a zero. */
  function figures(line: UsageFigures, estimated = false) {
    const noData = t('workItem.usage.noData')
    return [
      { key: 'time', text: time(line.seconds, estimated) || t('workItem.usage.onTheSide') },
      { key: 'tokens', text: tokens(line.tokens) || noData },
      { key: 'cost', text: cost(line.estimated_api_cost_usd) || noData },
    ]
  }

  /**
   * Whether agents worked side by side, so that the time on the clock and the agents' time say
   * two figures: where they say one, the agents' time is not said again.
   */
  const sideBySide = (usage: Pick<ItemUsage, 'agent_seconds' | 'elapsed_seconds'>) =>
    span(usage.elapsed_seconds) !== span(usage.agent_seconds)

  /** The agents' time, the sum of each one's, in the one way the card, its tab and Analytics say it. */
  const agentTime = (usage: Pick<ItemUsage, 'agent_seconds' | 'quality'>) =>
    time(usage.agent_seconds, isEstimated(usage))

  /**
   * What the figures of a read are, one sentence each and only those that apply, by the figure
   * each explains, and apart from them what a missing price does to the cost, or nothing.
   */
  function explanations(usage: ItemUsage) {
    const models = usage.unpriced_models.join(', ')
    const parallel = sideBySide(usage)
    const work: string[] = []
    if (usage.quality === 'estimated') work.push(t('workItem.usage.estimated'))
    if (usage.quality === 'mixed')
      work.push(
        t('workItem.usage.mixed', {
          part: span(usage.estimated_seconds),
          whole: span(usage.agent_seconds),
        }),
      )
    const key = usage.estimated_api_cost_usd === null ? 'unknownCost' : 'unpriced'
    return {
      work,
      agents: parallel ? [t('workItem.usage.parallel')] : [],
      cost: usage.estimated_api_cost_usd === null ? [] : [t('workItem.usage.costNote')],
      unpriced: models ? t(`workItem.usage.${key}`, { models }) : '',
    }
  }

  /** What the numbers of a read are, one sentence each, and only those that apply. */
  function notes(usage: ItemUsage): string[] {
    const { work, agents, cost, unpriced } = explanations(usage)
    return [...agents, ...cost, ...work, ...(unpriced ? [unpriced] : [])]
  }

  /**
   * An item's cost as its card's line says it: the estimate, marked incomplete when models are
   * left out of it, «no price» where none had one, and nothing where nothing was priced or asked.
   */
  function itemCost(usage: Pick<ItemUsage, 'estimated_api_cost_usd' | 'unpriced_models'>) {
    const { estimated_api_cost_usd: usd, unpriced_models: unpriced } = usage
    if (usd === null) return unpriced.length ? t('workItem.usage.noPrice') : ''
    return cost(usd, unpriced.length > 0)
  }

  return {
    agentTime,
    cost,
    explanations,
    figures,
    itemCost,
    notes,
    sideBySide,
    span,
    time,
    tokenFigure,
    tokens,
  }
}
