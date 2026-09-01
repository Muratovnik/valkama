import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { test } from 'vitest'

import {
  ANALYTICS_CHART_THEME,
  CHART_FONT_FAMILY,
  classifyToolUsage,
  compactToolChartRows,
  hasMaterialDataQualityWarning,
  knownTotal,
  lineChartOption,
  percent,
  runtimeChartOption,
  timeSeriesChartOption,
  toolChartOption,
  total,
} from '@/widgets/analytics-dashboard/utils/chartOptions.ts'

import { present } from './support/present.ts'
import { compactCss } from './support/source.ts'

const analyticsFlow = readFileSync(
  new URL(
    '../src/widgets/analytics-dashboard/components/AnalyticsFlowSection.vue',
    import.meta.url,
  ),
  'utf8',
)
const analyticsAgent = readFileSync(
  new URL(
    '../src/widgets/analytics-dashboard/components/AnalyticsAgentSection.vue',
    import.meta.url,
  ),
  'utf8',
)
const analyticsCardTable = readFileSync(
  new URL('../src/widgets/analytics-dashboard/components/AnalyticsCardTable.vue', import.meta.url),
  'utf8',
)
const analyticsTableSurface = readFileSync(
  new URL('../src/widgets/analytics-dashboard/composables/useAnalyticsTable.ts', import.meta.url),
  'utf8',
)
const analyticsDashboard = readFileSync(
  new URL('../src/widgets/analytics-dashboard/components/AnalyticsDashboard.vue', import.meta.url),
  'utf8',
)
const analyticsFilterBar = readFileSync(
  new URL('../src/widgets/analytics-dashboard/components/AnalyticsFilterBar.vue', import.meta.url),
  'utf8',
)
const activityBell = readFileSync(
  new URL('../src/widgets/activity-bell/ActivityBell.vue', import.meta.url),
  'utf8',
)

function luminance(hex: string): number {
  const channels = hex.match(/[a-f\d]{2}/gi)?.map((part) => Number.parseInt(part, 16) / 255) ?? []
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  )
  return red * 0.2126 + green * 0.7152 + blue * 0.0722
}

function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background))
  const darker = Math.min(luminance(foreground), luminance(background))
  return (lighter + 0.05) / (darker + 0.05)
}

test('line options retain date categories and unknown values as gaps', () => {
  const option = lineChartOption([
    { label: '2026-08-01', value: 13 },
    { label: '2026-08-02', value: null },
    { label: '2026-08-03', value: 8 },
  ])
  assert.deepEqual(option.xAxis?.data, ['2026-08-01', '2026-08-02', '2026-08-03'])
  assert.deepEqual(option.series[0]?.data, [13, null, 8])
  assert.equal(option.series[0]?.connectNulls, false)
  assert.equal(option.tooltip.trigger, 'axis')
  assert.deepEqual(option.tooltip.axisPointer, { type: 'cross' })
})

test('line and runtime charts expose readable bounded axes', () => {
  const line = lineChartOption([
    { label: 'a', value: 0 },
    { label: 'b', value: 5 },
  ])
  const runtime = runtimeChartOption([{ name: 'local', sessions: 2 }])
  assert.equal(line.yAxis?.min, 0)
  assert.equal(line.yAxis?.splitNumber, 4)
  assert.equal(runtime.series[0]?.type, 'bar')
  assert.equal(line.grid.containLabel, true)
  assert.equal(runtime.grid.containLabel, true)
  assert.ok(
    runtime.grid.left <= 24,
    'containLabel owns category-label width instead of double-reserving it',
  )
  assert.equal(runtime.yAxis?.axisLabel.width, 160)
  assert.deepEqual(runtime.series[0]?.label, {
    show: true,
    position: 'right',
    color: ANALYTICS_CHART_THEME.text,
  })
})

test('a realistic ten-day series keeps its plot area instead of reserving a navigator', () => {
  const series = Array.from({ length: 10 }, (_, index) => ({
    label: `2026-08-${String(index + 1).padStart(2, '0')}`,
    value: index,
  }))
  const option = timeSeriesChartOption(series)
  assert.deepEqual(option.dataZoom, [], 'ten daily values fit without a zoom owner')
  assert.ok(
    Number(option.grid.bottom) <= 44,
    'axis labels may not consume a disproportionate plot area',
  )
  assert.equal((option.xAxis as Record<string, any>).axisLabel.rotate, 0)
})

