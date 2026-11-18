/**
 * A chart legend's series, read by the hooks `ChartLegend` documents: the legend declares itself
 * (`data-hint-list="legend"`), a series' key carries its key (`data-series`) and a key of a mark,
 * the hatch or the outline, carries `data-mark` instead. Read this way, a key of a mark the chart
 * gains never joins its series, and a wrapper or class the legend gains moves nothing.
 */
import type { DOMWrapper, VueWrapper } from '@vue/test-utils'

type Host = Pick<VueWrapper, 'findAll'> | Pick<DOMWrapper<Element>, 'findAll'>

/** The legend's entries for its series, in its order, each holding its key and any figure. */
export const seriesEntries = (host: Host) =>
  host.findAll('[data-hint-list="legend"] li:has([data-series])')

/** The names of the legend's series, in its order. */
export const seriesNames = (host: Host) =>
  host.findAll('[data-hint-list="legend"] [data-series]').map((key) => key.text())
