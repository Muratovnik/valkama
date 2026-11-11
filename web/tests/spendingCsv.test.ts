/**
 * The breakdown as a CSV file. The oracle is a file written out by hand from the requirement:
 * a row per value in the table's order with its id, reference and name; seconds, tokens, dollars
 * and unpriced tokens now and before as plain numbers; an absent figure an empty cell and never
 * 0; text quoted as RFC 4180 has it; a single quote before a formula wherever a spreadsheet's
 * separator could start a field; the bounds of both periods and the filters on every row; a byte
 * order mark first and CRLF line ends.
 */
import { describe, expect, it } from 'vitest'

import { csvFileName, spendingCsv } from '@/pages/analytics/utils/spendingCsv.ts'

import type { UsageGroupValue } from '@/shared/api/analyticsApi.ts'

import { noTask, task, usageAnswer } from './fixtures/analytics.ts'
import type { Stretch } from './fixtures/analytics.ts'

const QUOTED = task(1, 'Fix, the "quote"\nand the line')
const FORMULA = task(2, '=HYPERLINK("http://example.test")')
const BEFORE_ONLY = task(3, '@ the start')

/** This period: three values, one with no price. */
const NOW: Stretch[] = [
  {
    day: 0,
    group: { work_item: QUOTED },
    spend: { seconds: 5400.25, tokens: 1_234_567, cost: 12.345678 },
  },
  {
    day: 1,
    group: { work_item: FORMULA },
    spend: { seconds: 3600, tokens: 1000, cost: null, unpriced: 40 },
  },
  { day: 2, group: { work_item: noTask }, spend: { seconds: 600, tokens: 10, cost: 0.01 } },
]
/** The period before: the first task again, and one that worked only then. */
const BEFORE: Stretch[] = [
  { day: 0, group: { work_item: QUOTED }, spend: { seconds: 3600, tokens: 1000, cost: 1 } },
  { day: 1, group: { work_item: BEFORE_ONLY }, spend: { seconds: 1800, tokens: 300, cost: 0.2 } },
]

/** Three days from Monday 9 November at +03:00, as the read writes them. */
const answer = (before: Stretch[] | null) =>
  usageAnswer({
    first: new Date(Date.UTC(2026, 10, 8, 21)),
    offset: 180,
    days: 3,
    groupBy: ['work_item'],
    stretches: NOW,
    before,
  }).usage

/** The page's names, as a reader sees them in the table. */
function name(value: UsageGroupValue) {
  if (value.unknown) return 'Unknown'
  return value.id === null ? 'No task' : `${value.reference} ${value.title}`
}

const FILTERS = { work_item: [null], project: ['=sum'] }

const csv = (before: Stretch[] | null) =>
  spendingCsv({ by: 'work_item', filters: FILTERS, measure: 'time', usage: answer(before), name })

const HEADER =
  'breakdown,value_id,value_reference,value_name,value_kind,time_seconds,tokens,cost_usd,unpriced_tokens,before_time_seconds,before_tokens,before_cost_usd,before_unpriced_tokens,period_from,period_to,before_from,before_to,filters'

/** The row a task of this title is written in, alone in a period with nothing before it. */
const titledRow = (title: string) => {
  const usage = usageAnswer({
    first: new Date(Date.UTC(2026, 10, 8, 21)),
    offset: 180,
    days: 1,
    groupBy: ['work_item'],
    stretches: [{ day: 0, group: { work_item: task(7, title) }, spend: { seconds: 60 } }],
    before: null,
  }).usage
  return spendingCsv({ by: 'work_item', filters: {}, measure: 'time', usage, name }).split(
    '\r\n',
  )[1]
}
const rowNamed = (cell: string) =>
  `work_item,00000000-0000-4000-8000-000000000007,MAIN-7,${cell},category,60,,,0,,,,,2026-11-09T00:00:00+03:00,2026-11-10T00:00:00+03:00,,,`