test('all chart options share the dark control-surface theme and bounded category labels', () => {
  const line = lineChartOption([{ label: 'a very long category label', value: 1 }])
  const tools = toolChartOption([
    { name: 'a tool name that needs truncation', calls: 2, success: 2, error: 0 },
  ])
  const runtime = runtimeChartOption([
    { name: 'a runtime name that needs truncation', sessions: 1 },
  ])
  for (const option of [line, tools, runtime]) {
    assert.deepEqual(option.textStyle, {
      color: ANALYTICS_CHART_THEME.text,
      fontSize: 14,
      fontFamily: CHART_FONT_FAMILY,
    })
    assert.equal(option.tooltip.backgroundColor, ANALYTICS_CHART_THEME.tooltipBackground)
    assert.equal(option.tooltip.borderColor, ANALYTICS_CHART_THEME.tooltipBorder)
    assert.deepEqual(option.tooltip.textStyle, { color: ANALYTICS_CHART_THEME.tooltipText })
    assert.ok(
      contrastRatio(ANALYTICS_CHART_THEME.tooltipText, ANALYTICS_CHART_THEME.tooltipBackground) >=
        4.5,
      'tooltip text meets WCAG AA contrast',
    )
  }
  const xAxis = line.xAxis as Record<string, any>
  assert.equal(xAxis.axisLine.lineStyle.color, ANALYTICS_CHART_THEME.axis)
  assert.equal(xAxis.axisTick.lineStyle.color, ANALYTICS_CHART_THEME.axis)
  assert.equal(xAxis.axisLabel.overflow, 'truncate')
  assert.equal(xAxis.axisLabel.width, 160)
  assert.equal(xAxis.axisLabel.fontSize, 13)
  const yAxis = line.yAxis as Record<string, any>
  assert.equal(yAxis.splitLine.lineStyle.color, ANALYTICS_CHART_THEME.grid)
})

test('tool usage is a horizontal outcome stack, not a donut that hides failed and unknown calls', () => {
  const rows = [
    { name: 'shell', calls: 4, success: 3, error: 1 },
    { name: 'kanban', calls: 2, success: 2, error: 0 },
  ]
  const option = toolChartOption(rows)
  assert.equal(option.series.length, 3)
  assert.ok(option.series.every((series) => series.type === 'bar'))
  assert.equal(option.xAxis?.type, 'value')
  assert.deepEqual(option.yAxis?.data, ['shell', 'kanban'])
  assert.equal(option.tooltip.trigger, 'axis')
})

test('tool charts group the long tail into one localized category', () => {
  const rows = Array.from({ length: 10 }, (_, index) => ({
    name: `tool-${index}`,
    calls: 10 - index,
    success: 9 - index,
    error: 1,
  }))
  const compact = compactToolChartRows(rows, 'Другие инструменты')
  assert.equal(compact.length, 8)
  assert.deepEqual(
    compact.slice(0, 2).map((row) => row.name),
    ['tool-0', 'tool-1'],
  )
  assert.deepEqual(compact.at(-1), {
    name: 'Другие инструменты',
    calls: 6,
    success: 3,
    error: 3,
  })
  const option = toolChartOption(rows, { other: 'Другие инструменты' })
  const axis = present(option.yAxis, 'the chart y axis')
  assert.equal((axis.data as Array<unknown>).length, 8)
})

test('bar percentages and totals fail safely', () => {
  assert.equal(percent(4, 8), 50)
  assert.equal(percent(20, 8), 100)
  assert.equal(percent(Number.NaN, 8), 0)
  assert.equal(percent(2, 0), 0)
  assert.equal(total([2, Number.NaN, 3]), 5)
  assert.equal(knownTotal([13, null]), null)
  assert.equal(knownTotal([13, 8]), 21)
})

test('tool calls remain horizontal stacked evidence with an explicit unclassified remainder', () => {
  const rows = classifyToolUsage([
    { name: 'kanban', calls: 9, success: 5, error: 2 },
    { name: 'shell', calls: 3, success: null, error: null },
  ])
  assert.deepEqual(
    rows.map((row) => row.unclassified),
    [2, null],
  )
  const option = toolChartOption(rows, {
    success: 'OK',
    failed: 'Error',
    unclassified: 'Unclassified',
  })
  assert.equal(option.xAxis?.type, 'value')
  assert.deepEqual(option.yAxis?.data, ['kanban', 'shell'])
  assert.deepEqual(
    option.series.map((series) => series.stack),
    ['calls', 'calls', 'calls'],
  )
  assert.deepEqual(
    option.series.map((series) => series.name),
    ['OK', 'Error', 'Unclassified'],
  )
  assert.ok(Array.isArray(option.dataZoom), 'long series can be inspected without shrinking labels')
})

test('quality warnings appear only where non-confirmed history or out-of-scope evidence changes the metric', () => {
  assert.equal(
    hasMaterialDataQualityWarning(
      { overall: 'confirmed' },
      { overall: 'confirmed', states: { linked: 4, other_board: 0, unlinked: 0 } },
    ),
    false,
  )
  assert.equal(
    hasMaterialDataQualityWarning(
      { overall: 'partial' },
      { overall: 'confirmed', states: { linked: 4, other_board: 0, unlinked: 0 } },
    ),
    true,
  )
  assert.equal(
    hasMaterialDataQualityWarning(
      { overall: 'confirmed' },
      { overall: 'confirmed', states: { linked: 4, other_board: 2, unlinked: 1 } },
    ),
    true,
  )
  assert.equal(
    hasMaterialDataQualityWarning(
      { overall: 'confirmed' },
      { overall: 'partial', states: { linked: 4, other_board: 0, unlinked: 0 } },
    ),
    true,
  )
})

