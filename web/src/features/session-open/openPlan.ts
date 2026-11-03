/**
 * Opening a session, a file or a folder: ask the server for the plan, then carry
 * it out on this surface.
 *
 * The server decides where a target goes (`GET /api/open-plan`); nothing here
 * chooses a place by client. The desktop app carries each action out itself,
 * after reading the same plan; a browser follows the plan's links and copies its
 * commands. A browser lets a page start an outside program only in answer to a
 * person's action, and Chromium refuses a second launch until there is another
 * (its `external_protocol_handler` blocks repeats between gestures), so a plan
 * that is not `one_action` is carried out one action per click: the first runs
 * now and the next waits for its own.
 *
 * Every outcome names a closed code from the server's or this module's list, and
 * the words for each are in the dictionaries; an error's own text never reaches
 * the person.
 */

import { fetchSessionContext } from '@/shared/api/api.ts'
import {
  fetchOpenPlan,
  OpenPlanRequestError,
  readBridgeAnswer,
} from '@/shared/api/openPlanModel.ts'
import type {
  BridgeOpenRequest,
  ExplainStep,
  OpenPlace,
  OpenPlan,
  OpenStep,
  PlanOpens,
  PlanQuery,
  PlanReason,
  Surface,
} from '@/shared/api/openPlanModel.ts'
import { DEFAULT_SETTINGS, sessionFamilyOf } from '@/shared/lib/settings.ts'
import type { PlatformSettings, SessionFamily, SessionOpening } from '@/shared/lib/settings.ts'
import { useSettingsStore } from '@/shared/stores/settingsStore.ts'
import type { ResolvedRef } from '@/shared/types/reference.ts'

/** What a click opens. A session's family, when the caller knows it, saves a read. */
export type OpenTarget =
  | { kind: 'session'; session: string; family?: SessionFamily }
  | { kind: 'file'; path: string; project: string; line?: number | null }
  | { kind: 'folder'; path: string; project: string }

/** Why carrying a plan out failed on this side, beside the server's reasons. */
export const EXECUTOR_CODES = [
  'request-failed',
  'contract-invalid',
  'copy-failed',
  'desktop-only',
  'bridge-failed',
  'no-command',
] as const
type ExecutorCode = (typeof EXECUTOR_CODES)[number]

export interface Refusal {
  reason: PlanReason | ExecutorCode
  /** Whether Valkama keeps a copy, for `gone`. */
  archived?: boolean
  /** Why a file or a folder opens nothing, for `path-refused`. */
  code?: ExplainStep['code']
  /** What is not installed, for `not-installed`. */
  host?: ExplainStep['host']
}

/** One click's worth of a plan: the steps it carries out together. */
export interface OpenAction {
  steps: OpenStep[]
  run(): Promise<Outcome>
}

export type Outcome =
  | { notice: Refusal | null; opens: PlanOpens | null; status: 'opened' }
  | { notice: Refusal | null; status: 'copied'; text: string }
  /** The first action ran; `next` waits for the person's next click. */
  | { next: OpenAction; notice: Refusal | null; opens: PlanOpens | null; status: 'next' }
  | { refusal: Refusal; status: 'refused' }

/** A plan as this surface carries it out: an explanation, if any, and its actions. */
interface PlannedOpen {
  actions: OpenAction[]
  /** An `explain` before the actions, such as "it runs in a terminal". */
  notice: Refusal | null
  plan: OpenPlan
}

/** The owner's choices one click needs; read from the settings unless given. */
export interface OpenChoices {
  settings?: PlatformSettings
}

function refusalOf(step: ExplainStep): Refusal {
  const refusal: Refusal = { reason: step.reason }
  if (step.host !== undefined) refusal.host = step.host
  if (step.code !== undefined) refusal.code = step.code
  if (step.archived !== undefined) refusal.archived = step.archived
  return refusal
}

function refused(reason: Refusal['reason']): Outcome {
  return { status: 'refused', refusal: { reason } }
}

function codeOf(error: unknown): ExecutorCode {
  return error instanceof OpenPlanRequestError ? error.code : 'request-failed'
}

function surface(): Surface {
  return window.valkamaDesktop?.openTarget ? 'desktop' : 'browser'
}

