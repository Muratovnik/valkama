import { toneColor } from '@/shared/lib/uiSystem.ts'

export interface SeriesPoint {
  label: string
  value: number | null
}

export interface AnalyticsChartOption {
  [key: string]: unknown
  animation: boolean
  color: string[]
  series: Array<Record<string, unknown>>
  tooltip: Record<string, unknown>
  dataZoom?: Array<Record<string, unknown>>
  /** Cartesian charts only: a pie has no plotting box to inset. */
  grid?: { bottom: number; containLabel: boolean; left: number; right: number; top: number }
  legend?: Record<string, unknown>
  xAxis?: Record<string, unknown>
  yAxis?: Record<string, unknown>
}

/**
 * Chart chrome, mirroring the token of the same name in `tokens.css`.
 *
 * Canvas resolves no custom property, so every value here is a literal copy and
 * `ANALYTICS_CHART_THEME_TOKENS` records what it copies. That map is not
 * documentation: `scripts/sync-tokens.mjs` reads it and rewrites the literals
 * beside it, so this object is generated and `tokens.css` is the thing to edit.
 * The tooltip deliberately reuses the DOM tooltip's tokens so a chart tooltip
 * and an `InfoTip` are the same object.
 */
export const ANALYTICS_CHART_THEME = {
  text: '#ececec',
  muted: '#b3b3b3',
  axis: '#414141',
  grid: '#303030',
  zoomFill: '#303030',
  tooltipBackground: '#303030',
  tooltipBorder: '#4f4f4f',
  tooltipText: '#f2f2f2',
} as const

/**
 * What each literal above copies. `Record<keyof …>` is the half the compiler
 * checks; the other half is that a key here must resolve in `tokens.css`, which
 * the generator enforces when it reads this map.
 *
 * @public read as source text by `scripts/sync-tokens.mjs`, which no import
 * graph can see.
 */
export const ANALYTICS_CHART_THEME_TOKENS: Record<keyof typeof ANALYTICS_CHART_THEME, string> = {
  text: '--color-text',
  muted: '--color-text-muted',
  axis: '--color-chart-axis',
  grid: '--color-chart-grid',
  zoomFill: '--color-chart-zoom-fill',
  tooltipBackground: '--color-tooltip-surface',
  tooltipBorder: '--color-tooltip-border',
  tooltipText: '--color-tooltip-text',
}

/** Slices that mean a name rather than a state. A status color is never one. */
export const CHART_SERIES_PALETTE = ['#7fb4d3', '#78c7a0', '#d8ad62', '#9ea8e8', '#aab4bb'] as const
/** @public read as source text by `scripts/sync-tokens.mjs`, positionally. */
export const CHART_SERIES_TOKENS = [
  '--color-series-1',
  '--color-series-2',
  '--color-series-3',
  '--color-series-4',
  '--color-series-5',
]

const plotGrid = { left: 48, right: 28, top: 18, bottom: 46, containLabel: true }
const horizontalGrid = { left: 20, right: 58, top: 44, bottom: 34, containLabel: true }

/**
 * The interface family, spelled out. `var(--font-family-interface)` reached this object for
 * a long time and never resolved: it is read by canvas, not by the cascade.
 */
export const CHART_FONT_FAMILY = "'Inter Variable', 'Onest Workbench', sans-serif"

const globalTextStyle = {
  color: ANALYTICS_CHART_THEME.text,
  fontSize: 14,
  fontFamily: CHART_FONT_FAMILY,
}

function categoryAxis(data: readonly string[], rotate = 0): Record<string, unknown> {
  return {
    type: 'category',
    data,
    axisLabel: {
      hideOverlap: true,
      color: ANALYTICS_CHART_THEME.muted,
      fontSize: 13,
      lineHeight: 18,
      width: 160,
      overflow: 'truncate',
      ellipsis: '…',
      rotate,
    },
    axisLine: { lineStyle: { color: ANALYTICS_CHART_THEME.axis } },
    axisTick: { lineStyle: { color: ANALYTICS_CHART_THEME.axis } },
  }
}

function valueAxis(): Record<string, unknown> {
  return {
    type: 'value',
    min: 0,
    splitNumber: 4,
    axisLabel: { hideOverlap: true, color: ANALYTICS_CHART_THEME.muted, fontSize: 13 },
    axisLine: { lineStyle: { color: ANALYTICS_CHART_THEME.axis } },
    axisTick: { lineStyle: { color: ANALYTICS_CHART_THEME.axis } },
    splitLine: { show: true, lineStyle: { color: ANALYTICS_CHART_THEME.grid } },
  }
}

function tooltip(trigger: 'axis' | 'item'): Record<string, unknown> {
  return {
    trigger,
    confine: true,
    appendTo: 'analytics-tooltip-root',
    enterable: false,
    backgroundColor: ANALYTICS_CHART_THEME.tooltipBackground,
    borderColor: ANALYTICS_CHART_THEME.tooltipBorder,
    borderWidth: 1,
    textStyle: { color: ANALYTICS_CHART_THEME.tooltipText },
    axisPointer: trigger === 'axis' ? { type: 'cross' } : undefined,
  }
}

