/**
 * A review of eighteen points in twenty-five fields for an invented weather station's firmware: five groups, the
 * steps of five points and the way of two under `accept`, labels with code in them, and every
 * verdict recommending `accept`. The wording is invented; the shape is what the tests rely on.
 */
import type { InputRequestField, InputRequestOption } from '@/shared/api/inputRequestModel.ts'

const verdict = (
  id: string,
  label: string,
  group: string,
  description?: string,
): InputRequestField => ({
  id,
  label,
  type: 'verdict',
  required: false,
  options: [],
  group,
  recommended: 'accept',
  ...(description ? { description } : {}),
})

const under = (
  parent: string,
  type: 'choice' | 'multi_choice',
  label: string,
  options: InputRequestOption[],
): InputRequestField => ({
  id: `${parent}-${type === 'choice' ? 'way' : 'steps'}`,
  label,
  type,
  required: true,
  options,
  under: { field: parent, option: 'accept' },
})

const step = (id: string, label: string, recommended = false, description?: string) => ({
  id,
  label,
  ...(recommended ? { recommended: true } : {}),
  ...(description ? { description } : {}),
})

const long = (subject: string) =>
  `${subject} came up in 12 readings over the last week, 86 % of them from the same gauge. ` +
  'The fix is small, and a check that the sample rate stays in range keeps it from coming back; ' +
  'see SITE-12 for the records and SITE-14 for the risk of leaving it as it is.'

const WIND = 'Wind and rain sensors'
const CALIBRATION = 'Calibration and tables'
const POWER = 'Power budget'
const CODE = 'Station: code'
const MENU = 'Display and the menu'

export const REVIEW_PROMPT =
  'Decisions on the review of SITE-7 from 05.11; the evidence and the risks are in the comments.'

export const reviewFields: InputRequestField[] = [
  verdict('p1', 'P1 `wind-tap`: in calm weather skip the gust check at dawn', WIND, long('It')),
  verdict('p2', 'P2 SITE-21: the time sync keeps the reading of a neighbour station', WIND),
  verdict('p3', 'P3 `rain-tap`: a tipping bucket that reports after the reset', WIND, long('This')),
  verdict('p4', 'P4 Sensor: false alarms', CALIBRATION),
  under('p4', 'multi_choice', 'Steps', [
    step('p4a', 'Mark the 14 bad frames, then narrow the filter', true, long('Each frame')),
    step('p4b', '`cal.drift` checks each table against the file it names, in full', true),
    step('p4c', 'Skip the check on an idle sensor node', true),
  ]),
  verdict('p5', 'P5 Tables: unit edits in one batch', CALIBRATION),
  under('p5', 'multi_choice', 'Steps', [
    step('p5a', 'Do not name a raw log file `TMP` or `DUMP` now', true),
    step('p5b', 'Read a figure about rain from the raw log', true),
    step('p5c', 'Search outside the narrowed band before resetting', true),
    step('p5d', 'Give the number a reading rests on with its source', true),
    step('p5e', 'Document updating through the `flash-tool`', true),
  ]),
  verdict('p6', 'P6 Sleep modes: when the radio is allowed to wake', POWER, long('Waking')),
  verdict('p7', 'P7 A shared battery is drawn from the two cells', POWER),
  verdict('p18', 'P18 A summary frame goes into the packet of its slot', POWER),
  verdict('p14', 'P14 What the sensor reads and what the radio transmits', POWER, long('A cycle')),
  verdict('p16', 'P16 A test pattern on the panel before the field trial', POWER),
  verdict('p8', 'P8 A reading without a valid timestamp goes stale', CODE, long('A stamp')),
  verdict('p9', 'P9 Units in a table row and a filter by unit', CODE),
  verdict('p12', 'P12 A test that the pin map and the board agree now', CODE, long('A pin')),
  verdict('p10', 'P10 Bench and test rig in the lab', CODE),
  under('p10', 'multi_choice', 'Steps', [
    step('lock', 'Lock the rain gauge with its keeper; free the pins or a variable', true),
    step('damp', '`rigtest` on a damp board: skipped, and the check after the flash', true),
    step('sealed', '`serve --sealed` and the image from the working copy', true),
    step('press', 'A press helper for display tests with no scrolling', true),
    step('spare', 'A spare unit that did not flash has its status', true),
    step('fresh', 'serve gives the fresh image or prints its checksum'),
    step('build', 'A build error shows before the bench starts'),
    step('copy', '`--log-copy` registers the sensors of the copy'),
    step('old', 'Run an old image on a copy of the log'),
    step('key', 'Document the write key of `/api/calibration/reload`'),
    step('panel', 'The display step in the README'),
    step('bench', 'A place for one-off probe scripts'),
    step('region', 'A swapped region in the tests keeps the station id'),
  ]),
  verdict('p11', 'P11 SITE-30: sensor drivers before the flash steps of the build', CODE),
  under('p11', 'choice', 'Way', [
    step('self_sync', '`bench check` runs `flash sync` itself', true, long('The driver')),
    step('compare_only', 'Only compare `driver/.table-lock.json` with the list of its pins'),
    step('manual_step', 'Leave it, as a step in the field handbook'),
  ]),
  verdict('p13', 'P13 The 400-line limit for `.h` files runs into rows', CODE),
  under('p13', 'choice', 'Way', [
    step('per_block', 'The standard `cfg/max-lines-per-block`', true, long('A limit per block')),
    step('css_file', 'Move tables into a header'),
    step('split_first', 'Split shared files before the flash'),
    step('as_is', 'Leave it as it is'),
  ]),
  verdict('p15', 'P15 Bench: the steps of a run', MENU),
  under('p15', 'multi_choice', 'Steps', [
    step('first_reading', 'The «first reading» rule in the bench notes and log', true),
    step('station_marker', '`bench_rig create` sets the start marker itself', true),
    step('throwaway', 'A throwaway test rig'),
    step('cheap_checks', 'Cheap checks before the costly flash'),
    step('retry_batch', 'Tell «retry only the batch» apart from the receipt checks'),
  ]),
  verdict('p17', 'P17 Small things', MENU),
  under('p17', 'multi_choice', 'What to take', [
    step('notes', 'Three notes into the log', true, long('A note')),
    step('probe', 'Measure `poll` timeouts from the root, then a `.filter`', true),
    step('headless', 'Logger with `--quiet` mode'),
    step('split_checks', '`scan`: the fast static run apart from the full sweep'),
  ]),
]

/** What «Accept recommended» and nothing else sends: every point accepted as proposed. */
export const recommendedAnswer = {
  ...Object.fromEntries(
    reviewFields.filter((field) => field.type === 'verdict').map(({ id }) => [id, 'accept']),
  ),
  'p4-steps': ['p4a', 'p4b', 'p4c'],
  'p5-steps': ['p5a', 'p5b', 'p5c', 'p5d', 'p5e'],
  'p10-steps': ['lock', 'damp', 'sealed', 'press', 'spare'],
  'p11-way': 'self_sync',
  'p13-way': 'per_block',
  'p15-steps': ['first_reading', 'station_marker'],
  'p17-steps': ['notes', 'probe'],
}