describe('the breakdown as a CSV file', () => {
  it('holds every value of both periods, its text safe for a spreadsheet', () => {
    const expected =
      '\u{FEFF}' +
      `${HEADER}\r\n` +
      'work_item,00000000-0000-4000-8000-000000000001,MAIN-1,"Fix, the ""quote""\nand the line",category,5400.25,1234567,12.345678,0,3600,1000,1,0,2026-11-09T00:00:00+03:00,2026-11-12T00:00:00+03:00,2026-11-06T00:00:00+03:00,2026-11-09T00:00:00+03:00,"{""project"":[""=sum""],""work_item"":[null]}"\r\n' +
      'work_item,00000000-0000-4000-8000-000000000002,MAIN-2,"\'=HYPERLINK(""http://example.test"")",category,3600,1000,,40,0,0,0,0,2026-11-09T00:00:00+03:00,2026-11-12T00:00:00+03:00,2026-11-06T00:00:00+03:00,2026-11-09T00:00:00+03:00,"{""project"":[""=sum""],""work_item"":[null]}"\r\n' +
      'work_item,,,No task,none,600,10,0.01,0,0,0,0,0,2026-11-09T00:00:00+03:00,2026-11-12T00:00:00+03:00,2026-11-06T00:00:00+03:00,2026-11-09T00:00:00+03:00,"{""project"":[""=sum""],""work_item"":[null]}"\r\n' +
      'work_item,00000000-0000-4000-8000-000000000003,MAIN-3,"\'@ the start",category,0,0,0,0,1800,300,0.2,0,2026-11-09T00:00:00+03:00,2026-11-12T00:00:00+03:00,2026-11-06T00:00:00+03:00,2026-11-09T00:00:00+03:00,"{""project"":[""=sum""],""work_item"":[null]}"\r\n'
    expect(csv(BEFORE)).toBe(expected)
  })

  it('leaves the period before empty when it was not read, and lists this period alone', () => {
    const expected =
      '\u{FEFF}' +
      `${HEADER}\r\n` +
      'work_item,00000000-0000-4000-8000-000000000001,MAIN-1,"Fix, the ""quote""\nand the line",category,5400.25,1234567,12.345678,0,,,,,2026-11-09T00:00:00+03:00,2026-11-12T00:00:00+03:00,,,"{""project"":[""=sum""],""work_item"":[null]}"\r\n' +
      'work_item,00000000-0000-4000-8000-000000000002,MAIN-2,"\'=HYPERLINK(""http://example.test"")",category,3600,1000,,40,,,,,2026-11-09T00:00:00+03:00,2026-11-12T00:00:00+03:00,,,"{""project"":[""=sum""],""work_item"":[null]}"\r\n' +
      'work_item,,,No task,none,600,10,0.01,0,,,,,2026-11-09T00:00:00+03:00,2026-11-12T00:00:00+03:00,,,"{""project"":[""=sum""],""work_item"":[null]}"\r\n'
    expect(csv(null)).toBe(expected)
  })

  it('leaves the filters empty for a view with none, and quotes nothing that needs no quotes', () => {
    const text = spendingCsv({
      by: 'model',
      filters: {},
      measure: 'cost',
      usage: usageAnswer({
        first: new Date(Date.UTC(2026, 10, 8, 21)),
        offset: 180,
        days: 1,
        groupBy: ['model'],
        stretches: [
          { day: 0, group: { model: { id: '-model', unknown: false } }, spend: { seconds: 60 } },
        ],
        before: [],
      }).usage,
      name: (value) => value.id ?? 'Unknown',
    })
    expect(text.split('\r\n')[1]).toBe(
      `model,"'-model",,,category,60,,,0,0,0,0,0,2026-11-09T00:00:00+03:00,2026-11-10T00:00:00+03:00,2026-11-08T00:00:00+03:00,2026-11-09T00:00:00+03:00,`,
    )
  })

  // Under a `;` or a tab separator each stretch between them is a field a formula can start.
  it.each([
    ['after a semicolon', 'x;=1+1;y', `"x;'=1+1;y"`],
    ['after leading spaces', ' =1+1', `"' =1+1"`],
    ['after a line break', 'first line\n=SUM(A1:A9)', `"first line\n'=SUM(A1:A9)"`],
    ['after a tab', 'a\t+b', `"a\t'+b"`],
    ['after a semicolon and a quotation mark', 'a;"=1+1"', `"a;'""=1+1"""`],
    ['after a tab that starts the cell', '\tnote', `"'\tnote"`],
    ['after a carriage return that starts the cell', '\rnote', `"'\rnote"`],
  ])('shows a formula that starts a field %s', (_where, title, cell) => {
    expect(titledRow(title)).toBe(rowNamed(cell))
  })

  it('leaves a hyphen inside a word and a semicolon before a word as they are', () => {
    expect(titledRow('Re-read the well-known log; then report')).toBe(
      rowNamed('Re-read the well-known log; then report'),
    )
  })

  // A cell with a comma is quoted, and a spreadsheet that splits on commas keeps it whole.
  it.each([
    ['Fix login, -1 offset', '"Fix login, -1 offset"'],
    ['ping @bob, @alice', '"ping @bob, @alice"'],
    ['a,=b', '"a,=b"'],
  ])('leaves what follows a comma as it is: %s', (title, cell) => {
    expect(titledRow(title)).toBe(rowNamed(cell))
  })

  it('is named by the first and the last day of its period, and its breakdown', () => {
    expect(csvFileName(answer(BEFORE), 'work_item')).toBe(
      'agent-usage-2026-11-09-to-2026-11-11-by-work_item.csv',
    )
  })
})
