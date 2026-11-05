/**
 * Opening a session, a file or a folder: the server plans, this surface carries
 * the plan out.
 *
 * The server decides where a target goes (`GET /api/open-plan`); nothing here
 * chooses a place by client. In the desktop app the page names only the target
 * and the owner's places, and the app reads the plan and runs it. A browser reads
 * the plan itself, follows its links and copies its commands. A browser may refuse a
 * second launch of an outside program until the person acts again, and the app's
 * link must not outrun the window it follows, so a plan that is not `one_action`
 * takes one action per click on either surface: the first runs now and the next
 * waits.
 *
 * Every outcome names a closed code, the server's, the app's or this module's,
 * and the words for each are in the dictionaries; an error's own text never
 * reaches the person.
 */

import { fetchSessionContext } from '@/shared/api/api.ts'
import {
  APP_REFUSALS,
  fetchOpenPlan,
  OPEN_PLACES,
  OpenPlanRequestError,
  PATH_REFUSALS,
  PLAN_REASONS,
  readBridgeAnswer,
} from '@/shared/api/openPlanModel.ts'
import type {
  BridgeOpenAnswer,
  BridgeOpenRequest,
  ExplainStep,
  OpenPlace,
  OpenPlan,
  OpenStep,
  PlanOpens,
  PlanQuery,
  Surface,
} from '@/shared/api/openPlanModel.ts'
import { DEFAULT_SETTINGS, sessionFamilyOf } from '@/shared/lib/settings.ts'
import type { PlatformSettings, SessionFamily } from '@/shared/lib/settings.ts'
import { useSettingsStore } from '@/shared/stores/settingsStore.ts'
import type { ResolvedRef } from '@/shared/types/reference.ts'

/** What a click opens. A session's family, when the caller knows it, saves a read. */
export type OpenTarget =
  | { kind: 'session'; session: string; family?: SessionFamily }
  | { kind: 'file'; path: string; project: string; line?: number | null }
  | { kind: 'folder'; path: string; project: string }

/** Why carrying a plan out failed in the page, beside the server's and the app's reasons. */
const PAGE_REFUSALS = [
  'request-failed',
  'contract-invalid',
  'copy-failed',
  'desktop-only',
  'bridge-failed',
] as const

type RefusalReason = (typeof PLAN_REASONS | typeof APP_REFUSALS | typeof PAGE_REFUSALS)[number]

/** Every reason an outcome can name; the dictionaries have words for each. */
export const REFUSAL_REASONS: readonly RefusalReason[] = [
  ...new Set<RefusalReason>([...PLAN_REASONS, ...APP_REFUSALS, ...PAGE_REFUSALS]),
]

/** What can be not installed: the plan's places, and the two programs the app looks for. */
const NOT_INSTALLED = [...OPEN_PLACES, 'claude-cli'] as const

export interface Refusal {
  reason: RefusalReason
  /** Whether Valkama keeps a copy, for `gone`. */
  archived?: boolean
  /** Why a file or a folder opens nothing, for `path-refused`. */
  code?: ExplainStep['code']
  /** What is not installed, for `not-installed`. */
  host?: (typeof NOT_INSTALLED)[number]
  /** The last sign of a session long silent, which may have crashed; see `OpenAction.offer`. */
  silent_since?: string
}

/** One click's worth of a plan: the steps it carries out together. */
export interface OpenAction {
  steps: OpenStep[]
  run(): Promise<Outcome>
}

/** A click's actions before any has run, for a panel that shows them in order. */
export interface PreparedOpen {
  /** The app's plan is its own, read at the click: there the first action is all there is. */
  actions: OpenAction[]
  /** What the plan says first or only: why it runs, why it opens nothing. */
  notice: Refusal | null
  /** What only its own press may run, whatever else was taken; see `offerIndex`. */
  offer: OpenAction | null
  plan: OpenPlan | null
}

