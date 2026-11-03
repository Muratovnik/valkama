/**
 * What a click on a session, a file or a folder should do, as `GET /api/open-plan`
 * answers it. The server plans; the page and the desktop app only carry the steps
 * out, so every closed list here is the server's and the page adds none of its own.
 *
 * A refusal to plan is not an HTTP error: the plan answers 200 with one `explain`
 * step and a closed `reason`, and a refused file or folder carries a closed `code`.
 */

import { boundedText, parseContract, strictObject, z } from '@/shared/api/contract.ts'
import { enumField } from '@/shared/api/platformApiGuards.ts'
import { readJsonResponse } from '@/shared/api/readJsonResponse.ts'

export const OPENED_IN = [
  '',
  'ide',
  'ide-terminal',
  'terminal',
  'background',
  'app',
  'headless',
] as const
export const OPENED_HOSTS = [
  '',
  'vscode',
  'vscode-insiders',
  'cursor',
  'windsurf',
  'jetbrains',
  'claude-desktop',
  'codex-app',
] as const
/** What the settings may name as a fallback or as "always open in". */
export const OPEN_PLACES = [
  'vscode',
  'vscode-insiders',
  'cursor',
  'windsurf',
  'terminal',
  'claude-desktop',
  'codex-app',
] as const
/** The editors, whose product name is also their scheme: what a file or a folder opens in. */
export const EDITORS = ['vscode', 'vscode-insiders', 'cursor', 'windsurf'] as const
const SCHEMES = [...EDITORS, 'claude', 'codex', 'claude-cli'] as const
const NOT_INSTALLED_HOSTS = [...EDITORS, 'claude-desktop', 'codex-app'] as const
export const PLAN_STATES = ['live', 'ended', 'gone', 'headless', 'none'] as const
/** Every reason an `explain` step can give; the page has words for each. */
export const PLAN_REASONS = [
  'no-session',
  'invalid-session',
  'unsupported-client',
  'gone',
  'live-headless',
  'live-in-terminal',
  'live-elsewhere',
  'no-folder',
  'not-installed',
  'path-refused',
] as const
/** Why a file or a folder target opens nothing, beside `reason: path-refused`. */
export const PATH_REFUSALS = [
  'project_unknown',
  'invalid_path',
  'outside_root',
  'not_found',
  'not_a_file',
  'unreadable',
  'directory',
  'not_a_folder',
] as const

export type OpenPlace = (typeof OPEN_PLACES)[number]
export type Editor = (typeof EDITORS)[number]

const MAX_PATH = 4096
const id = () => boundedText(/^[^\u{0}]+$/u, 200)
const localPath = () => boundedText(/^[^\u{0}]+$/u, MAX_PATH)
const line = () => z.number().int().min(1).max(999_999_999)

/** A link of the one scheme it names; the page follows nothing else. */
function schemeLink(scheme: string, link: string): boolean {
  return link.startsWith(`${scheme}://`) && link.length <= MAX_PATH * 3
}

const linkSchema = z.string().min(1)

const focusFolder = strictObject({
  kind: z.literal('focus-folder'),
  ide: enumField(EDITORS),
  folder: localPath(),
  link: linkSchema.optional(),
}).refine((step) => step.link === undefined || schemeLink(step.ide, step.link), {
  message: 'expected a link of the editor',
})
const openLink = strictObject({
  kind: z.literal('open-link'),
  scheme: enumField(SCHEMES),
  link: linkSchema,
}).refine((step) => schemeLink(step.scheme, step.link), {
  message: 'expected a link of the scheme',
})
const resumeInTerminal = strictObject({
  kind: z.literal('resume-in-terminal'),
  client: enumField(['claude', 'codex'] as const),
  session: id(),
  folder: localPath(),
})
const desktopResume = strictObject({ kind: z.literal('desktop-resume'), session: id() })
const openFile = strictObject({
  kind: z.literal('open-file'),
  ide: enumField(EDITORS),
  path: localPath(),
  line: line().nullable(),
  link: linkSchema.optional(),
}).refine((step) => step.link === undefined || schemeLink(step.ide, step.link), {
  message: 'expected a link of the editor',
})
const copy = strictObject({ kind: z.literal('copy'), text: boundedText(/^[^\u{0}]+$/u, 400) })
const explain = strictObject({
  kind: z.literal('explain'),
  reason: enumField(PLAN_REASONS),
  host: enumField(NOT_INSTALLED_HOSTS).optional(),
  archived: z.boolean().optional(),
  code: enumField(PATH_REFUSALS).optional(),
})