function currentSettings(choices: OpenChoices): PlatformSettings {
  if (choices.settings) return choices.settings
  try {
    return useSettingsStore().settings
  } catch {
    // No store outside an application, as in a worker; the defaults are the rule.
    return DEFAULT_SETTINGS
  }
}

function placeOf(choice: SessionOpening['always']): OpenPlace | '' {
  return choice === 'custom' ? '' : choice
}

function queryFor(
  target: OpenTarget,
  on: Surface,
  places: { always: OpenPlace | ''; fallback: OpenPlace | '' },
): PlanQuery {
  if (target.kind === 'session')
    return { target: 'session', session: target.session, surface: on, ...places }
  if (target.kind === 'file')
    return {
      target: 'file',
      project: target.project,
      path: target.path,
      line: target.line ?? null,
      surface: on,
      fallback: places.fallback,
    }
  return {
    target: 'folder',
    project: target.project,
    path: target.path,
    surface: on,
    fallback: places.fallback,
  }
}

function bridgeTarget(target: OpenTarget): BridgeOpenRequest['target'] {
  if (target.kind === 'session') return { kind: 'session', session: target.session }
  if (target.kind === 'file')
    return { kind: 'file', project: target.project, path: target.path, line: target.line ?? null }
  return { kind: 'folder', project: target.project, path: target.path }
}

/** Split a custom template into argv, honoring double quotes, then substitute. */
function customArgv(
  template: string,
  values: { cwd: string; session: string; session_cwd: string },
): string[] {
  const tokens = template.match(/"[^"]*"|\S+/g) ?? []
  return tokens
    .map((token) => (token.startsWith('"') && token.endsWith('"') ? token.slice(1, -1) : token))
    .map((token) =>
      token
        .replaceAll('{session}', values.session)
        .replaceAll('{cwd}', values.cwd)
        .replaceAll('{session_cwd}', values.session_cwd),
    )
    .filter((token) => token.length > 0)
}

function display(argv: string[]): string {
  return argv.map((part) => (/\s/.test(part) ? `"${part}"` : part)).join(' ')
}

/** The project root a session's space is bound to, as the custom command's `{cwd}`. */
function boundRoot(context: ResolvedRef): string {
  const root = context.space_root
  return root?.status === 'mapped' && root.resource_ref && root.canonical_root
    ? root.canonical_root
    : ''
}

async function copyText(text: string, notice: Refusal | null = null): Promise<Outcome> {
  try {
    await navigator.clipboard.writeText(text)
    return { status: 'copied', text, notice }
  } catch {
    return refused('copy-failed')
  }
}

/**
 * The owner's own command. The app runs it; a browser cannot start a program,
 * so it copies the command with the session's folder filled in, which the
 * session's context gives.
 */
async function runCustom(session: string, command: string): Promise<Outcome> {
  if (!command.trim()) return refused('no-command')
  const bridge = window.valkamaDesktop
  if (bridge?.openTarget) {
    const target = { kind: 'session' as const, session }
    return answerOf(await callBridge({ target, fallback: '', always: '', steps: [], command }))
  }
  let context: ResolvedRef
  try {
    context = await fetchSessionContext(session)
  } catch {
    return refused('request-failed')
  }
  const argv = customArgv(command, {
    session: context.session ?? session,
    cwd: boundRoot(context),
    session_cwd: context.session_cwd || context.cwd || '',
  })
  return argv.length ? copyText(display(argv)) : refused('no-command')
}

async function callBridge(request: BridgeOpenRequest): Promise<unknown> {
  try {
    return await window.valkamaDesktop?.openTarget?.(request)
  } catch {
    return null
  }
}

const KNOWN_REASONS = new Set<string>(EXECUTOR_CODES)

function answerOf(
  raw: unknown,
  opens: PlanOpens | null = null,
  notice: Refusal | null = null,
): Outcome {
  const answer = readBridgeAnswer(raw)
  if (answer === null) return refused('bridge-failed')
  if (answer.status === 'opened') return { status: 'opened', opens, notice }
  if (answer.status === 'copied') return { status: 'copied', text: answer.text ?? '', notice }
  const code = answer.code ?? ''
  return refused(KNOWN_REASONS.has(code) ? (code as ExecutorCode) : 'bridge-failed')
}

/** One step in a browser: follow its link or copy its text. */
function followable(step: OpenStep): string | null {
  if (step.kind === 'open-link') return step.link
  if (step.kind === 'focus-folder' || step.kind === 'open-file') return step.link ?? null
  return null
}