export type Outcome =
  | { notice: Refusal | null; opens: PlanOpens | null; status: 'opened' }
  | { notice: Refusal | null; status: 'copied'; text: string }
  /** An action ran or a notice was given; `next` waits for the person's next click. */
  | {
      next: OpenAction
      notice: Refusal | null
      opens: PlanOpens | null
      status: 'next'
      offer?: OpenAction
    }
  | { refusal: Refusal; status: 'refused'; offer?: OpenAction; opens?: PlanOpens | null }

/** The owner's choices one click needs; read from the settings unless given. */
export interface OpenChoices {
  settings?: PlatformSettings
}

interface Places {
  always: OpenPlace | ''
  fallback: OpenPlace | ''
}

type AppCall = (request: BridgeOpenRequest) => Promise<unknown>

const KNOWN_REASONS = new Set<string>(REFUSAL_REASONS)
const KNOWN_CODES = new Set<string>(PATH_REFUSALS)
const KNOWN_HOSTS = new Set<string>(NOT_INSTALLED)

/** A refusal from a plan's or the app's details; a reason without words is the app failing. */
function refusalOf(detail: {
  archived?: boolean
  code?: string
  host?: string
  reason?: string
  silent_since?: string
}): Refusal {
  const reason = detail.reason ?? ''
  if (!KNOWN_REASONS.has(reason)) return { reason: 'bridge-failed' }
  const refusal: Refusal = { reason: reason as RefusalReason }
  if (detail.host !== undefined && KNOWN_HOSTS.has(detail.host))
    refusal.host = detail.host as Refusal['host']
  if (detail.code !== undefined && KNOWN_CODES.has(detail.code))
    refusal.code = detail.code as Refusal['code']
  if (detail.archived !== undefined) refusal.archived = detail.archived
  if (detail.silent_since !== undefined) refusal.silent_since = detail.silent_since
  return refusal
}

function refused(reason: RefusalReason): Outcome {
  return { status: 'refused', refusal: { reason } }
}

export function currentSettings(choices: OpenChoices = {}): PlatformSettings {
  if (choices.settings) return choices.settings
  try {
    return useSettingsStore().settings
  } catch {
    // No store outside an application, as in a worker; the defaults are the rule.
    return DEFAULT_SETTINGS
  }
}

export function appCall(): AppCall | null {
  const desktop = window.valkamaDesktop
  return desktop?.openSession
    ? (request) => desktop.openSession?.(request) ?? Promise.resolve(null)
    : null
}

