/**
 * How the quota's tiles and panel say what they show: a window by its name, an account by the
 * name the owner gave it or else the start of its id, with the whole id in its hint, a share in
 * the page's whole percents, a moment by its clock time on the day of the answer and with its
 * date on another, and a span the way the app says one.
 *
 * Every figure carries where it came from and how old it is: a reading is said with its source
 * and its age, a silent window with the moment it last changed. A window with no figure says so
 * in words, so no source, a silent window and a fresh 0 % never read alike. Nothing here adds two
 * shares, and nothing names money.
 */
import { useI18n } from 'vue-i18n'

import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import { runsOutAt, stands } from '@/pages/analytics/utils/quotaFigures.ts'
import { dayOf, momentAtOffset, offsetOf } from '@/pages/analytics/utils/readMoments.ts'

import { agentIdStart } from '@/widgets/work-item-inspector/utils/agentFacts.ts'

import type { QuotaSection } from '@/shared/api/analyticsAddress.ts'
import type {
  QuotaAccount,
  QuotaRange,
  QuotaShareWindow,
  QuotaWindow,
} from '@/shared/api/analyticsApi.ts'
import { agoWords, spanWords, spanWordsOf } from '@/shared/lib/timeSpan.ts'
import type { StepPoint } from '@/shared/ui/windowGeometry.ts'

/** An account by its owner's name, or else by the start of its id or its organization's. */
const accountName = (account: QuotaAccount) =>
  account.name ?? agentIdStart(account.account_uuid ?? account.organization)