function zoom(
  axis: 'x' | 'y',
  length: number,
  visibleCapacity = 12,
): Array<Record<string, unknown>> {
  if (length <= visibleCapacity) return []
  const index = axis === 'x' ? { xAxisIndex: 0 } : { yAxisIndex: 0 }
  return [
    { type: 'inside', filterMode: 'none', ...index },
    {
      type: 'slider',
      filterMode: 'none',
      height: axis === 'x' ? 18 : undefined,
      width: axis === 'y' ? 18 : undefined,
      bottom: axis === 'x' ? 4 : undefined,
      right: axis === 'y' ? 2 : undefined,
      borderColor: ANALYTICS_CHART_THEME.axis,
      fillerColor: ANALYTICS_CHART_THEME.zoomFill,
      ...index,
    },
  ]
}

/** Build a deterministic ECharts line option with all labels retained as categories. */
export function lineChartOption(
  series: readonly SeriesPoint[],
  color = toneColor('info'),
): AnalyticsChartOption {
  return timeSeriesChartOption(series, color, 'line')
}

export function timeSeriesChartOption(
  series: readonly SeriesPoint[],
  color = toneColor('info'),
  view: 'line' | 'bars' = 'line',
  visibleCapacity = 24,
): AnalyticsChartOption {
  const isDense = series.length > visibleCapacity
  return {
    animation: false,
    animationThreshold: 2000,
    textStyle: { ...globalTextStyle },
    color: [color],
    grid: { ...plotGrid, bottom: isDense ? 52 : 40 },
    tooltip: tooltip('axis'),
    xAxis: {
      ...categoryAxis(
        series.map((point) => point.label),
        isDense ? 24 : 0,
      ),
      boundaryGap: view === 'bars',
      axisTick: { alignWithLabel: true, lineStyle: { color: ANALYTICS_CHART_THEME.axis } },
    },
    yAxis: valueAxis(),
    dataZoom: zoom('x', series.length, visibleCapacity),
    series: [
      {
        name: 'value',
        type: view === 'bars' ? 'bar' : 'line',
        smooth: false,
        connectNulls: false,
        showSymbol: view === 'line',
        symbol: 'circle',
        symbolSize: 7,
        sampling: view === 'line' ? 'lttb' : undefined,
        barMaxWidth: view === 'bars' ? 30 : undefined,
        endLabel: { show: true, color, formatter: '{c}' },
        labelLayout: { moveOverlap: 'shiftY' },
        data: series.map((point) => point.value),
      },
    ],
  }
}

export interface ToolChartRow {
  calls: number | null | undefined
  name: string
  error?: number | null
  success?: number | null
  unclassified?: number | null
}

export interface ClassifiedToolChartRow extends ToolChartRow {
  calls: number | null
  error: number | null
  success: number | null
  unclassified: number | null
}

/** Unknown outcome splits stay unknown; only a complete observed split gets a remainder. */
export function classifyToolUsage(rows: readonly ToolChartRow[]): ClassifiedToolChartRow[] {
  return rows.map((row) => {
    const calls = Number.isFinite(row.calls) ? Number(row.calls) : null
    const success = Number.isFinite(row.success) ? Number(row.success) : null
    const error = Number.isFinite(row.error) ? Number(row.error) : null
    const unclassified =
      calls !== null && success !== null && error !== null
        ? Math.max(0, calls - success - error)
        : null
    return { name: row.name, calls, success, error, unclassified }
  })
}

/** Keep categorical charts readable: show the seven busiest tools and one aggregate. */
export function compactToolChartRows(
  rows: readonly ToolChartRow[],
  otherLabel: string,
  limit = 8,
): ToolChartRow[] {
  const observed = rows
    .filter((row) => typeof row.calls === 'number' && Number.isFinite(row.calls) && row.calls >= 0)
    .sort(
      (left, right) =>
        Number(right.calls) - Number(left.calls) || left.name.localeCompare(right.name),
    )
  if (observed.length <= limit) return observed

  const visible = observed.slice(0, Math.max(1, limit - 1))
  const remainder = observed.slice(visible.length)
  const sumKnown = (key: 'success' | 'error' | 'unclassified'): number | null => {
    const values = remainder.map((row) => row[key])
    return values.every((value) => typeof value === 'number' && Number.isFinite(value))
      ? values.reduce<number>((sum, value) => sum + Number(value), 0)
      : null
  }
  const unclassified = sumKnown('unclassified')
  visible.push({
    name: otherLabel,
    calls: remainder.reduce((sum, row) => sum + Number(row.calls), 0),
    success: sumKnown('success'),
    error: sumKnown('error'),
    ...(unclassified === null ? {} : { unclassified }),
  })
  return visible
}