test('analytics filter trigger is a fill whose lifted tone means open', () => {
  // Choosing the slice is its own component; the dashboard renders what it picks.
  assert.match(analyticsDashboard, /<AnalyticsFilterBar/)
  const css = compactCss(analyticsFilterBar)
  assert.match(
    css,
    /\.filter-toggle,\.filter-reset\{[^}]*background:var\(--color-control-surface\)/,
  )
  assert.match(
    css,
    /\.filter-toggle\[aria-expanded='true'\]\{background:var\(--color-surface-active\)\}/,
  )
  assert.doesNotMatch(css, /\.filter-toggle[^}]*border(?!-radius)/)
})

test('analytics groups work, agent usage, and card aging into distinct sections', () => {
  // Four sections, each a component now, so the dashboard states the heading and
  // the boundary and hands the contents over.
  assert.equal((analyticsDashboard.match(/class="analytics-section"/g) ?? []).length, 4)
  assert.match(analyticsDashboard, /<AnalyticsExecutionSection/)
  assert.match(analyticsDashboard, /<AnalyticsFlowSection/)
  assert.match(analyticsDashboard, /<AnalyticsAgentSection/)
  assert.match(analyticsDashboard, /<AnalyticsCardTable/)
  assert.match(analyticsDashboard, /dashboard\.flowSection/)
  assert.match(analyticsDashboard, /dashboard\.agentSection/)
  assert.doesNotMatch(analyticsDashboard, /class="quality-warning"/)
})

test('analytics keeps chart data in one URL-owned inspector instead of expanding cards', () => {
  assert.match(
    analyticsDashboard,
    /import AnalyticsTableInspector[\s\S]*from '@\/widgets\/analytics-dashboard\/components\/AnalyticsTableInspector\.vue'/,
  )
  // The empty state belongs to the card that would have held the chart.
  assert.match(
    readFileSync(
      new URL(
        '../src/widgets/analytics-dashboard/components/AnalyticsChartCard.vue',
        import.meta.url,
      ),
      'utf8',
    ),
    /import DataEmptyState from '@\/shared\/ui\/DataEmptyState\.vue'/,
  )
  assert.doesNotMatch(analyticsDashboard, /<DataDisclosure/)
  assert.match(analyticsDashboard, /<AnalyticsTableInspector/)
  assert.match(analyticsDashboard, /useAnalyticsTable/)
  assert.match(analyticsTableSurface, /analyticsTable/)
  assert.match(analyticsTableSurface, /replaceState|pushState/)
  assert.match(analyticsAgent, /dashboard\.tokensMissingTitle/)
  assert.doesNotMatch(analyticsDashboard, /<p v-else class="empty-state">/)
})

test('analytics exposes only meaningful chart encodings', () => {
  assert.match(analyticsFlow, /throughputView = ref<'bars' \| 'line'>/)
  assert.match(analyticsAgent, /runtimeView = ref<'bars' \| 'donut'>/)
  assert.doesNotMatch(analyticsAgent, /toolView = ref<'bars' \| 'donut'>/)
})

test('longest-open work items use the whole table row as the disclosure control', () => {
  // The row carries a reference now, not a row id: opening it is a navigation to
  // a named work item rather than a lookup by number.
  assert.match(
    analyticsCardTable,
    /class="card-row"[\s\S]*@click="emit\('open-work-item', row\.id\)"/,
  )
  assert.match(
    analyticsCardTable,
    /<button[\s\S]*class="row-title"[\s\S]*@click\.stop="emit\('open-work-item', row\.id\)"/,
  )
  assert.doesNotMatch(analyticsCardTable, /class="row-action"/)
  assert.doesNotMatch(analyticsCardTable, /dashboard\.action/)
})

test('analytics tones a state by its category and names it by the space own key', () => {
  assert.match(analyticsCardTable, /import SemanticState from '@\/shared\/ui\/SemanticState\.vue'/)
  assert.match(analyticsFlow, /import \{ stateColor[\w, ]* \} from '@\/shared\/lib\/uiSystem/)
  // The category carries the tone and the key carries the name. A hard-coded
  // list of six lane names lost both the moment a workflow renamed one.
  assert.match(analyticsCardTable, /<SemanticState\s+dimension="work-item-state"/)
  assert.match(analyticsCardTable, /:state="row\.state_category"/)
  assert.match(analyticsFlow, /stateColor\('work-item-state', state\.category\)/)
  assert.doesNotMatch(`${analyticsFlow}${analyticsDashboard}`, /'lane'|`lane\.|const laneColors/)
  assert.doesNotMatch(analyticsDashboard, /class="lane-pill"/)
})

test('activity overlay inherits the readable product foreground tokens', () => {
  assert.match(activityBell, /\.activity-panel\s*\{[^}]*color:\s*var\(--color-text\)/)
  assert.match(activityBell, /h2\s*\{[^}]*color:\s*var\(--color-text\)/)
})
