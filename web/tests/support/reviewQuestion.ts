/**
 * A review of eighteen points in twenty-five fields, the shape of a real one: five groups, the
 * steps of four points and the way of two under `accept`, labels with code in them, and every
 * verdict recommending `accept`. The wording is neutral; the shape is what the tests rely on.
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
  `${subject} came up in 12 sessions over the last week, 86 % of them from the same call. ` +
  'The fix is small, and a check that the refusal names the command keeps it from coming back; ' +
  'see MAIN-12 for the records and MAIN-14 for the risk of leaving it as it is.'

const HOOKS = 'Hooks and client mods'
const CHECKS = 'Checks and skill texts'
const RULES = 'Instructions'
const CODE = 'Valkama: code'
const SMALL = 'Lab and small things'

export const REVIEW_PROMPT =
  'Decisions on the review of MAIN-7 from 05.11; the evidence and the risks are in the comments.'

export const reviewFields: InputRequestField[] = [
  verdict('p1', 'P1 `shell-guard`: in auto mode refuse with a ready command', HOOKS, long('It')),
  verdict('p2', 'P2 MAIN-21: the identity hook keeps the decision of a neighbour call', HOOKS),
  verdict(
    'p3',
    'P3 `shell-guard`: refusal on `cd <path> &&` and container paths',
    HOOKS,
    long('This'),
  ),
  verdict('p4', 'P4 Checks: false alarms', CHECKS),
  under('p4', 'multi_choice', 'Steps', [
    step('p4a', 'Mark the 14 refusals, then narrow the rule', true, long('Each refusal')),
    step('p4b', '`sources.contradicted` checks the claim against the file it names', true),
    step('p4c', 'Skip the check on an intermediate stop', true),
  ]),
  verdict('p5', 'P5 Checks: text edits in one release', CHECKS),
  under('p5', 'multi_choice', 'Steps', [
    step('p5a', 'Do not name a detail file `REPORT` or `SUMMARY`', true),
    step('p5b', 'Read a claim about code from the raw file', true),
    step('p5c', 'Search outside the narrowed area before removing', true),
    step('p5d', 'Give the number a question rests on with its command', true),
    step('p5e', 'Document updating through the `marketplace`', true),
  ]),
  verdict('p6', 'P6 Questions to the owner: permission to publish', RULES, long('Asking')),
  verdict('p7', 'P7 An approved plan is projected onto the board', RULES),
  verdict('p18', 'P18 A digest reply goes into the thread of its line', RULES),
  verdict('p14', 'P14 What the executor checks and what the integrator does', RULES, long('A run')),
  verdict('p16', 'P16 A draft on the dev server before tests and a commit', RULES),
  verdict('p8', 'P8 A claim without a confirmed session goes stale', CODE, long('A claim')),
  verdict('p9', 'P9 Labels in a list row and a filter by label', CODE),
  verdict('p12', 'P12 A test that server keys and the web schema agree', CODE, long('A key')),
  verdict('p10', 'P10 Development and test harness', CODE),
  under('p10', 'multi_choice', 'Steps', [
    step('lock', 'Lock the browser suite with its owner; free ports or a variable', true),
    step('dirty', '`relkit` on a dirty tree: skipped, and the gate after the build', true),
    step('managed', '`serve --managed` and the bundle from the working tree', true),
    step('click', 'A press helper for browser tests with no scrolling', true),
    step('mutant', 'A mutant that did not build has its own status', true),
    step('fresh', '`serve` gives the fresh bundle or prints its hash'),
    step('build', 'A build error shows before Playwright starts'),
    step('copy', '`--store-copy` registers the spaces of the copy'),
    step('old', 'Run an old tag on a copy of the store'),
    step('token', 'Document the write token of `/api/security/bootstrap`'),
    step('electron', 'The Electron step in the README'),
    step('scratch', 'A place for one-off Playwright specs'),
    step('profile', 'A swapped USERPROFILE in tests keeps the Git author'),
  ]),
  verdict('p11', 'P11 MAIN-30: web dependencies before the npm steps of the gates', CODE),
  under('p11', 'choice', 'Way', [
    step('npm_ci', '`release check` runs `npm ci` itself', true, long('The release')),
    step('check_only', 'Only compare `node_modules/.package-lock.json` with the lockfile'),
    step('runbook', 'Leave it, as a step in the release runbook'),
  ]),
  verdict('p13', 'P13 The 400-line limit for `.vue` runs into styles', CODE),
  under('p13', 'choice', 'Way', [
    step('per_block', 'The standard `vue/max-lines-per-block`', true, long('A limit per block')),
    step('css_file', 'Move styles into CSS files'),
    step('split_first', 'Split shared files before the wave'),
    step('as_is', 'Leave it as it is'),
  ]),
  verdict('p15', 'P15 Lab: the steps of a task', SMALL),
  under('p15', 'multi_choice', 'Steps', [
    step('first_parent', 'The «main first parent» rule in the lab instructions', true),
    step('stand_marker', '`lab_stand create` sets the home marker itself', true),
    step('throwaway', 'A throwaway host stand'),
    step('cheap_gates', 'Cheap gates before the costly round'),
    step('retry_class', 'Tell «retry only the class» apart from the receipt gates'),
  ]),
  verdict('p17', 'P17 Small things', SMALL),
  under('p17', 'multi_choice', 'What to take', [
    step('lessons', 'Three lessons into memory', true, long('A lesson')),
    step('glob', 'Measure `Glob` timeouts from the root, then an `.ignore`', true),
    step('headless', 'Playwright with `--headless`'),
    step('check_split', '`check`: the fast static run apart from the unit tests'),
  ]),
]

/** What «Accept recommended» and nothing else sends: every point accepted as proposed. */
export const recommendedAnswer = {
  ...Object.fromEntries(
    reviewFields.filter((field) => field.type === 'verdict').map(({ id }) => [id, 'accept']),
  ),
  'p4-steps': ['p4a', 'p4b', 'p4c'],
  'p5-steps': ['p5a', 'p5b', 'p5c', 'p5d', 'p5e'],
  'p10-steps': ['lock', 'dirty', 'managed', 'click', 'mutant'],
  'p11-way': 'npm_ci',
  'p13-way': 'per_block',
  'p15-steps': ['first_parent', 'stand_marker'],
  'p17-steps': ['lessons', 'glob'],
}