/** Horizontal stacks preserve total calls while making outcome uncertainty explicit. */
export function toolChartOption(
  rows: readonly ToolChartRow[],
  labels: { failed?: string; other?: string; success?: string; unclassified?: string } = {},
): AnalyticsChartOption {
  const chartRows = compactToolChartRows(classifyToolUsage(rows), labels.other ?? 'Other tools')
  const names = chartRows.map((row) => row.name)
  return {
    animation: false,
    animationThreshold: 2000,
    textStyle: { ...globalTextStyle },
    color: [toneColor('success'), toneColor('danger'), toneColor('neutral')],
    grid: { ...horizontalGrid },
    tooltip: tooltip('axis'),
    legend: {
      show: true,
      type: 'scroll',
      top: 0,
      left: 0,
      right: 0,
      textStyle: { color: ANALYTICS_CHART_THEME.muted, fontSize: 13 },
    },
    xAxis: valueAxis(),
    yAxis: categoryAxis(names),
    dataZoom: zoom('y', names.length),
    series: [
      {
        name: labels.success ?? 'Successful',
        type: 'bar',
        stack: 'calls',
        barMaxWidth: 28,
        data: chartRows.map((row) => (Number.isFinite(row.success) ? row.success : null)),
      },
      {
        name: labels.failed ?? 'Failed',
        type: 'bar',
        stack: 'calls',
        barMaxWidth: 28,
        data: chartRows.map((row) => (Number.isFinite(row.error) ? row.error : null)),
      },
      {
        name: labels.unclassified ?? 'Unclassified',
        type: 'bar',
        stack: 'calls',
        barMaxWidth: 28,
        label: {
          show: true,
          position: 'right',
          color: ANALYTICS_CHART_THEME.text,
          formatter: ({ dataIndex }: { dataIndex: number }) => chartRows[dataIndex]?.calls ?? '',
        },
        data: chartRows.map((row) => (Number.isFinite(row.unclassified) ? row.unclassified : null)),
      },
    ],
  }
}

/** Build a horizontal environment distribution so long runtime names remain readable. */
export function runtimeChartOption(
  rows: readonly { name: string; sessions: number | null | undefined }[],
): AnalyticsChartOption {
  return {
    animation: false,
    animationThreshold: 2000,
    textStyle: { ...globalTextStyle },
    color: [toneColor('info')],
    grid: { ...horizontalGrid },
    tooltip: tooltip('axis'),
    xAxis: valueAxis(),
    yAxis: categoryAxis(rows.map((row) => row.name)),
    dataZoom: zoom('y', rows.length),
    series: [
      {
        type: 'bar',
        barMaxWidth: 30,
        label: { show: true, position: 'right', color: ANALYTICS_CHART_THEME.text },
        data: rows.map((row) => (Number.isFinite(row.sessions) ? row.sessions : null)),
      },
    ],
  }
}

export interface DonutSlice {
  name: string
  value: number
}

/**
 * A ring of named slices: runtimes by session count, lanes by card count.
 *
 * The dashboard built this twice inline, once per chart, and the copies had
 * already stopped matching — only one of them avoided overlapping labels.
 * `colors` is a parameter because the two rings mean different things: a
 * categorical palette names runtimes, while lane slices carry state tones.
 */
export function donutChartOption(
  slices: readonly DonutSlice[],
  colors: readonly string[],
): AnalyticsChartOption {
  return {
    animation: false,
    color: [...colors],
    tooltip: { trigger: 'item', confine: true },
    legend: {
      type: 'scroll',
      bottom: 0,
      textStyle: { color: ANALYTICS_CHART_THEME.muted, fontSize: 13 },
    },
    series: [
      {
        type: 'pie',
        radius: ['46%', '70%'],
        center: ['50%', '44%'],
        avoidLabelOverlap: true,
        minShowLabelAngle: 6,
        label: { color: ANALYTICS_CHART_THEME.text, fontSize: 13, formatter: '{b}: {c}' },
        data: slices.map((slice) => ({ name: slice.name, value: slice.value })),
      },
    ],
  }
}

export function percent(value: number | null | undefined, maximum: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(maximum) || maximum <= 0) return 0
  return Math.max(0, Math.min(100, (Number(value) / maximum) * 100))
}

export function total(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0)
}

/**
 * A chart must not turn a missing observation into a zero.  Consumers use the
 * null result to show an explicit unknown state instead of drawing a baseline.
 */
export function knownTotal(values: readonly (number | null | undefined)[]): number | null {
  if (!values.length) return null
  let sum = 0
  for (const value of values) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null
    sum += value
  }
  return sum
}

/** A warning belongs only where a missing/inferred input can change the result. */
export function hasMaterialDataQualityWarning(
  history: Pick<{ overall: string }, 'overall'>,
  evidence: {
    overall: string
    states: Record<'linked' | 'other_space' | 'unlinked', number>
  },
): boolean {
  return (
    history.overall === 'inferred' ||
    history.overall === 'partial' ||
    history.overall === 'unknown' ||
    evidence.overall === 'inferred' ||
    evidence.overall === 'partial' ||
    evidence.overall === 'unknown' ||
    evidence.states.other_space > 0 ||
    evidence.states.unlinked > 0
  )
}

/** Keep unobserved token days out of the plotted line while retaining their labels for the table. */
