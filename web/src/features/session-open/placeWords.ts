/**
 * The words for where a session is open, what a click did and why it did not:
 * one source for a button's place label, an outcome's notice and a refusal.
 * Every phrase is the dictionary's (`open.*`); nothing here passes an error's
 * own text through.
 */

import type { OpenAction, Outcome, Refusal } from '@/features/session-open/openPlan.ts'

import type { NoticeKind } from '@/shared/lib/notice.ts'

export type Translate = (key: string, values?: Record<string, unknown>) => string

/** A place as the server names one: the host when there is one, else how it is open. */
export interface PlaceName {
  opened_host: string
  opened_in: string
}

/** The dictionary key of a place's word, or `''` for a place nobody recorded. */
export function placeKey(place: PlaceName): string {
  const word = place.opened_host || place.opened_in
  return word ? `open.place.${word}` : ''
}

/** The phrase for being there, which a sentence takes: "in a terminal", «в терминале». */
export function whereWords(t: Translate, place: PlaceName): string {
  return t(`open.where.${place.opened_host || place.opened_in}`)
}

/** Where a link of each scheme opens: an editor is its own place, a client's link its app's. */
const PLACE_OF_SCHEME: Record<string, PlaceName> = {
  'claude': { opened_in: 'app', opened_host: 'claude-desktop' },
  'codex': { opened_in: 'app', opened_host: 'codex-app' },
  // A link that resumes the CLI opens a terminal on the session's folder.
  'claude-cli': { opened_in: 'terminal', opened_host: '' },
}

/** Where one step leads, when the step says; a copy or the app's own opening names none. */
function placeOfStep(step: OpenAction['steps'][number]): PlaceName | null {
  if (step.kind === 'focus-folder' || step.kind === 'open-file')
    return { opened_in: 'ide', opened_host: step.ide }
  if (step.kind === 'open-link')
    return PLACE_OF_SCHEME[step.scheme] ?? { opened_in: 'ide', opened_host: step.scheme }
  return null
}

/**
 * What a button for one action says, standing on its own: where it leads, as the panel
 * offers actions one at a time and a later one is read without the one before it. An
 * action whose steps the app alone knows is the opening itself; one that names its place
 * in its own words (a terminal, Claude Desktop) or opens none (a copy) says no more.
 */
export function actionWords(t: Translate, action: OpenAction): string {
  const step = action.steps.find(({ kind }) => kind !== 'explain')
  if (!step) return t('session.open')
  const place = placeOfStep(step)
  return place
    ? t(`open.action.${step.kind}`, { where: whereWords(t, place) })
    : t(`open.action.${step.kind}`)
}

export function refusalWords(t: Translate, refusal: Refusal): string {
  if (refusal.reason === 'path-refused' && refusal.code)
    return t(`open.pathRefused.${refusal.code}`)
  if (refusal.reason === 'not-installed' && refusal.host) {
    const place = t(placeKey({ opened_in: '', opened_host: refusal.host }))
    return t('open.notInstalled', { place })
  }
  const words = t(`open.refused.${refusal.reason}`)
  return refusal.reason === 'gone' && refusal.archived ? `${words} ${t('open.archived')}` : words
}

/** What a press was on, as the place that pressed it names it: a holder, a file, a folder. */
export interface OpenSubject {
  kind: 'file' | 'folder' | 'session'
  name: string
}

type Unfinished = Extract<Outcome, { status: 'next' | 'refused' }>

/** What a panel adds beside its actions, which says already whose they are. */
export function unfinishedWords(t: Translate, outcome: Unfinished): string {
  if (outcome.status === 'refused') return refusalWords(t, outcome.refusal)
  // A notice before the next action says more than "now the next one".
  return outcome.notice ? refusalWords(t, outcome.notice) : t('open.outcome.next')
}

/** The one line the shell's corner shows for an outcome, which says what it is about. */
export function outcomeWords(t: Translate, outcome: Outcome, subject: OpenSubject): string {
  const { kind, name } = subject
  if (outcome.status === 'copied') return t('open.outcome.copied', { name })
  if (outcome.status === 'opened')
    return outcome.opens?.opened_in
      ? t(`open.outcome.opened.${kind}`, { name, where: whereWords(t, outcome.opens) })
      : t(`open.outcome.openedPlain.${kind}`, { name })
  const why = unfinishedWords(t, outcome)
  return kind === 'session' ? t('open.outcome.about', { name, why }) : why
}

/** Which kind of notice an outcome makes: all but what was done asks something of the person. */
export function outcomeKind(outcome: Outcome): NoticeKind {
  return outcome.status === 'opened' || outcome.status === 'copied' ? 'done' : 'refused'
}
