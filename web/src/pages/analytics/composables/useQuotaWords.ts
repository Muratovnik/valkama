/**
 * How the quota's tiles and panel say what they show: a window by its name, an account by the
 * name the owner gave it or else the start of its id, with the whole id in its hint, a share in
 * the page's whole percents, a moment by its clock time on the day of the answer and with its
 * date on another, and a span the way the app says one.
 *
 * Every figure carries where it came from and how old it is: a reading is said with its source
 * and its age, a silent window with how long it has been silent and the moment it last changed.
 * Whether a window is fresh or silent is judged at the panel's moment `now` against the answer's
 * threshold `freshFor`, in seconds (`stateAt`), never taken from the answer's `state`, which was
 * true only when the server answered. A
 * window with no figure says so in words, so no source, a silent window and a fresh 0 % never
 * read alike. A forecast is said after the key that names its hatch, «Forecast · …», wherever a
 * drawing hatches it, and what a step line points at past its readings — the window now and its
 * forecast at the reset — is said here for its hint and its table. Nothing here adds two shares,
 * and nothing names money.
 */
import { useI18n } from 'vue-i18n'

import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import { runsOutAt, stands, stateAt } from '@/pages/analytics/utils/quotaFigures.ts'
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
import type { StepPoint, StepTarget, WindowAhead } from '@/shared/ui/windowGeometry.ts'

/** An account by its owner's name, or else by the start of its id or its organization's. */
const accountName = (account: QuotaAccount) =>
  account.name ?? agentIdStart(account.account_uuid ?? account.organization)

