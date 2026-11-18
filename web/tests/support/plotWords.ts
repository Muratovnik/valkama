/**
 * The words a period chart shows, sorted by where they stand. DESIGN.md stands no line of words
 * over the plot and keeps no row for the chart's changes, over the plot or under it, so a chart's
 * words are its legend's (`data-hint-list="legend"`) and the labels along the plot's edges, each
 * row of them a `ChartTicks` that says its edge (`data-along`): the figures up the scale and the
 * periods' names under it. Read from the text a reader meets rather than from a class, so a line
 * or a row the chart gains is found under whatever class it takes, and a wrapper it gains moves
 * nothing.
 */

/** Every non-blank text a reader meets inside `chart`, with the element it stands in. */
function textsIn(chart: Element) {
  const walker = chart.ownerDocument.createTreeWalker(chart, NodeFilter.SHOW_TEXT)
  const texts: { in: Element | null; text: string }[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent?.trim() ?? ''
    if (text) texts.push({ in: node.parentElement, text })
  }
  return texts
}

/**
 * The rows of labels along the plot's edges, each with the edge it runs along and its labels; the
 * words in the legend; and every other word in the chart, which the rule says there is none of.
 */
export function plotWords(chart: Element) {
  const edges = [...chart.querySelectorAll<HTMLElement>('[data-along]')].map((row) => ({
    along: row.dataset.along,
    labels: [...row.querySelectorAll('[data-key]')].map((label) => label.textContent.trim()),
  }))
  const texts = textsIn(chart).map((one) => ({
    inLegend: one.in?.closest('[data-hint-list="legend"]') != null,
    onEdge: one.in?.closest('[data-along]') != null,
    text: one.text,
  }))
  return {
    edges,
    legend: texts.filter((one) => one.inLegend).map((one) => one.text),
    stray: texts.filter((one) => !one.inLegend && !one.onEdge).map((one) => one.text),
  }
}