const stepSchema = z.union([
  focusFolder,
  openLink,
  resumeInTerminal,
  desktopResume,
  openFile,
  copy,
  explain,
])

const targetSchema = z.union([
  strictObject({ kind: z.literal('session'), session: id(), agent: z.string().max(200) }),
  strictObject({
    kind: z.literal('file'),
    project: id(),
    path: localPath(),
    line: line().nullable(),
  }),
  strictObject({ kind: z.literal('folder'), project: id(), path: localPath() }),
])

const placeSchema = strictObject({
  opened_in: enumField(OPENED_IN),
  opened_host: enumField(OPENED_HOSTS),
  source: enumField(['recorded', 'derived', 'none'] as const),
  /** Only a session's place says it; a file's or a folder's has none. */
  first_open: z.boolean().optional(),
})

const opensSchema = strictObject({
  opened_in: enumField(OPENED_IN),
  opened_host: enumField(OPENED_HOSTS),
  source: enumField(['recorded', 'derived', 'fallback', 'always'] as const),
  missed: z.union([z.literal(''), enumField(NOT_INSTALLED_HOSTS)]),
})

const planSchema = strictObject({
  target: targetSchema,
  surface: enumField(['desktop', 'browser'] as const),
  client: enumField(['', 'claude', 'codex', 'other'] as const),
  state: enumField(PLAN_STATES),
  place: placeSchema,
  opens: opensSchema.nullable(),
  one_action: z.boolean(),
  steps: z.array(stepSchema).min(1).max(8),
})

export type OpenPlan = z.infer<typeof planSchema>
export type OpenStep = OpenPlan['steps'][number]
export type ExplainStep = Extract<OpenStep, { kind: 'explain' }>
export type PlanOpens = NonNullable<OpenPlan['opens']>
export type Surface = OpenPlan['surface']

/** Why asking for a plan failed; a closed code the page has words for, never the error text. */
export class OpenPlanRequestError extends Error {
  readonly code: 'request-failed' | 'contract-invalid'

  constructor(code: 'request-failed' | 'contract-invalid', message: string) {
    super(message)
    this.name = 'OpenPlanRequestError'
    this.code = code
  }
}

export function validateOpenPlan(value: unknown): OpenPlan {
  return parseContract(planSchema, value, 'plan', (path, detail) => {
    throw new OpenPlanRequestError('contract-invalid', `${path}: ${detail}`)
  })
}

/** The query `GET /api/open-plan` takes: a target, the surface, and the owner's places. */
export type PlanQuery = (
  | { session: string; target: 'session' }
  | { path: string; project: string; target: 'file'; line?: number | null }
  | { path: string; project: string; target: 'folder' }
) & { surface: Surface; always?: OpenPlace | ''; fallback?: OpenPlace | '' }