/** Whether a window is silent at `now` (ms), by the answer's threshold `freshFor` (s). */
const silent = (window: QuotaWindow, now: number, freshFor: number) =>
  stateAt(window, now, freshFor) === 'silent'

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

  /** A window's state at `now` (ms) in a word, «fresh» or «silent» (`stateAt`). */
  const state = (window: QuotaWindow, now: number, freshFor: number) =>
    t(`analytics.quota.states.${stateAt(window, now, freshFor)}`)
  const source = (window: QuotaWindow) => t(`analytics.quota.sources.${window.latest.source}`)

  /** How long a window has been silent at `now` (ms): since its latest reading. */
  const silence = (window: QuotaWindow, now: number) =>
    spanWords(Math.max(0, now - Date.parse(window.latest.at)), span)

  /** A window's state at `now` as its bar's words say it: «fresh», or «silent 3 h» with how long. */
  const stateWords = (window: QuotaWindow, now: number, freshFor: number) =>
    silent(window, now, freshFor)
      ? t('analytics.quota.silentFor', { for: silence(window, now) })
      : state(window, now, freshFor)

  /** Two ends of a forecast as one figure, «57%–61%», and one share where they are said alike. */
  function shareRange(low: number, high: number) {
    const [from, to] = [share(low), share(high)]
    return from === to ? from : `${from}–${to}`
  }

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

  /**
   * The bar's words for a reader who cannot see it: the share, the pace, the state with how long
   * the window has been silent at `now` (ms), and the forecast its tail draws, after its key, or
   * that the window has reset (`forecastAt`).
   */
  function barLabel(window: QuotaShareWindow, now: number, today: string, freshFor: number) {
    const values = {
      window: windowName(window),
      share: share(window.latest.used_percent),
      state: stateWords(window, now, freshFor),
      forecast: forecastAt(window, now, today),
    }
    return window.even_percent === null
      ? t('analytics.quota.barNoPace', values)
      : t('analytics.quota.bar', { ...values, even: share(window.even_percent) })
  }

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

  /**
   * The forecast after the key that names its hatch, «Forecast · By the reset: 57% to 61%», as the
   * window's line, its bar's words and its step line's name say it; a window too new for one says
   * so alone, since nothing of it is hatched.
   */
  const forecastLine = (window: QuotaShareWindow, today: string) =>
    window.forecast
      ? t('analytics.quota.forecastLine', {
          key: t('analytics.quota.forecastKey'),
          forecast: forecast(window, today),
        })
      : forecast(window, today)

  /**
   * What a window forecasts at `now` (ms): its forecast after its key while it stands; past its
   * reset, that it has reset, since a forecast for a window that has reset says nothing more and
   * nothing of it is drawn.
   */
  const forecastAt = (window: QuotaShareWindow, now: number, today: string) =>
    stands(window, now) ? forecastLine(window, today) : reset(window, now, today)

  /** How old the latest reading is and who read it; a silent one since when it has not moved. */
  function latest(window: QuotaWindow, now: number, today: string, freshFor: number) {
    const values = { ago: ago(window.latest.at, now), source: source(window) }
    return silent(window, now, freshFor)
      ? t('analytics.quota.silentSince', { ...values, at: moment(window.latest.at, today) })
      : t('analytics.quota.read', values)
  }

  /**
   * What a window's bar neither draws nor says: where steady use would stand now, and how old its
   * latest reading is and who read it, a line each, for the bar's hint.
   */
  const meterHint = (window: QuotaShareWindow, now: number, today: string, freshFor: number) =>
    `${even(window)}\n${latest(window, now, today, freshFor)}`

  /** The bar's words and how old its latest reading is and who read it, for a screen reader. */
  const barRead = (window: QuotaShareWindow, now: number, today: string, freshFor: number) =>
    t('analytics.quota.barRead', {
      bar: barLabel(window, now, today, freshFor),
      read: latest(window, now, today, freshFor),
    })

  /**
   * Where a window stands now, as its step line's «now» says it: its share, and when its latest
   * reading was, how long ago and from whom, or, silent, how long it has been and since when.
   */
  function nowTarget(
    window: QuotaShareWindow,
    now: number,
    today: string,
    freshFor: number,
  ): StepTarget {
    const values = { at: moment(window.latest.at, today), source: source(window) }
    return {
      name: t('analytics.quota.readings.now'),
      figure: share(window.latest.used_percent),
      notes: [
        silent(window, now, freshFor)
          ? t('analytics.quota.readings.silent', { ...values, for: silence(window, now) })
          : t('analytics.quota.readings.last', { ...values, ago: ago(window.latest.at, now) }),
      ],
    }
  }

  /**
   * A window's forecast at its reset, as its step line's corridor and its table say it: the share
   * its edges leave (`ends`), what the figure leaves out — running out before the reset, or
   * spending it, where the forecast says so — and when the reset is.
   */
  function forecastTarget(
    window: QuotaShareWindow,
    ends: WindowAhead,
    now: number,
    today: string,
  ): StepTarget {
    const found = window.forecast
    const plain =
      found !== null &&
      'low_percent' in found &&
      window.latest.used_percent < 100 &&
      found.high_percent < 100
    return {
      name: t('analytics.quota.readings.forecast'),
      figure: shareRange(ends.low, ends.high),
      notes: [...(plain ? [] : [forecast(window, today)]), reset(window, now, today)],
    }
  }

  /** A window of money past a limit: its state, its age and its source, and no figure. */
  const other = (window: QuotaWindow, now: number, freshFor: number) =>
    t('analytics.quota.other', {
      window: windowName(window),
      state: state(window, now, freshFor),
      ago: ago(window.latest.at, now),
      source: source(window),
    })

  /** Such a window by its name and state alone, its age and source left to its hint. */
  const otherState = (window: QuotaWindow, now: number, freshFor: number) =>
    t('analytics.quota.otherState', {
      window: windowName(window),
      state: state(window, now, freshFor),
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

  /**
   * The step line's words for a reader who cannot see it: every reading with its moment, and the
   * forecast its corridor draws, or that the window has reset by `now` (ms) (`forecastAt`).
   */
  const readingsLabel = (
    account: QuotaAccount,
    window: QuotaShareWindow,
    now: number,
    today: string,
  ) =>
    t('analytics.quota.readings.label', {
      forecast: forecastAt(window, now, today),
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
    barRead,
    even,
    forecast,
    forecastLine,
    forecastTarget,
    latest,
    meterHint,
    moment,
    nowTarget,
    other,
    otherState,
    points,
    readingsLabel,
    reset,
    sectionName,
    share,
    stateWords,
    windowName,
  }
}