export function queryFor(target: OpenTarget, on: Surface, places: Places): PlanQuery {
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

/** The app's request: only the keys that carry a value, as it takes nothing else. */
function requestFor(target: OpenTarget, places: Places, step?: number): BridgeOpenRequest {
  const extra = {
    ...(places.fallback ? { fallback: places.fallback } : {}),
    ...(step === undefined ? {} : { step }),
  }
  if (target.kind === 'session')
    return {
      session: target.session,
      ...(places.always ? { always: places.always } : {}),
      ...extra,
    }
  const where = { project: target.project, path: target.path }
  const path =
    target.kind === 'file'
      ? { kind: 'file' as const, ...where, ...(target.line ? { line: target.line } : {}) }
      : { kind: 'folder' as const, ...where }
  return { path, ...extra }
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

async function ask(app: AppCall, request: BridgeOpenRequest): Promise<BridgeOpenAnswer | null> {
  try {
    return readBridgeAnswer(await app(request))
  } catch {
    return null
  }
}

/**
 * The step of a plan that is no part of its route: a session long silent may have
 * crashed, and the plan's last step resumes it. Only the person can tell whether its
 * window is still open, so nothing reaches it by following from the step before.
 */
function offerIndex(plan: OpenPlan): number {
  const silent = plan.steps.some((step) => step.kind === 'explain' && step.silent_since)
  const kind = plan.steps.at(-1)?.kind
  return silent && (kind === 'copy' || kind === 'resume-in-terminal') ? plan.steps.length - 1 : -1
}

/** Where an offer took it, since the plan's `opens` names where the route would have gone. */
const IN_A_TERMINAL: PlanOpens = {
  opened_in: 'terminal',
  opened_host: '',
  source: 'recorded',
  missed: '',
}

function asOffer(action: OpenAction): OpenAction {
  return {
    steps: action.steps,
    async run() {
      const outcome = await action.run()
      return outcome.status === 'opened' ? { ...outcome, opens: IN_A_TERMINAL } : outcome
    },
  }
}

/**
 * What the app's answer means to the person. `follow` builds the action for the
 * step the answer names as `next`, which runs only on the next click.
 */
function answered(
  answer: BridgeOpenAnswer | null,
  follow: ((step: number, plan: OpenPlan | null) => OpenAction) | null,
): Outcome {
  if (answer === null) return refused('bridge-failed')
  const opens = answer.plan?.opens ?? null
  const offered = answer.plan && follow ? offerIndex(answer.plan) : -1
  const step = answer.next === offered ? null : answer.next
  const next = step === null || !follow ? null : follow(step, answer.plan)
  if (answer.mode === 'copied')
    return { status: 'copied', text: answer.command ?? '', notice: null }
  if (answer.mode === 'opened')
    return next
      ? { status: 'next', opens, notice: null, next }
      : { status: 'opened', opens, notice: null }
  const refusal = refusalOf(answer)
  const offer = follow && offered >= 0 ? { offer: asOffer(follow(offered, answer.plan)) } : null
  return next
    ? { status: 'next', opens, notice: refusal, next, ...offer }
    : { status: 'refused', refusal, ...(offer ? { ...offer, opens } : {}) }
}

/** Who the app is asked about and with which places, the same for every action of a click. */
interface AppAsk {
  app: AppCall
  places: Places
  target: OpenTarget
}

/** One action in the app: the target and, after the first, the step; the app does the rest. */
function appAction(asked: AppAsk, step: number | undefined, steps: OpenStep[]): OpenAction {
  const follow = (next: number, plan: OpenPlan | null) =>
    appAction(asked, next, plan?.steps.slice(next, next + 1) ?? [])
  return {
    steps,
    async run() {
      const request = requestFor(asked.target, asked.places, step)
      return answered(await ask(asked.app, request), follow)
    },
  }
}

/**
 * The owner's own command. The app runs it; a browser cannot start a program,
 * so it copies the command with the session's folders filled in, which the
 * session's context gives.
 */
async function runCustom(session: string, command: string): Promise<Outcome> {
  if (!command.trim()) return refused('no-command')
  const app = appCall()
  // The app runs the command once; it names no step after it.
  if (app) return answered(await ask(app, { session, command }), null)
  let context: ResolvedRef
  try {
    context = await fetchSessionContext(session)
  } catch {
    return refused('request-failed')
  }
  const values = {
    session: context.session ?? session,
    cwd: boundRoot(context),
    session_cwd: context.session_folder || context.session_cwd || context.cwd || '',
  }
  // As the app refuses it: an empty folder would change what the command means.
  if (
    (command.includes('{cwd}') && !values.cwd) ||
    (command.includes('{session_cwd}') && !values.session_cwd)
  )
    return refused('no-folder')
  const argv = customArgv(command, values)
  return argv.length ? copyText(display(argv)) : refused('no-command')
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

/** A browser plan's actions, in order: one per step unless one action may run them all. */
function browserActions(plan: OpenPlan): OpenAction[] {
  const offered = plan.steps[offerIndex(plan)]
  const steps = plan.steps.filter((step) => step.kind !== 'explain' && step !== offered)
  const explained = plan.steps.find((step) => step.kind === 'explain')
  const notice = explained ? refusalOf(explained) : null
  const groups = plan.one_action ? [steps] : steps.map((step) => [step])
  const actions: OpenAction[] = []
  for (const [index, group] of groups.entries()) {
    actions.push({
      steps: group,
      async run() {
        const outcome = await runInBrowser(group, plan.opens, notice)
        const next = actions[index + 1]
        return next && outcome.status === 'opened' ? { ...outcome, status: 'next', next } : outcome
      },
    })
  }
  return actions.filter((action) => action.steps.length > 0)
}

/** What a browser's plan offers apart from its route, ready for its own press. */
function browserOffer(plan: OpenPlan): OpenAction | null {
  const step = plan.steps[offerIndex(plan)]
  return step ? { steps: [step], run: () => runInBrowser([step], plan.opens, null) } : null
}

/** Why a plan with nothing to carry out opens nothing: its last explanation. */
export function planRefusal(plan: OpenPlan): Refusal {
  const explained = plan.steps.filter((step) => step.kind === 'explain')
  const last = explained.at(-1)
  return last ? refusalOf(last) : { reason: 'no-session' }
}

function customAction(session: string, command: string): OpenAction {
  return {
    steps: [],
    run: () => (session ? runCustom(session, command) : Promise.resolve(refused('no-command'))),
  }
}

/**
 * The owner's places for a target. A session whose family the caller did not
 * name is planned once without them, which names its client; that plan is kept
 * when the family's places are the defaults.
 */
export async function placesFor(
  target: OpenTarget,
  settings: PlatformSettings,
  on: Surface,
): Promise<{ custom: string } | { places: Places; plan: OpenPlan | null }> {
  if (target.kind !== 'session')
    return { places: { fallback: settings.editor, always: '' }, plan: null }
  let family = target.family
  let plan: OpenPlan | null = null
  if (family === undefined) {
    plan = await fetchOpenPlan(queryFor(target, on, { fallback: '', always: '' }))
    family = sessionFamilyOf(plan.client)
  }
  const opening = settings.sessions[family]
  if (opening.always === 'custom') return { custom: opening.command }
  const places = { fallback: opening.fallback, always: opening.always }
  const asDefault = places.fallback === 'vscode' && places.always === ''
  return { places, plan: asDefault ? plan : null }
}

/**
 * A click's actions, none of them run. The app reads its plan at the click and
 * checks the process itself, so its one action asks and its answer says what
 * follows, a panel's explanation included. A browser's plan is the page's own.
 */
export async function prepareOpen(
  target: OpenTarget,
  choices: OpenChoices = {},
): Promise<PreparedOpen> {
  const settings = currentSettings(choices)
  const app = appCall()
  try {
    const chosen = await placesFor(target, settings, app ? 'desktop' : 'browser')
    if ('custom' in chosen) {
      const session = target.kind === 'session' ? target.session : ''
      const actions = [customAction(session, chosen.custom)]
      return { actions, notice: null, offer: null, plan: null }
    }
    if (app) {
      const asked = { app, target, places: chosen.places }
      const actions = [appAction(asked, undefined, [])]
      return { actions, notice: null, offer: null, plan: chosen.plan }
    }
    const plan = chosen.plan ?? (await fetchOpenPlan(queryFor(target, 'browser', chosen.places)))
    const actions = browserActions(plan)
    const explained = plan.steps.some((step) => step.kind === 'explain')
    return {
      actions,
      notice: explained ? planRefusal(plan) : null,
      offer: browserOffer(plan),
      plan,
    }
  } catch (error) {
    const reason = error instanceof OpenPlanRequestError ? error.code : 'request-failed'
    return { actions: [], notice: { reason }, offer: null, plan: null }
  }
}

/**
 * Open a target: the one function a button or a link in text calls. It carries
 * out the plan's first action now, and when the plan needs another, the outcome
 * holds it as `next` for the person's next click. An explanation comes first and
 * nothing runs with it: the click shows why, and the next one acts.
 */
export async function openTarget(target: OpenTarget, choices: OpenChoices = {}): Promise<Outcome> {
  const { actions, notice, plan } = await prepareOpen(target, choices)
  const [first] = actions
  if (!first) return { status: 'refused', refusal: notice ?? { reason: 'no-session' } }
  if (notice) return { status: 'next', opens: plan?.opens ?? null, notice, next: first }
  return first.run()
}
