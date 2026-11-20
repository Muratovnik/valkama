/**
 * The words of the Volumes page's figures, in the one way it says them.
 *
 * A figure the read has no data for is «—» with a hint saying why, never a zero: a count at
 * acceptance the row does not give (`baseline_absent`), spending of tasks begun before usage was
 * first counted to a card (`partly_measured`, `measured_from`), an estimate of open tasks none of
 * which has one. Work that was counted and spent nothing says so in words. Spending is agent
 * time, the sum of the stretches, and the tokens processed anew; an estimate is rounded, to an
 * hour and to a figure of tokens, since it is a rough figure, and names how many done tasks it is
 * judged by.
 */
import { useI18n } from 'vue-i18n'

import { tokensAnew } from '@/widgets/work-item-inspector/utils/useUsageWords.ts'

import type { UsageTokens } from '@/shared/api/planningUsageApi.ts'
import type { Volumes, VolumesGoal, VolumesSpent } from '@/shared/api/volumesReadApi.ts'
import { spanWords, spanWordsOf } from '@/shared/lib/timeSpan.ts'

type ProjectGroup = Volumes['outside']['by_project'][number]['project']

/** What stands for a figure the read cannot give. */
export const UNKNOWN = '—'

/** A figure and, where it is «—» or not whole, the hint that says why. */
export interface Figure {
  hint: string
  text: string
}

const HOUR = 3600
const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000
const MINUTE_MS = 60_000

export function useVolumesWords() {
  const { locale, t } = useI18n()

  const compact = (value: number) =>
    new Intl.NumberFormat(locale.value, { notation: 'compact', maximumFractionDigits: 1 }).format(
      value,
    )
  const span = (seconds: number) => spanWords(seconds * 1000, spanWordsOf(t))

  /** How long ago a moment was, in its largest unit: «74 d», «5 h», «12 min». */
  function age(since: string, now: Date): string {
    const gone = Math.max(0, now.getTime() - Date.parse(since))
    if (gone >= DAY_MS) return t('time.days', { count: Math.floor(gone / DAY_MS) })
    if (gone >= HOUR_MS) return t('time.hours', { count: Math.floor(gone / HOUR_MS) })
    if (gone >= MINUTE_MS) return t('time.minutes', { count: Math.floor(gone / MINUTE_MS) })
    return t('time.lessThanMinute')
  }

  /** Time and tokens of a spend, joined; empty where nothing was counted. */
  function amount(seconds: number, tokens: UsageTokens): string {
    const anew = tokensAnew(tokens)
    return [seconds > 0 ? span(seconds) : '', anew ? compact(anew) : ''].filter(Boolean).join(' · ')
  }

  /**
   * What a goal spent. Nothing counted while its tasks began before usage was counted is «—»;
   * counted with some of them begun before, the figure is marked as not whole.
   */
  function spent(line: VolumesSpent, measuredFrom: string | null): Figure {
    const said = amount(line.agent_seconds, line.tokens)
    if (measuredFrom === null) return { text: UNKNOWN, hint: t('volumes.goals.neverMeasured') }
    const partly = line.partly_measured
    if (!said && partly > 0) return { text: UNKNOWN, hint: t('volumes.goals.spentUnknown') }
    if (!said) return { text: t('volumes.goals.noSpend'), hint: '' }
    if (partly > 0)
      return { text: `${said}+`, hint: t('volumes.goals.partly', { count: partly }, partly) }
    return { text: said, hint: '' }
  }

  /** «Closed N of M». */
  const closed = (row: VolumesGoal) =>
    t('volumes.goals.closedOf', { closed: row.tasks.closed, total: row.tasks.total })

  /** How many tasks stood under it at acceptance, or «—» with why the row gives none. */
  function baseline(row: VolumesGoal): Figure {
    if (row.baseline === null)
      return {
        text: UNKNOWN,
        hint: row.baseline_absent ? t(`volumes.goals.absent.${row.baseline_absent}`) : '',
      }
    const text = String(row.baseline.tasks)
    return row.baseline.basis === 'started'
      ? { text, hint: t('volumes.goals.started') }
      : { text, hint: '' }
  }

  /**
   * What its open tasks have left, rounded to the hour and a figure of tokens, and the done tasks
   * it is judged by; «—» with no open task, or with none of them estimated.
   */
  function remaining(row: VolumesGoal): Figure & { basis: string } {
    const left = row.remaining
    if (left === null) return { text: UNKNOWN, hint: t('volumes.goals.nothingLeft'), basis: '' }
    if (left.estimated === 0) {
      const open = left.unestimated
      return {
        text: UNKNOWN,
        hint: t('volumes.goals.unestimated', { count: open }, open),
        basis: '',
      }
    }
    const hours = Math.max(1, Math.round(left.agent_seconds / HOUR))
    const anew = tokensAnew(left.tokens)
    const text = [span(hours * HOUR), anew ? compact(anew) : ''].filter(Boolean).join(' · ')
    const basis = t('volumes.goals.basis', { count: left.basis }, left.basis)
    const hint =
      left.unestimated > 0
        ? t('volumes.goals.incomplete', { count: left.unestimated }, left.unestimated)
        : ''
    return { text: `≈\u{A0}${text}`, hint, basis }
  }

  /**
   * A row's project: its name, or its id where the registry names none; tasks naming several or
   * none in their own words, after the space they stand in where the row names one.
   */
  function projectName(project: ProjectGroup, space: string | null): string {
    const several = project.combinations ? 'volumes.projects.several' : 'volumes.projects.none'
    const name = project.id === null ? t(several) : (project.name ?? project.id)
    return space === null ? name : `${space} · ${name}`
  }

  return { age, amount, baseline, closed, compact, projectName, remaining, span, spent }
}