async function runInBrowser(
  steps: OpenStep[],
  opens: PlanOpens | null,
  notice: Refusal | null,
): Promise<Outcome> {
  for (const step of steps) {
    if (step.kind === 'copy') return copyText(step.text, notice)
    const link = followable(step)
    // Starting a program or a terminal is the app's; a browser plan never asks it.
    if (link === null) return refused('desktop-only')
    window.open(link, '_blank', 'noreferrer')
  }
  return { status: 'opened', opens, notice }
}

/** Group a plan's steps into the actions a person takes, in order. */
function actionSteps(plan: OpenPlan): OpenStep[][] {
  const steps = plan.steps.filter((step) => step.kind !== 'explain')
  if (!steps.length) return []
  return plan.one_action ? [steps] : steps.map((step) => [step])
}

function chain(actions: OpenAction[], index: number, outcome: Outcome): Outcome {
  const next = actions[index + 1]
  return next && outcome.status === 'opened' ? { ...outcome, status: 'next', next } : outcome
}

/** Why a plan with nothing to carry out opens nothing: its last explanation. */
function planRefusal(plan: OpenPlan): Refusal {
  const explained = plan.steps.filter((step) => step.kind === 'explain')
  const last = explained.at(-1)
  return last ? refusalOf(last) : { reason: 'no-session' }
}

/** Build the actions of a plan for this surface; each one runs only when called. */
function plannedOpen(
  plan: OpenPlan,
  target: OpenTarget,
  places: { always: OpenPlace | ''; fallback: OpenPlace | '' },
): PlannedOpen {
  const explained = plan.steps.find((step) => step.kind === 'explain')
  const notice = explained ? refusalOf(explained) : null
  const groups = actionSteps(plan)
  const actions: OpenAction[] = []
  for (const [index, steps] of groups.entries()) {
    const indexes = steps.map((step) => plan.steps.indexOf(step))
    actions.push({
      steps,
      async run() {
        const outcome =
          plan.surface === 'desktop'
            ? answerOf(
                await callBridge({ target: bridgeTarget(target), ...places, steps: indexes }),
                plan.opens,
                notice,
              )
            : await runInBrowser(steps, plan.opens, notice)
        return chain(actions, index, outcome)
      },
    })
  }
  return { plan, notice, actions }
}

/**
 * The plan for a target on this surface, with the owner's places. A session whose
 * family the caller did not name is asked once without them; its answer names
 * the client, and only a family set apart from the defaults is asked again.
 */
async function planOpen(
  target: OpenTarget,
  choices: OpenChoices = {},
): Promise<PlannedOpen | { custom: string } | Refusal> {
  const settings = currentSettings(choices)
  const on = surface()
  try {
    if (target.kind !== 'session') {
      const places = { fallback: settings.editor, always: '' as const }
      return plannedOpen(await fetchOpenPlan(queryFor(target, on, places)), target, places)
    }
    let family = target.family
    let plan: OpenPlan | null = null
    if (family === undefined) {
      plan = await fetchOpenPlan(queryFor(target, on, { fallback: '', always: '' }))
      family = sessionFamilyOf(plan.client)
    }
    const opening = settings.sessions[family]
    if (opening.always === 'custom') return { custom: opening.command }
    const places = { fallback: opening.fallback, always: placeOf(opening.always) }
    const asDefault = places.fallback === 'vscode' && places.always === ''
    if (plan === null || !asDefault) plan = await fetchOpenPlan(queryFor(target, on, places))
    return plannedOpen(plan, target, places)
  } catch (error) {
    return { reason: codeOf(error) }
  }
}

/**
 * Open a target: the one function a link in text or a button calls. It carries out
 * the plan's first action now; when the plan needs another, the outcome holds it
 * as `next` for the person's next click.
 */
export async function openTarget(target: OpenTarget, choices: OpenChoices = {}): Promise<Outcome> {
  const planned = await planOpen(target, choices)
  if ('custom' in planned) {
    return target.kind === 'session'
      ? runCustom(target.session, planned.custom)
      : refused('no-command')
  }
  if ('reason' in planned) return { status: 'refused', refusal: planned }
  const first = planned.actions[0]
  return first ? first.run() : { status: 'refused', refusal: planRefusal(planned.plan) }
}