function openPlanUrl(query: PlanQuery): string {
  const parameters = new URLSearchParams()
  for (const [name, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') parameters.set(name, String(value))
  }
  return `/api/open-plan?${parameters}`
}

export async function fetchOpenPlan(query: PlanQuery): Promise<OpenPlan> {
  const url = openPlanUrl(query)
  let answer: Awaited<ReturnType<typeof readJsonResponse>>
  try {
    answer = await readJsonResponse(url, { headers: { Accept: 'application/json' } })
  } catch (error) {
    throw new OpenPlanRequestError('request-failed', String(error))
  }
  if (!answer.response.ok)
    throw new OpenPlanRequestError('request-failed', `${answer.response.status} ${url}`)
  return validateOpenPlan(answer.payload)
}

const placesSchema = strictObject({
  places: z.record(enumField(OPEN_PLACES), z.boolean()),
})

export type OpenPlaces = z.infer<typeof placesSchema>['places']

export function validateOpenPlaces(value: unknown): OpenPlaces {
  return parseContract(placesSchema, value, 'places', (path, detail) => {
    throw new OpenPlanRequestError('contract-invalid', `${path}: ${detail}`)
  }).places
}

/** Which places this machine can open, as a plan reads it, for the settings to offer. */
export async function fetchOpenPlaces(): Promise<OpenPlaces> {
  const { payload, response } = await readJsonResponse('/api/open-places', {
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw new OpenPlanRequestError('request-failed', String(response.status))
  return validateOpenPlaces(payload)
}

/**
 * What the page hands the desktop app (`valkama:open-session`): the target and the
 * owner's places, never a link or a command line. The app asks the server for the
 * plan itself and checks every step against its own closed list. Without `step`
 * it runs the plan's first action; with it, the one step it names, which the
 * answer before gave as `next`. `command` is the owner's own command, the one
 * template that comes from the page.
 */
export type BridgeOpenRequest =
  | { session: string; always?: OpenPlace; fallback?: OpenPlace; step?: number }
  | {
      path:
        | { kind: 'file'; path: string; project: string; line?: number }
        | { kind: 'folder'; path: string; project: string }
      fallback?: OpenPlace
      step?: number
    }
  | { command: string; session: string }

/** What the desktop app's preload exposes to the page; a browser has none of it. */
interface ValkamaDesktopBridge {
  /** Absent in a desktop app older than this page. */
  onOpenRoute?(listener: (route: string) => void): void
  /** Carry out one action of an open plan; the answer is read as `readBridgeAnswer` reads it. */
  openSession?(request: BridgeOpenRequest): Promise<unknown>
}

declare global {
  interface Window {
    valkamaDesktop?: ValkamaDesktopBridge
  }
}

/** Why the app opened nothing, beside the plan's reasons; a closed list it never widens. */
export const APP_REFUSALS = [
  'not-app',
  'invalid-request',
  'plan-unavailable',
  'invalid-plan',
  'invalid-step',
  'not-installed',
  'launch-failed',
  'window-not-confirmed',
  'no-folder',
  'no-command',
] as const

const bridgeAnswerSchema = strictObject({
  ok: z.boolean(),
  mode: enumField(['opened', 'copied', 'explained', 'refused'] as const),
  /** A closed code; the app's own error text stays in its log. */
  reason: z.string().max(64).optional(),
  host: z.string().max(32).optional(),
  archived: z.boolean().optional(),
  code: z.string().max(32).optional(),
  /** What was copied, for a `copied` answer. */
  command: z.string().max(400).optional(),
  /** The step the person's next action takes, or none. */
  next: z.number().int().min(0).max(7).nullable(),
  /** The plan the app carried out; read again with the page's own schema. */
  plan: z.unknown().optional(),
})

export type BridgeOpenAnswer = Omit<z.infer<typeof bridgeAnswerSchema>, 'plan'> & {
  plan: OpenPlan | null
}

/** The app's answer, or `null` when it is not one, which the page reports as a failure. */
export function readBridgeAnswer(value: unknown): BridgeOpenAnswer | null {
  const result = bridgeAnswerSchema.safeParse(value)
  if (!result.success) return null
  const plan = result.data.plan === undefined ? null : planSchema.safeParse(result.data.plan)
  return { ...result.data, plan: plan?.success ? plan.data : null }
}