export function useQuotaWords() {
  const { t } = useI18n()
  const words = useSpendingWords()
  const span = spanWordsOf(t)

  const sectionName = (section: QuotaSection) => t(`analytics.quota.sections.${section}`)

  const windowName = (window: QuotaWindow) =>
    window.kind === 'week_model'
      ? t('analytics.quota.windows.week_model', { model: window.model ?? '' })
      : t(`analytics.quota.windows.${window.kind}`)

  /** A share of a window in the page's whole percents, never claiming more or less than it is. */
  const share = (percent: number) => words.share(percent / 100)

  const state = (window: QuotaWindow) => t(`analytics.quota.states.${window.state}`)
  const source = (window: QuotaWindow) => t(`analytics.quota.sources.${window.latest.source}`)

  /** What the name leaves out: the whole ids, said for the hint. */
  function accountDetail(account: QuotaAccount) {
    const { organization } = account
    if (account.account_uuid)
      return t('analytics.quota.panel.account', { account: account.account_uuid, organization })
    if (account.seat) return t('analytics.quota.panel.seat', { seat: account.seat, organization })
    return t('analytics.quota.panel.organization', { organization })
  }

  /** A moment of the answer by its clock time on the answer's day, with its date on another. */
  const moment = (at: string, today: string) =>
    dayOf(at) === dayOf(today) ? words.stepName(at, 'minute').label : words.datedClock(at)

  const ago = (at: string, now: number) => agoWords(Date.parse(at), now, span)

  /** The bar's words for a reader who cannot see it: the share, the pace and the state. */
  function barLabel(window: QuotaShareWindow) {
    const values = {
      window: windowName(window),
      share: share(window.latest.used_percent),
      state: state(window),
    }
    return window.even_percent === null
      ? t('analytics.quota.barNoPace', values)
      : t('analytics.quota.bar', { ...values, even: share(window.even_percent) })
  }

  const used = (window: QuotaShareWindow) =>
    t('analytics.quota.used', { share: share(window.latest.used_percent) })

  const even = (window: QuotaShareWindow) =>
    window.even_percent === null
      ? t('analytics.quota.noPace')
      : t('analytics.quota.even', { share: share(window.even_percent) })

  /** When the window resets, in absolute and in relative time; or that it reset since read. */
  function reset(window: QuotaWindow, now: number, today: string) {
    if (window.resets_at === null) return t('analytics.quota.noReset')
    const at = moment(window.resets_at, today)
    if (!stands(window, now)) return t('analytics.quota.reset', { at })
    const left = Math.max(0, Date.parse(window.resets_at) - now)
    return t('analytics.quota.resets', { at, in: spanWords(left, span) })
  }

  /**
   * A week's range, never past 100 %, which a quota cannot pass: a low end there runs the window
   * out before the reset, about when its slower pace says; a high end there only may; ends said
   * alike are one value.
   */
  function range(window: QuotaShareWindow, found: QuotaRange, today: string) {
    const low = share(found.low_percent)
    const high = share(found.high_percent)
    if (window.latest.used_percent >= 100) return t('analytics.quota.forecast.spent')
    if (found.low_percent >= 100) {
      const at = runsOutAt(window, found.low_percent, Date.parse(today))
      if (at === null) return t('analytics.quota.forecast.short')
      const said = moment(momentAtOffset(at, offsetOf(today)), today)
      return t('analytics.quota.forecast.shortBy', { at: said })
    }
    if (found.high_percent >= 100) return t('analytics.quota.forecast.mayRunOut', { low })
    if (low === high) return t('analytics.quota.forecast.one', { share: low })
    return t('analytics.quota.forecast.range', { low, high })
  }

  /** The five hours as a point — lasts, runs out at a time, spent — and a week as a range. */
  function forecast(window: QuotaShareWindow, today: string) {
    const found = window.forecast
    if (!found) return t('analytics.quota.forecast.none')
    if ('low_percent' in found) return range(window, found, today)
    if (found.outcome === 'runs_out' && found.runs_out_at)
      return t('analytics.quota.forecast.runs_out', { at: moment(found.runs_out_at, today) })
    return t(`analytics.quota.forecast.${found.outcome === 'spent' ? 'spent' : 'lasts'}`)
  }

  /** How old the latest reading is and who read it; a silent one since when it has not moved. */
  function latest(window: QuotaWindow, now: number, today: string) {
    const values = { ago: ago(window.latest.at, now), source: source(window) }
    return window.state === 'silent'
      ? t('analytics.quota.silentSince', { ...values, at: moment(window.latest.at, today) })
      : t('analytics.quota.read', values)
  }

  /** A window of money past a limit: its state, its age and its source, and no figure. */
  const other = (window: QuotaWindow, now: number) =>
    t('analytics.quota.other', {
      window: windowName(window),
      state: state(window),
      ago: ago(window.latest.at, now),
      source: source(window),
    })

  /** A window's readings as a step line takes them, each said with its moment and source. */
  const points = (window: QuotaShareWindow, today: string): StepPoint[] =>
    window.readings.map((reading, index) => {
      const at = moment(reading.at, today)
      const valueText = share(reading.used_percent)
      const noteText = t(`analytics.quota.sources.${reading.source}`)
      return {
        key: `${index}`,
        at: Date.parse(reading.at),
        value: reading.used_percent,
        text: t('analytics.quota.readings.text', { at, share: valueText, source: noteText }),
        timeText: at,
        valueText,
        noteText,
      }
    })

  /** The step line's words for a reader who cannot see it: every reading with its moment. */
  const readingsLabel = (account: QuotaAccount, window: QuotaShareWindow, today: string) =>
    t('analytics.quota.readings.label', {
      window: windowName(window),
      account: accountName(account),
      from: window.started_at ? moment(window.started_at, today) : '',
      to: window.resets_at ? moment(window.resets_at, today) : '',
      readings: points(window, today)
        .map((point) =>
          t('analytics.quota.readings.reading', { share: point.valueText, at: point.timeText }),
        )
        .join(', '),
    })

  return {
    accountDetail,
    accountName,
    ago,
    barLabel,
    even,
    forecast,
    latest,
    moment,
    other,
    points,
    readingsLabel,
    reset,
    sectionName,
    share,
    state,
    used,
    windowName,
  }
}
